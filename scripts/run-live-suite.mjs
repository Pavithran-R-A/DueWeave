import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

// `pnpm test:live` includes the Arc 3C erasure battery, which calls `delete-account` over HTTP.
// `supabase db reset` — the first step of `verify:release:local` — removes the Edge runtime, so a
// serve started before the release command is gone by the time the battery runs. This wrapper
// starts the function after the reset and releases it even when a test fails, which is what makes
// the release command executable end to end on a clean host rather than one manual step short.
//
// If the start fails, nothing is stopped: the failure may be "a serve from this checkout is
// already running", and killing an operator's process is not this script's decision.

const root = path.resolve(import.meta.dirname, "..");
const serve = path.join(root, "scripts", "local-functions-serve.mjs");

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
}

const started = run(process.execPath, [serve, "start"]);
let status = started.status ?? 1;

if (started.status === 0) {
  try {
    const suite = run("pnpm", ["test:live"], { shell: process.platform === "win32" });
    status = suite.status ?? 1;
  } finally {
    const stopped = run(process.execPath, [serve, "stop"]);
    if (stopped.status !== 0) {
      console.error(`run-live-suite: releasing the function serve failed (exit ${stopped.status ?? "signal"})`);
      if (status === 0) status = stopped.status ?? 1;
    }
  }
}

process.exit(status);
