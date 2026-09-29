import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// One definition of "the local stack this repository qualifies against is present",
// used by the vitest database half, the browser half and any operator who wants to ask
// the same question by hand: `node scripts/local-stack-check.mjs`.
//
// It exists because a suite that skips when its environment is missing produces the same
// exit code as a suite that passed, and a release gate cannot tell those apart. Here an
// absent, unreachable or non-loopback stack is an error with the remedy in the message.

const loopbackUrl = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/i;

function readEnvFile(projectRoot) {
  try {
    const values = {};
    for (const line of readFileSync(path.join(projectRoot, ".env.local"), "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    return values;
  } catch {
    return {};
  }
}

export async function assertLocalStack({ projectRoot = path.resolve(import.meta.dirname, ".."), probe = true } = {}) {
  const fileEnv = readEnvFile(projectRoot);
  const url = process.env.VITE_SUPABASE_URL ?? fileEnv.VITE_SUPABASE_URL ?? "";
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? fileEnv.VITE_SUPABASE_ANON_KEY ?? "";

  const fail = (problem, remedy) => {
    throw new Error(
      `Local Supabase stack check failed: ${problem}\n` +
        `  Suites that do not run are not a pass. ${remedy}\n` +
        `  See README.md ("Local Supabase development") for the ordered commands.`,
    );
  };

  if (!url || !anonKey) {
    fail(
      `VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not configured (url=${url || "unset"}).`,
      "Start the stack with `pnpm supabase:start`, then write the browser-safe values with `node scripts/local-supabase-env.mjs`.",
    );
  }
  // These suites create users, rewrite the single Founder offer row and purge fixture
  // accounts. Pointing them at anything but a disposable local stack would mutate a real
  // project, so the Stage 9 boundary is enforced in code rather than left to documentation.
  if (!loopbackUrl.test(url)) {
    fail(`${url} is not a loopback local stack URL.`, "This stage qualifies against a local Docker Supabase only.");
  }
  if (!probe) return { url, anonKey };

  let health;
  try {
    health = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    fail(`${url} did not answer (/auth/v1/health: ${error instanceof Error ? error.message : String(error)}).`, "Run `pnpm supabase:start` and wait for it to report the stack as started.");
  }
  if (!health.ok) {
    fail(`${url}/auth/v1/health answered ${health.status}.`, "Re-run `pnpm db:reset:local` if the containers are up but the schema is not replayed.");
  }
  return { url, anonKey, healthStatus: health.status };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/local-stack-check.mjs")) {
  try {
    const { url, healthStatus } = await assertLocalStack();
    console.log(`Local stack present and loopback-only: ${url} (Auth health ${healthStatus}).`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
