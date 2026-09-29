import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

// The browser battery is gated on the local stack, and every gate this repository uses
// is an environment variable. Setting `STAGE6_LOCAL_E2E=1 …` in a shell works on Linux
// and in Git Bash but not in Windows `cmd`, so the canonical browser commands route
// through this file instead: one implementation, one behaviour on both platforms, and no
// way to run the battery while quietly forgetting a flag that would have enabled half of
// it.
//
// Usage:
//   node scripts/run-e2e.mjs                      # the whole local browser battery
//   node scripts/run-e2e.mjs e2e/a.spec.ts …      # a named subset (what CI's smoke job runs)
//   node scripts/run-e2e.mjs --workers=2          # an explicit worker count

const projectRoot = path.resolve(import.meta.dirname, "..");
const cliEntry = path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js");
const args = process.argv.slice(2);

if (!existsSync(cliEntry)) {
  console.error("Playwright is not installed. Run `pnpm install --frozen-lockfile` first.");
  process.exit(1);
}
if (!existsSync(path.join(projectRoot, "dist", "index.html"))) {
  console.error("There is no build to serve. Run `pnpm build` first (the suite tests the production bundle, not the dev server).");
  process.exit(1);
}

const env = {
  ...process.env,
  // Every flag a suite reads has to appear here, and tests/e2e-battery-flags.contract
  // .test.ts fails the static gate if one is missing. Stage 4 and Stage 5 were absent
  // from this block while their suites existed, so 24 browser tests — persistence and
  // money — skipped under a command that still reported a green battery.
  STAGE2_LOCAL_E2E: "1",
  STAGE3_LOCAL_E2E: "1",
  STAGE4_LOCAL_E2E: "1",
  STAGE5_LOCAL_E2E: "1",
  STAGE6_LOCAL_E2E: "1",
  STAGE7_LOCAL_E2E: "1",
  STAGE8_LOCAL_E2E: "1",
  STAGE9_LOCAL_E2E: "1",
};

// The suites share one local Postgres, one singleton Founder offer row and one browser
// purge, so the default is one worker. Measured on the full battery: 181 tests, 173 passed and
// 8 skipped (the host-credential-gated legacy specs), 29.6 min.
if (!args.some((arg) => arg.startsWith("--workers"))) args.push("--workers=1");

const result = spawnSync(process.execPath, [cliEntry, "test", ...args], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
