import path from "node:path";
import { defineConfig } from "vitest/config";
import { databaseSuites, hostedOnlySuites } from "./tests/suite-manifest";

const projectRoot = path.resolve(import.meta.dirname);

// The release gate's static half: everything that answers without opening a
// Supabase client. Because nothing here touches the shared database, files may run in
// parallel — which is why this is a separate config rather than a `--exclude` flag
// someone has to remember to pass.
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
    exclude: [...databaseSuites, ...hostedOnlySuites, "**/node_modules/**", "**/dist/**"],
  },
});
