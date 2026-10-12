import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { releaseFlagBuildError } from "./client/src/lib/release-flags";

const projectRoot = path.resolve(import.meta.dirname);

export default defineConfig(({ command, mode }) => {
  // `loadEnv` is how Vite itself resolves the values a build inlines — mode-specific `.env*`
  // files, then `process.env` — so this is the same record the bundle is compiled from.
  const environment = loadEnv(mode, projectRoot, "VITE_");
  const flagError = releaseFlagBuildError(environment, { building: command === "build" });
  if (flagError) throw new Error(flagError);

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "client", "src"),
      },
    },
    envDir: projectRoot,
    root: path.resolve(projectRoot, "client"),
    publicDir: path.resolve(projectRoot, "client", "public"),
    build: {
      outDir: path.resolve(projectRoot, "dist"),
      emptyOutDir: true,
    },
  };
});
