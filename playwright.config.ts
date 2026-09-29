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
