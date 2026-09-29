import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { databaseSuites, hostedOnlySuites } from "./suite-manifest";

// The static half of the release gate is defined by what it does *not* need: no
// database, no hosted project, no credentials. That definition was only a comment and a
// name until CI measured it — on a laptop whose gitignored `.env.local` let a unit file
// construct a Supabase client at module scope, while the same command failed everywhere
// the file was honestly absent. So the property is checked here rather than trusted: a
// suite file that reaches the client builder is a suite file that needs configuration the
// static job never has.
const root = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(root, "client", "src");
const supabaseClient = path.join(sourceRoot, "lib", "supabase.ts");

/** The directories `vitest.unit.config.ts` collects from, and the suffixes it matches. */
const suiteDirs = [path.join(root, "tests"), sourceRoot];
const suiteSuffixes = [".test.ts", ".spec.ts"];

// The unit config excludes these; a pin that checked them would demand the impossible.
const excludedSuites = new Set([...databaseSuites, ...hostedOnlySuites]);

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const specifierPattern =
  /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gm;

function relative(file: string) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function isFile(candidate: string) {
  return existsSync(candidate) && statSync(candidate).isFile();
}

function resolveSpecifier(specifier: string, fromFile: string) {
  const base = specifier.startsWith("@/")
    ? path.join(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : null;
  if (base === null) return null;
  if (/\.(css|svg|png|jpe?g|webp|woff2?)$/.test(specifier)) return null;
  return CANDIDATE_SUFFIXES.map((suffix) => `${base}${suffix}`).find(isFile) ?? null;
}

function unitSuites() {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (suiteSuffixes.some((suffix) => entry.endsWith(suffix)) && !excludedSuites.has(relative(full))) found.push(full);
    }
  };
  for (const dir of suiteDirs) walk(dir);
  return found;
}

/** Every module a suite file loads, transitively — the same walk the production graph pin uses. */
function reachableFrom(entry: string) {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of [...readFileSync(file, "utf8").matchAll(specifierPattern)].map((match) => match[1] ?? match[2] ?? match[3])) {
      const resolved = resolveSpecifier(specifier, file);
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen];
}

const suites = unitSuites();

// A suite may still drive code that names the client module, provided the suite file
// itself replaces it before importing: `vi.mock` is hoisted above the imports of its own
// file, so the real builder never runs. Checked in the suite file only, because a mock in
// a helper would not hoist into the graph that needs it.
function mocksSupabaseClient(file: string) {
  return /vi\.mock\(\s*["']@\/lib\/supabase["']/.test(readFileSync(file, "utf8"));
}

describe("unit suite hermeticity", () => {
  it("reads a real suite list, so an empty walk is not a pass", () => {
    expect(suites.length, "no unit suite files were collected — the scan pattern is wrong").toBeGreaterThan(20);
    for (const suite of suites.slice(0, 3)) expect(existsSync(suite)).toBe(true);
  });

  it("keeps every static suite file away from the Supabase client builder", () => {
    const reaching = suites.filter((suite) => !mocksSupabaseClient(suite) && reachableFrom(suite).includes(supabaseClient)).map(relative);
    expect(
      reaching,
      `these unit suites construct a Supabase client, so they only run where credentials are configured: ${reaching.join(", ")}. ` +
        "Move the code under test into a module that takes no client, or classify the suite as a database suite.",
    ).toEqual([]);
  });

  it("does not carry a mock exemption no suite needs", () => {
    const mocked = suites.filter(mocksSupabaseClient).map(relative);
    expect(mocked.length, "no unit suite mocks the client module — this exemption is stale").toBeGreaterThan(0);
  });
});
