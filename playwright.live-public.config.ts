import { defineConfig, devices } from "@playwright/test";

// This suite verifies the real, unauthenticated production surface. It intentionally does not
// create users, trigger emails or write business records: those require dedicated verified QA
// identities, a configured SMTP sender and explicit cleanup evidence.
export default defineConfig({
  testDir: "./e2e-live",
  // Cloudflare rebuilds this site on the same push that starts this workflow, so the suite is
  // reading a document that may still be changing. `e2e-live/settled-deployment-setup.mjs` waits
  // for the rebuild to stop and renders the site once before the first spec runs; the assertions
  // below keep the 5s waits they were written with.
  globalSetup: "./e2e-live/settled-deployment-setup.mjs",
  timeout: 30_000,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"], ["html", { outputFolder: "live-playwright-report", open: "never" }]],
  use: {
    baseURL: "https://dueweave.pages.dev",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } }],
});
