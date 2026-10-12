import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

// The paused-bundle browser gate: build the deployable artifact with both release flags stated
// as `"false"`, then drive *that* artifact in a real browser.
//
// Two decisions live in this file rather than in a shell one-liner, and both are the reason the
// gate exists:
//
// 1. The flags are compile-time literals. A bundle is only "paused" if the build that produced it
//    said so, so the values a reviewer is owed are stated here in one place — and
//    `tests/release-flag-build.contract.test.ts` fails the static gate if this file ever stops
//    stating them. A workflow line like `VITE_X=false pnpm build` would also be unrunnable from
//    Windows `cmd`, which is why `scripts/run-e2e.mjs` exists for the other half.
// 2. The artifact is built into `dist-paused/`, never over `dist/`. The local battery serves
//    `dist/`, and a gate that read whichever build last wrote a directory would be measuring a
//    decision nobody made.
//
// The Supabase endpoint and publishable key are the ones production inlines, so the bundle under
// test is byte-comparable to what `https://dueweave.pages.dev` serves. No request using them
// ever leaves the browser: `e2e-paused/release-flags.spec.ts` intercepts every non-loopback URL
// and fails if one escapes.
//
// Usage:
//   node scripts/run-paused-e2e.mjs                 # build, then the whole paused gate
//   node scripts/run-paused-e2e.mjs --skip-build    # drive the bundle that is already there
//   node scripts/run-paused-e2e.mjs release-flags   # a Playwright title filter

const projectRoot = path.resolve(import.meta.dirname, "..");
const pausedDist = path.join(projectRoot, "dist-paused");
const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const cliEntry = path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js");
const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const playwrightArgs = args.filter((arg) => arg !== "--skip-build");

for (const [label, file] of [["vite", viteBin], ["the Playwright CLI", cliEntry]]) {
  if (!existsSync(file)) {
    console.error(`${label} is not installed. Run \`pnpm install --frozen-lockfile\` first.`);
    process.exit(1);
  }
}

if (!skipBuild) {
  // `../dist-paused` because Vite resolves `--outDir` against its `root`, which is `client/`:
  // this is the path that lands next to `dist/`, and the preview server in
  // `playwright.paused-bundle.config.ts` names the same one.
  const build = spawnSync(process.execPath, [viteBin, "build", "--outDir", "../dist-paused"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_SUPABASE_URL: "https://ugzdqcytouwfdlcjujqv.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_K4Vj0A_c_t_OhKjBTt7EwA_g4OuQ-h4",
      // The pair production serves today: confirmation-email delivery is not qualified on the
      // hosted project, so registration and password recovery stay closed in the deployable
      // bundle until the hosted end-to-end journeys pass.
      VITE_PUBLIC_SIGNUP_ENABLED: "false",
      VITE_AUTH_EMAIL_ENABLED: "false",
    },
  });
  if (build.status !== 0) {
    console.error("The paused bundle did not build, so there is nothing honest for this gate to drive.");
    process.exit(build.status ?? 1);
  }
}

if (!existsSync(path.join(pausedDist, "index.html"))) {
  console.error(`There is no paused bundle at dist-paused/. Drop --skip-build and let this script build it.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [cliEntry, "test", "--config=playwright.paused-bundle.config.ts", ...playwrightArgs], {
  cwd: projectRoot,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
