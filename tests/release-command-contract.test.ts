import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { databaseSuites, hostedOnlySuites } from "./suite-manifest";

// Three contracts read the *built bundle*, and when there is no bundle they do not fail,
// they skip: `tests/credential-boundary.contract.test.ts:64`,
// `tests/production-module-graph.contract.test.ts:77` and
// `tests/stage8-founder-contracts.test.ts:338`. With `dist` removed for the measurement
// the static half reported "15 passed | 3 skipped" and still exited 0. So the order
// inside the release command is load-bearing: a build that comes after `test:unit` is a
// build those three never see. CI already builds first; the local command did not.
const projectRoot = path.resolve(import.meta.dirname, "..");
const scripts = (
  JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

function stepOrder(command: string): string[] {
  return command.split("&&").map((step) => step.trim());
}

function positionOf(command: string, step: string): number {
  return stepOrder(command).findIndex((entry) => entry.startsWith(step));
}

describe("Stage 9 release command composition", () => {
  it("builds the bundle before the static half that reads it", () => {
    const command = scripts["verify:release:local"];
    const build = positionOf(command, "pnpm build");
    const unit = positionOf(command, "pnpm test:unit");
    expect(build, "no `pnpm build` step in verify:release:local").toBeGreaterThanOrEqual(0);
    expect(unit, "no `pnpm test:unit` step in verify:release:local").toBeGreaterThanOrEqual(0);
    expect(
      build,
      `the three bundle contracts skip when there is no bundle, so build (step ${build}) must precede test:unit (step ${unit})`,
    ).toBeLessThan(unit);
  });

  it("scans the built bundle for privileged credentials after building it", () => {
    const command = scripts["verify:release:local"];
    expect(positionOf(command, "pnpm build")).toBeLessThan(positionOf(command, "pnpm verify:secrets"));
  });

  it("runs the browser half through the one runner that sets every battery flag", () => {
    expect(scripts["verify:e2e:local"]).toBe("node scripts/run-e2e.mjs");
    expect(scripts["test:e2e:smoke"], "CI's browser job must use the same runner").toContain("node scripts/run-e2e.mjs");
  });

  it("lints the scripts the release gates are made of", () => {
    // `scripts/run-e2e.mjs` decides which browser suites run at all, and
    // `scripts/local-stack-check.mjs` decides whether a gate can report green. Both were
    // outside `pnpm lint`, so a typo in either was a defect no static check could see —
    // and the class-C/class-D skips above are exactly what such a typo produces.
    const linted = scripts.lint.split(/\s+/).filter((token) => !token.startsWith("-"));
    expect(linted, `pnpm lint covers ${linted.join(", ")}`).toContain("scripts");
  });
});

// A database-touching suite that is not named in the manifest lands in the static half,
// where it either mutates the shared Postgres during `pnpm test:unit` or skips silently
// when no stack is up. `tests/suite-manifest.ts:1-6` says the split "cannot be left to a
// naming convention that a later file might break" — so the convention is checked here
// rather than trusted.
const LOOKS_LIVE = /^stage\d+-local-.*\.test\.ts$|\.live\.test\.ts$/;

describe("Stage 9 suite split", () => {
  const listed = [...databaseSuites, ...hostedOnlySuites];

  it("lists suites that exist, with no repeats", () => {
    expect([...new Set(listed)], "a suite listed twice is counted once and run once").toHaveLength(listed.length);
    const missing = listed.filter((relative) => !existsSync(path.join(projectRoot, relative)));
    expect(missing, `these listed suites no longer exist: ${missing.join(", ")}`).toEqual([]);
  });

  it("classifies every suite that looks live", () => {
    const testFiles = readdirSync(path.join(projectRoot, "tests")).filter((name) => name.endsWith(".test.ts"));
    const matching = testFiles.filter((name) => LOOKS_LIVE.test(name));
    expect(matching.length, "no suite matched the live naming pattern — the pattern is wrong").toBeGreaterThan(0);
    const unclassified = matching.filter((name) => !listed.includes(`tests/${name}`));
    expect(unclassified, `add these to tests/suite-manifest.ts: ${unclassified.join(", ")}`).toEqual([]);
  });
});
