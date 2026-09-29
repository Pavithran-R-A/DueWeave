import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The browser battery is gated per stage on an environment variable, and
// `scripts/run-e2e.mjs` is the only thing that sets them for the release command. That
// made the runner a single point of failure with no error message: when it listed six
// stage flags and the battery contained eight, the two missing suites reported as
// *skipped* and `pnpm verify:e2e:local` still said "24 skipped, 0 failed" — a green gate
// that had silently stopped testing persistence and money.
//
// So the rule is asserted here rather than trusted: the set of flags the suites read and
// the set the runner writes have to be the same set, in both directions. A new suite with
// a new flag fails this file until the runner enables it; a flag the runner sets for a
// suite that no longer exists fails it too, so the list cannot quietly grow teeth.
const projectRoot = path.resolve(import.meta.dirname, "..");
const e2eDir = path.join(projectRoot, "e2e");
const runnerPath = path.join(projectRoot, "scripts", "run-e2e.mjs");

const READ_BY_A_SPEC = /process\.env\.(STAGE\d+_LOCAL_E2E)\s*===\s*"1"/g;

function flagsReadBySuites(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of readdirSync(e2eDir).filter((name) => name.endsWith(".spec.ts"))) {
    const source = readFileSync(path.join(e2eDir, file), "utf8");
    for (const match of source.matchAll(READ_BY_A_SPEC)) {
      found.set(match[1], [...(found.get(match[1]) ?? []), file]);
    }
  }
  return found;
}

function flagsWrittenByRunner(): string[] {
  const source = readFileSync(runnerPath, "utf8");
  // Only assignments inside the env block count: the file's own comments name flags it
  // does not set, and a comment cannot turn a suite on.
  const assignments = source.matchAll(/^\s*(STAGE\d+_LOCAL_E2E):\s*"1",/gm);
  return [...assignments].map((match) => match[1]);
}

// The same trap one level up: a package.json script that launches Playwright directly
// skips every gated suite it touches, because nothing set the flag. `pnpm test:e2e:stage2`
// was measured answering "1 skipped" and exiting 0 for the Stage 2 auth journey.
function scriptsThatLaunchGatedSuitesWithoutTheRunner(): string[] {
  const scripts = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const gatedFiles = new Set([...flagsReadBySuites().values()].flat());
  const offenders: string[] = [];
  for (const [name, command] of Object.entries(scripts.scripts)) {
    if (!/\bplaywright test\b/.test(command)) continue;
    const targets = command.split(/\s+/).filter((token) => token.startsWith("e2e/"));
    // No target means the whole directory, which contains every gated suite.
    const touchesGatedSuite =
      targets.length === 0 ||
      targets.some((target) => {
        // `flagsReadBySuites` keys its files by bare name, and a script may name either a
        // spec ("e2e/stage6-local-auth-ux.spec.ts") or a prefix ("e2e/stage6-local").
        const prefix = target.replace(/^e2e\//, "").replace(/\.spec\.ts$/, "");
        return [...gatedFiles].some((file) => file.startsWith(prefix));
      });
    if (touchesGatedSuite) offenders.push(`${name}: ${command}`);
  }
  return offenders;
}

describe("Stage 9 browser battery flags", () => {
  const read = flagsReadBySuites();
  const written = new Set(flagsWrittenByRunner());

  it("reads the flags from the real files, so an empty scan is not a pass", () => {
    expect(existsSync(runnerPath), `${runnerPath} is missing`).toBe(true);
    expect([...read.keys()].length, "no spec read a local-stack flag — the scan pattern is wrong").toBeGreaterThan(0);
    expect(written.size, "the runner writes no flag — the scan pattern is wrong").toBeGreaterThan(0);
  });

  it("turns on every flag a browser suite asks for", () => {
    const unenabled = [...read.entries()]
      .filter(([flag]) => !written.has(flag))
      .map(([flag, files]) => `${flag} is read by ${files.join(", ")}`);
    expect(unenabled, `these suites skip silently under \`pnpm verify:e2e:local\`:\n${unenabled.join("\n")}`).toEqual([]);
  });

  it("sets no flag that no browser suite reads", () => {
    const stale = [...written].filter((flag) => !read.has(flag));
    expect(stale, `these flags enable nothing and hide that a suite is gone: ${stale.join(", ")}`).toEqual([]);
  });

  it("routes every script that launches a gated browser suite through the runner", () => {
    const offenders = scriptsThatLaunchGatedSuitesWithoutTheRunner();
    expect(
      offenders,
      `these scripts run gated suites without setting their flag, so the suites skip and the command still exits 0:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
