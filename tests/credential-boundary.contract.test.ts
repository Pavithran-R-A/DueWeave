import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const clientSource = path.join(root, "client", "src");
const dist = path.join(root, "dist");

// `sb_secret_` and `sb_publishable_` also occur as bare key-prefix literals
// inside @supabase/supabase-js, so the credential patterns require real key length.
const privilegedPatterns: { label: string; pattern: RegExp }[] = [
  { label: "service-role key", pattern: /service_role|service-role|SUPABASE_SERVICE/i },
  { label: "Supabase secret key", pattern: /sb_secret_[A-Za-z0-9_-]{16,}/i },
  { label: "privileged database credential", pattern: /DB_PASSWORD|DATABASE_URL|POSTGRES_PASSWORD/i },
  { label: "JWT literal", pattern: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
];

// A Vite build inlines VITE_SUPABASE_ANON_KEY, which is itself a JWT, so the bundle scan looks for
// privileged material by name here and judges JWTs by their payload role below -- see
// `bundlePrivilegedMaterial`, which is the whole reason the `JWT literal` line is excluded.
const bundlePrivilegedPatterns = privilegedPatterns.filter(({ label }) => label !== "JWT literal");
const jwtLiteral = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

function filesIn(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return filesIn(full, extensions);
    return extensions.some((extension) => entry.endsWith(extension)) ? [full] : [];
  });
}

function violations(files: string[], patterns = privilegedPatterns) {
  return files.flatMap((file) =>
    patterns
      .filter(({ pattern }) => pattern.test(readFileSync(file, "utf8")))
      .map(({ label }) => `${path.relative(root, file)}: ${label}`),
  );
}

// Stage 9 limitation 5: the bundle proof subtracted `process.env.VITE_SUPABASE_ANON_KEY` from the
// JWTs it found. Measured on this tree, the built `dist/` carries exactly one JWT (payload role
// `anon`) and a plain node process has no such environment variable at all -- so the pass held only
// when the test process happened to inherit the same value the build inlined, and a laptop whose
// `dist/` was built from `.env.local` but whose test run does not carry that variable went RED on a
// browser-safe public value. The rule now reads the token: a bundle may carry the anon key, and may
// carry nothing whose payload does not say so.
function jwtRole(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as {
      role?: unknown;
    };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function bundlePrivilegedMaterial(files: string[]): string[] {
  const tokens = [...new Set(files.flatMap((file) => readFileSync(file, "utf8").match(jwtLiteral) ?? []))];
  return [
    ...violations(files, bundlePrivilegedPatterns),
    // An undecodable payload is not demonstrably browser-safe, so it is a finding, not a pass.
    ...tokens
      .filter((token) => jwtRole(token) !== "anon")
      .map((token) => `JWT ${token.slice(0, 8)}… (${token.length} chars) with role ${jwtRole(token) ?? "unreadable"}`),
  ];
}

// Shapes only, never values a real stack could use: assembled at runtime so this file does not
// itself carry a `sb_secret_…` literal into the gate that scans it (the same convention
// `tests/ci-log-credential-redaction.contract.test.ts` uses).
const signedToken = (role: string, signature: string) => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [encode({ alg: "HS256", typ: "JWT" }), encode({ role, iss: "sentinel-not-a-real-project" }), signature.repeat(15)].join(".");
};
const sentinel = {
  projectUrl: ["https://", "dueweave-sentinel", ".supabase.co"].join(""),
  publishableKey: ["sb", "publishable", "SentinelBrowserSafeValueNotARealKey"].join("_"),
  anonToken: signedToken("anon", "a"),
  secretKey: ["sb", "secret", "SentinelPrivilegedValueNotARealKey"].join("_"),
  serviceRoleToken: signedToken("service_role", "b"),
};

/** A synthetic production bundle: the shape of a Vite output, holding `material`. */
function syntheticBundle(material: string[]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dueweave-bundle-"));
  writeFileSync(
    path.join(dir, "index-Ds915sentinel.js"),
    `const e=${JSON.stringify(material)};export default e;\n`,
    "utf8",
  );
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>d</title>\n", "utf8");
  return dir;
}

describe("bundle credential detection discriminates (limitation 5)", () => {
  it("tolerates the browser-safe project URL, publishable key and anon JWT a real build inlines", () => {
    const dir = syntheticBundle([sentinel.projectUrl, sentinel.publishableKey, sentinel.anonToken]);
    try {
      const files = filesIn(dir, [".js", ".mjs", ".css", ".html"]);
      expect(files).toHaveLength(2);
      // Not vacuous: the fixture really is credential-shaped, so a detector that found nothing
      // here would also find nothing in the release bundle.
      expect(files.flatMap((file) => readFileSync(file, "utf8").match(jwtLiteral) ?? [])).toContain(sentinel.anonToken);
      expect(bundlePrivilegedMaterial(files)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a privileged key and a service-role JWT in the same position", () => {
    const dir = syntheticBundle([sentinel.projectUrl, sentinel.secretKey, sentinel.serviceRoleToken]);
    try {
      const found = bundlePrivilegedMaterial(filesIn(dir, [".js", ".mjs", ".css", ".html"]));
      expect(found.filter((entry) => entry.includes("Supabase secret key"))).toHaveLength(1);
      // Named by its role, never by its value: a gate that prints what it found leaks the
      // credential into the build log it exists to protect.
      expect(found.filter((entry) => entry.includes("role service_role"))).toHaveLength(1);
      expect(found.join("\n")).not.toContain(sentinel.serviceRoleToken);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Stage 2 privileged-credential boundary", () => {
  it("reads only the browser-safe project URL and publishable key", () => {
    const source = readFileSync(path.join(clientSource, "lib", "supabase.ts"), "utf8");
    expect(source).toMatch(/import\.meta\.env\.VITE_SUPABASE_URL/);
    expect(source).toMatch(/import\.meta\.env\.VITE_SUPABASE_ANON_KEY/);
    expect(source).not.toMatch(/process\.env/);
    const envKeys = [...source.matchAll(/import\.meta\.env\.([A-Z_0-9]+)/g)].map((match) => match[1]);
    expect(envKeys.sort()).toEqual(["VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_URL"]);
  });

  it("keeps no privileged credential in any browser source file", () => {
    const files = filesIn(clientSource, [".ts", ".tsx"]);
    expect(violations(files)).toEqual([]);
  });

  it("keeps no generated local environment file tracked", () => {
    const lines = readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/).map((line) => line.trim());
    for (const ignored of [".env", ".env.local", "supabase/.temp/"]) {
      expect(lines).toContain(ignored);
    }
    expect(lines).not.toContain(".env.example");
    expect(existsSync(path.join(root, ".env.example"))).toBe(true);
  });

  const distPresent = existsSync(dist);
  it.skipIf(!distPresent)("keeps no privileged credential in the production bundle", () => {
    const files = filesIn(dist, [".js", ".mjs", ".css", ".html"]);
    expect(files.length).toBeGreaterThan(0);
    expect(bundlePrivilegedMaterial(files)).toEqual([]);
  });
});
