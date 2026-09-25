import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(root, "client", "src");
const entry = path.join(sourceRoot, "main.tsx");
const demoModule = path.join(sourceRoot, "data", "demo.ts");
const dist = path.join(root, "dist");

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

// `from "…"`, bare `import "…"`, and dynamic `import("…")`: App.tsx loads its
// route modules lazily, so a `from`-only pattern would miss real graph edges.
const specifierPattern = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gm;

function isFile(candidate: string) {
  return existsSync(candidate) && statSync(candidate).isFile();
}

function resolveSpecifier(specifier: string, fromFile: string) {
  const base = specifier.startsWith("@/")
    ? path.join(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : null;
  if (base === null) return { kind: "external" as const };
  if (/\.(css|svg|png|jpe?g|webp|woff2?)$/.test(specifier)) return { kind: "asset" as const };
  const found = CANDIDATE_SUFFIXES.map((suffix) => `${base}${suffix}`).find(isFile);
  return found ? { kind: "module" as const, file: found } : { kind: "unresolved" as const, specifier };
}

function productionGraph() {
  const seen = new Set<string>();
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of [...readFileSync(file, "utf8").matchAll(specifierPattern)].map((match) => match[1] ?? match[2] ?? match[3])) {
      const resolved = resolveSpecifier(specifier, file);
      if (resolved.kind === "module") queue.push(resolved.file);
      if (resolved.kind === "unresolved") unresolved.push(`${relative(file)} -> ${specifier}`);
    }
  }
  return { modules: [...seen], unresolved };
}

function bundleAssets(dir: string): string[] {
  return readdirSync(dir).flatMap((entryName) => {
    const full = path.join(dir, entryName);
    if (statSync(full).isDirectory()) return bundleAssets(full);
    return /\.(js|mjs|css|html)$/.test(entryName) ? [full] : [];
  });
}

function relative(file: string) {
  return path.relative(root, file).replace(/\\/g, "/");
}

const graph = productionGraph();
const demoIdentifiers = ["Arjun Mehta", "Nova Media", "client-nova", "NM-042", "Monsoon campaign photography", "2026-08-12"];

describe("production module graph contract", () => {
  it("walks a non-trivial graph and resolves every local import edge", () => {
    expect(graph.modules.length, "the graph must span more than a handful of modules").toBeGreaterThan(20);
    expect(graph.unresolved, "an unresolvable local import would silently shrink this proof").toEqual([]);
  });

  it("keeps the demo fixture module unreachable from the production entry", () => {
    expect(graph.modules).not.toContain(demoModule);
    expect(graph.modules.filter((file) => /(^|\/)demo\.ts$/.test(relative(file)))).toEqual([]);
  });

  const distPresent = existsSync(dist);
  it.skipIf(!distPresent)("ships none of the demo fixture's identifying data in the production bundle", () => {
    const demoSource = readFileSync(demoModule, "utf8");
    const identifying = demoIdentifiers.filter((value) => demoSource.includes(`"${value}"`));
    expect(identifying).toEqual(demoIdentifiers);
    const files = bundleAssets(dist);
    expect(files.length).toBeGreaterThan(0);
    const bundles = files.map((file) => readFileSync(file, "utf8"));
    const leaked = identifying.filter((value) => bundles.some((bundle) => bundle.includes(value)));
    expect(leaked, `demo fixture values reached the production bundle: ${leaked.join(", ")}`).toEqual([]);
  });

  it("names the ledger aggregate with domain vocabulary, not demo vocabulary", () => {
    const domain = readFileSync(path.join(sourceRoot, "types", "domain.ts"), "utf8");
    expect(domain).toMatch(/export interface LedgerState\s*{[^}]*clients: Client\[\]/s);
    expect(domain).not.toMatch(/\bDemoState\b/);
    const offenders = graph.modules
      .filter((file) => file !== demoModule && /\bDemoState\b|DEMO_TODAY|createDemoState/.test(readFileSync(file, "utf8")))
      .map(relative);
    expect(offenders, "production modules must not speak demo vocabulary").toEqual([]);
  });
});
