import { defineConfig, devices } from "@playwright/test";

// This suite verifies the real, unauthenticated production surface. It intentionally does not
// create users, trigger emails or write business records: those require dedicated verified QA
// identities, a configured SMTP sender and explicit cleanup evidence.
export default defineConfig({
  testDir: "./e2e-live",
  timeout: 30_000,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"], ["html", { outputFolder: "live-playwright-report", open: "never" }]],
  use: {
    baseURL: "https://dueweave.pages.dev",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
