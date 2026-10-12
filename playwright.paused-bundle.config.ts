import { defineConfig, devices } from "@playwright/test";

// The release flag gate for the artifact production actually serves: a bundle built with
// `VITE_PUBLIC_SIGNUP_ENABLED=false` and `VITE_AUTH_EMAIL_ENABLED=false`.
//
// It needs its own config because those two flags are compile-time literals — Vite inlines
// them and Rollup constant-folds the branches, so "paused" and "open" are different
// artifacts rather than one artifact reading a runtime value. The rest of the battery is
// built with both flags `true` (registration and recovery are what those journeys click), so
// no spec in `e2e/` can ever see the closed state. That left the closed state asserted only
// by which sentences survived into the bundle, and a sentence that is absent is not the same
// claim as a flow that is unreachable: the signup form's markup sits behind a runtime
// condition (`mode === "signUp"`), so it ships in the paused bundle, and `Auth.tsx` carried a
// confirmation screen whose own copy said registrations were paused while a button two nodes
// away opened that form. Measured on the deployed artifact: the click reached `/auth/v1/signup`.
//
// So this half clicks, on a port of its own, against `dist-paused`, and it deliberately has no
// `globalSetup`: it needs no Supabase stack because every auth call is intercepted inside the
// spec, which is also what keeps a paused-bundle run from creating a user anywhere.
//
// `scripts/run-paused-e2e.mjs` builds `dist-paused` with both flags stated; a config that read
// `dist/` would measure whichever build last wrote it, which is the decision this repository
// refuses to leave to luck.
const baseURL = process.env.E2E_PAUSED_BASE_URL ?? "http://127.0.0.1:3200";

export default defineConfig({
  testDir: "./e2e-paused",
  timeout: 30_000,
  // Same rule as the rest of the battery: a retried test is a result nobody can cite.
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  // CI scans and uploads `test-results` and `playwright-report`, so both have to be produced
  // by this run too, under the same names.
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  webServer: {
    // `../dist-paused` rather than an absolute path: Vite resolves `--outDir` against its
    // `root` (which is `client/`), so the directory that lands next to `dist/` is one level up.
    command: "vite preview --outDir ../dist-paused --port 3200 --strictPort --host 127.0.0.1",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium-paused", use: { ...devices["Desktop Chrome"], channel: "chromium" } }],
});
