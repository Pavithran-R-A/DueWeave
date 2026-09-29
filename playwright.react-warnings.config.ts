import { defineConfig, devices } from "@playwright/test";

// Stage 9 PHASE 16 asks the release battery to fail on React warnings, and that half is
// physically unobservable on the bundle the battery serves: `dist` carries production
// React, which throws minified errors instead of printing warnings (measured —
// `dist/assets/index-*.js` contains "Minified React error" and none of the dev-mode
// warning text). So the warning channel is measured here, against `vite dev` on its own
// port, by the same problem watcher the release journeys use and with the same rule: any
// console error, any uncaught error, any request that never got an answer, fails the run.
//
// This config exists on its own because the two servers cannot share a port, and
// `testMatch` keeps it single-purpose: pointing it at the whole `e2e` directory would
// re-run every journey against an unbundled build for no extra proof.
const baseURL = process.env.E2E_DEV_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "stage9-react-warnings.spec.ts",
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  globalSetup: "./e2e/local-stack-setup.mjs",
  webServer: {
    command: "pnpm dev --port 3100 --strictPort --host 127.0.0.1",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // An unbundled React app has thousands of module requests on first paint; the
    // 120 s the production preview needs is not enough here, and a cold start that
    // times out reads like a defect when it is only the dev pipeline warming up.
    timeout: 240_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium-dev", use: { ...devices["Desktop Chrome"], channel: "chromium" } }],
});
