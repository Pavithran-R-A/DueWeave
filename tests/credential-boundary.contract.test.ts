import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
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

// A Vite build inlines VITE_SUPABASE_ANON_KEY, which is itself a JWT, so the bundle
// scan looks for privileged material by name and checks JWT literals by value instead.
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
    expect(violations(files, bundlePrivilegedPatterns)).toEqual([]);
    const browserSafeAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
    const tokens = files.flatMap((file) => readFileSync(file, "utf8").match(jwtLiteral) ?? []);
    expect([...new Set(tokens)].filter((token) => token !== browserSafeAnonKey)).toEqual([]);
  });
});
