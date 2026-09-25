import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(import.meta.dirname, "..", "client", "src");
const demoModule = path.join(sourceRoot, "data", "demo.ts");

function runtimeSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return runtimeSourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry)) return [];
    if (/\.(test|spec)\.ts$/.test(entry)) return [];
    if (entry === "vite-env.d.ts") return [];
    return [full];
  });
}

const productionFiles = runtimeSourceFiles(sourceRoot);

describe("Stage 2 demo-fixture boundary", () => {
  it("keeps the demo fixture module referenced only by test files", () => {
    const importers = productionFiles.filter((file) =>
      /from\s+["']@\/data\/demo["']|from\s+["']\.\/demo["']/.test(readFileSync(file, "utf8")),
    );
    expect(importers.map((file) => path.relative(sourceRoot, file))).toEqual([]);
  });

  it("keeps DEMO_TODAY out of every production runtime module", () => {
    const offenders = productionFiles
      .filter((file) => file !== demoModule)
      .filter((file) => readFileSync(file, "utf8").includes("DEMO_TODAY"));
    expect(offenders.map((file) => path.relative(sourceRoot, file))).toEqual([]);
  });

  it("scans a non-empty production source set", () => {
    expect(productionFiles.length).toBeGreaterThan(20);
  });
});
