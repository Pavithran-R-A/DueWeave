import path from "node:path";
import { defineConfig } from "vitest/config";
import { databaseSuites } from "./tests/suite-manifest";

const projectRoot = path.resolve(import.meta.dirname);

// The release gate's database half. Unlike `pnpm test`, this config cannot report a
// pass for a machine that has no stack: `globalSetup` refuses to start the suites
// unless a loopback Supabase is configured and answering, so an absent environment
// fails the gate instead of thinning it. See tests/live-stack-guard.mjs.
export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "client", "src"),
    },
  },
  test: {
    environment: "node",
    include: databaseSuites,
    globalSetup: ["tests/live-stack-guard.mjs"],
    // Shared Postgres and one singleton offer row (`FOUNDER_V1`): Stage 3 asserts the
    // payment gate is closed while Stage 8 temporarily opens it. Parallel files turn
    // that into an order race. Measured on 27 files: 45.5s parallel, 101.7s serial.
    fileParallelism: false,
  },
});
