import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  forbidOnly: Boolean(process.env.CI),
  // Stage 9 PHASE 18: a retried test is a result nobody can cite, so the battery runs
  // each test once and a failure stays a failure. Anything intermittent is diagnosed as
  // a defect, not retried away.
  retries: 0,
  // CI scans and uploads two directories after the run, so both have to exist: `test-results`
  // is Playwright's output directory (traces and screenshots a failure leaves behind) and the
  // html reporter is what writes `playwright-report`. With the default reporter the run prints
  // to stdout only, and CI's scan step fails on a directory nothing produced. `open: "never"`
  // keeps a failed local run as non-interactive as a failed CI run.
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  // The suites drive the production bundle against the local stack, so both halves of
  // that sentence are checked before a single assertion runs: `globalSetup` refuses an
  // absent or non-loopback stack, and `webServer` serves `dist` on the port `baseURL`
  // names instead of leaving a run to measure whatever server happened to be up.
  globalSetup: "./e2e/local-stack-setup.mjs",
  webServer: {
    command: "pnpm preview --port 3000 --strictPort --host 127.0.0.1",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } }],
});
