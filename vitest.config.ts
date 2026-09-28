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
    // The live suites share one local Postgres and one singleton offer row
    // (`FOUNDER_V1`): Stage 3 asserts the payment gate is closed while Stage 8
    // temporarily opens it to exercise review flows. Parallel files turn that
    // into an order race, so files run one at a time. Cost is wall time only,
    // measured on 27 files: 45.5s parallel, 101.7s serial.
    fileParallelism: false,
  },
});
