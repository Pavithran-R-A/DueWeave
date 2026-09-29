import path from "node:path";
import { defineConfig } from "vitest/config";

const projectRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "client", "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts", "client/src/**/*.test.ts", "client/src/**/*.spec.ts"],
    // The whole battery contains the database suites, so it gets the same fail-closed
    // guard as `pnpm test:live`. Without it `pnpm test` (and `pnpm test:stage2`, which
    // uses this config) measured 12 skipped / exit 0 against a non-loopback stack —
    // the same coverage illusion the split into two configs exists to prevent.
    globalSetup: ["tests/live-stack-guard.mjs"],
    // The live suites share one local Postgres and one singleton offer row
    // (`FOUNDER_V1`): Stage 3 asserts the payment gate is closed while Stage 8
    // temporarily opens it to exercise review flows. Parallel files turn that
    // into an order race, so files run one at a time. Cost is wall time only,
    // measured on 27 files: 45.5s parallel, 101.7s serial.
    fileParallelism: false,
  },
});
