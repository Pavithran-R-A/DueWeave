import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

// Arc 3C, row U of `docs/RELEASE_GATE_MATRIX.md`: the STEP 6 erasure battery calls `delete-account`
// over HTTP, so `pnpm test:live` needs this project's Edge Function served next to the database. No
// CI job did that, which is why the row could never be executed by a workflow — only its two static
// contract suites ever reached GitHub. Three properties make that a script rather than a `run:` line:
//
//   1. `supabase functions serve` is a foreground watcher, so a step that ran it would never end.
//      The process is detached, its pid lives in `supabase/.temp` (the directory the CLI already owns
//      for this checkout, and which `.gitignore` already covers), and `stop` is what an
//      `if: always()` teardown calls. A job that failed before `start` has no pid file, and that is
//      not an error.
//   2. Serving is not the same as being configured. Measured on 2026-10-06: the stack came up at
//      10:12:41Z and this project's `supabase_edge_runtime_dueweave` container was created at
//      10:35:45Z by the serve, so the CLI recreates that container to apply `--env-file`. The
//      endpoint answers 501 until `ALLOWED_APP_ORIGIN` reaches the runtime
//      (`supabase/functions/delete-account/contract.ts:94`), so readiness cannot be "the port
//      opened" — it has to be the answer only a served *and* configured runtime gives: 401 for a
//      caller that sent no token. The poll is bounded and fails loudly, because a fixed sleep would
//      pass a stack that never came up and a retry would hide a refusal.
//   3. Nothing here prints a privileged value. The CLI's serve banner carries this stack's generated
//      service-role key (D-S9-7), so that output goes to the gitignored log file and any tail this
//      script echoes is piped through `scripts/redact-cli-secrets.mjs` first.
//
// Targeting is by exact container name, derived from this checkout's declared project id — no
// pattern, no filter, no guessed default — because this host also runs another project's stack, and
// stopping the wrong container would be damage rather than cleanup.

const functionName = "delete-account";
const allowedOriginVar = "ALLOWED_APP_ORIGIN";
// The local app origin: the port `vite` and the Playwright suites both drive. Deliberately the only
// value this script is willing to invent, and it is not a credential — it is the origin the
// endpoint compares a browser's `Origin` header against.
const defaultAllowedOrigin = "http://127.0.0.1:3000";
const readinessDeadlineMs = 90_000;
const pollIntervalMs = 500;
const stopDeadlineMs = 15_000;
// Both ceilings below exist because this host's Docker CLI stops answering while the stack it manages
// keeps answering HTTP. Measured here: `docker ps` exit 124 at 15 s having printed 0 bytes, and the
// same call inside an unbounded `spawnSync` leaving `stop` with no verdict after 45 s. A cleanup step
// that hangs is worse than one that fails — a CI job would sit in it until its own 40-minute timeout
// and report nothing about the gate it was standing for.
const dockerListCeilingMs = 20_000;
const dockerStopCeilingMs = 90_000;

const projectRoot = { value: path.resolve(import.meta.dirname, "..") };

function parse(argv) {
  const verbs = [];
  const flags = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--dry-run" || token === "--project-root") {
      flags.push(token);
      if (token === "--project-root") projectRoot.value = path.resolve(argv[++i] ?? "");
    } else {
      verbs.push(token);
    }
  }
  return { dryRun: flags.includes("--dry-run"), verb: verbs[0], unexpected: verbs.slice(1) };
}

function readProjectId(root) {
  const text = readFileSync(path.join(root, "supabase", "config.toml"), "utf8");
  return /^\s*project_id\s*=\s*"([^"]+)"\s*$/m.exec(text)?.[1];
}

const { dryRun, verb, unexpected } = parse(process.argv.slice(2));
const fail = (problem) => {
  console.error(`local-functions-serve: ${problem}`);
  process.exit(1);
};

if (unexpected.length > 0) fail(`unexpected argument(s): ${unexpected.join(" ")}`);
if (verb !== "start" && verb !== "stop") fail(`unknown verb ${verb ?? "(none)"}; expected \`start\` or \`stop\`.`);

const root = projectRoot.value;
let projectId;
try {
  projectId = readProjectId(root);
} catch (error) {
  fail(`could not read ${root}/supabase/config.toml: ${error.message}`);
}
if (!projectId) fail(`no project_id declared in ${root}/supabase/config.toml.`);

const edgeContainer = `supabase_edge_runtime_${projectId}`;
const cliEntry = path.join(root, "node_modules", "supabase", "dist", "supabase.js");
const envFile = path.join(root, "supabase", "functions", ".env");
const tempDir = path.join(root, "supabase", ".temp");
const pidFile = path.join(tempDir, "functions-serve.pid");
const logFile = path.join(tempDir, "functions-serve.log");
const redactor = path.join(root, "scripts", "redact-cli-secrets.mjs");
const serveArgs = ["functions", "serve", functionName, "--env-file", envFile];

function readLocalEnv(name) {
  const file = path.join(root, ".env.local");
  if (!existsSync(file)) return undefined;
  return new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(file, "utf8"))?.[1]?.trim();
}

const apiUrl = (readLocalEnv("VITE_SUPABASE_URL") ?? "").replace(/\/+$/, "");
const anonKey = readLocalEnv("VITE_SUPABASE_ANON_KEY") ?? "";

function isLoopback(value) {
  if (!value) return false;
  const host = new URL(value).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

// The same loopback rule `local-stack-check.mjs` and `local-supabase-env.mjs` enforce: this script
// exists to serve this checkout's local function code, so a target that is not the local stack is
// refused rather than probed.
function assertLoopbackTarget() {
  if (!apiUrl || !anonKey) {
    fail(".env.local did not yield an API URL and anon key. Run `node scripts/local-supabase-env.mjs` first (the local-supabase action does).");
  }
  if (!isLoopback(apiUrl)) fail(`refusing to target ${apiUrl}: it is not a loopback local stack URL.`);
}

async function probe() {
  try {
    const reply = await fetch(`${apiUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      // No bearer token: an erasure is impossible from here, which is what makes a readiness probe
      // of this endpoint safe to run on a shared stack.
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    });
    return { result: classify(reply.status, await reply.text()) };
  } catch (error) {
    return { result: `unreachable(${error.name === "TimeoutError" ? "timeout" : error.cause?.code ?? error.code ?? error.message})` };
  }
}

function classify(status, text) {
  if (status === 401 && /sign in/i.test(text)) return "served";
  if (status === 501) return "unconfigured";
  if (status === 404) return "not-mounted";
  if (status === 502 || status === 503) return `gateway-${status}`;
  return `unexpected-${status}`;
}

function redactedLogTail(lines = 40) {
  if (!existsSync(logFile)) return "(no serve log was written)";
  const content = readFileSync(logFile, "utf8").split("\n").slice(-lines).join("\n");
  const filtered = spawnSync(process.execPath, [redactor], { input: `${content}\n`, encoding: "utf8" });
  return filtered.status === 0 ? filtered.stdout : "(the serve log could not be redacted, so it is not printed)";
}

async function start() {
  if (!existsSync(path.join(root, "supabase", "functions", functionName, "index.ts"))) {
    fail(`supabase/functions/${functionName}/index.ts does not exist in ${root}.`);
  }
  if (existsSync(pidFile)) {
    const stale = Number(readFileSync(pidFile, "utf8").trim());
    if (stale && isAlive(stale)) fail(`already serving ${functionName} from this checkout (pid ${stale}). Run \`stop\` first.`);
    rmSync(pidFile, { force: true });
  }
  assertLoopbackTarget();

  if (dryRun) {
    console.log(`${process.execPath} ${[cliEntry, ...serveArgs].join(" ")}`);
    console.log(`env file: ${envFile} (created with ${allowedOriginVar}=${defaultAllowedOrigin} if absent); log: ${logFile}; pid: ${pidFile}`);
    console.log(`ready when POST ${apiUrl}/functions/v1/${functionName} answers 401 for a caller with no token`);
    return;
  }

  if (!existsSync(envFile)) {
    // Names only, and only the one this script knows the local value of. The CLI injects
    // SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY into the runtime container itself,
    // so no privileged value is ever written to this file.
    writeFileSync(
      envFile,
      `# Written by scripts/local-functions-serve.mjs for \`supabase functions serve\` against the local\n` +
        `# stack. Gitignored. Add no credential here: the three SUPABASE_* values the function reads are\n` +
        `# injected by the CLI, and a real key in this file is a leak. See .env.example for the names.\n` +
        `${allowedOriginVar}=${defaultAllowedOrigin}\n`,
      "utf8",
    );
    console.log(`wrote ${path.relative(process.cwd(), envFile)} containing ${allowedOriginVar} only`);
  }

  const logFd = openSync(logFile, "w");
  const child = spawn(process.execPath, [cliEntry, ...serveArgs], {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  if (!child.pid) fail(`the CLI could not be spawned; see ${logFile}`);
  writeFileSync(pidFile, `${child.pid}\n`, "utf8");
  child.unref();
  console.log(`serving ${functionName} from ${root} (pid ${child.pid})`);

  const startedAt = Date.now();
  let last = "not-probed";
  while (Date.now() - startedAt < readinessDeadlineMs) {
    const { result } = await probe();
    last = result;
    if (result === "served") {
      console.log(`${functionName} is served and ${allowedOriginVar} reached the runtime (${Date.now() - startedAt} ms, ${edgeContainer} recreated by the serve})`);
      return;
    }
    if (result === "unconfigured") {
      console.error(`the runtime answered 501: ${allowedOriginVar} did not reach the container.`);
      console.error(`check ${envFile} and that nothing reused an older ${edgeContainer}. Redacted log:`);
      console.error(redactedLogTail());
      fail(`served but unconfigured after ${Date.now() - startedAt} ms`);
    }
    await sleep(pollIntervalMs);
  }
  console.error(`no served answer inside ${readinessDeadlineMs} ms (last probe: ${last}). Redacted log:`);
  console.error(redactedLogTail());
  fail(`readiness deadline reached. \`docker logs ${edgeContainer}\` and the log above are the diagnosis.`);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runDocker(args, ceilingMs, { inherit = false } = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: ceilingMs,
    ...(inherit ? { stdio: "inherit" } : {}),
  });
  if (result.status !== 0) {
    const why =
      result.error?.code === "ETIMEDOUT" || result.status === null
        ? `did not answer within ${ceilingMs} ms${result.signal ? ` (${result.signal})` : ""}`
        : `exited ${result.status}: ${(result.stderr ?? "").trim().slice(0, 200)}`;
    fail(
      `\`docker ${args.join(" ")}\` ${why}. The watcher this checkout recorded has already been terminated and its pid file removed, so only the ${edgeContainer} container may still be running. This is a blocked release gate, not a passed or failed product claim: the Docker CLI on this host stops answering while the stack itself keeps serving HTTP.`,
    );
  }
  return result;
}

async function stop() {
  const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) : 0;
  if (dryRun) {
    console.log(`${pid ? `kill ${pid} (if alive)` : "no pid file — nothing to terminate"}`);
    console.log(`docker stop ${edgeContainer} (if running)`);
    return;
  }
  if (pid && isAlive(pid)) {
    process.kill(pid, "SIGTERM");
    const startedAt = Date.now();
    while (isAlive(pid) && Date.now() - startedAt < 5_000) await sleep(200);
    if (isAlive(pid)) {
      process.kill(pid, "SIGKILL");
      console.log(`terminated the ${functionName} watcher (pid ${pid}) with SIGKILL after 5 s`);
    } else {
      console.log(`terminated the ${functionName} watcher (pid ${pid})`);
    }
  } else {
    console.log(`no ${functionName} watcher pid recorded for this checkout — nothing to terminate`);
  }
  rmSync(pidFile, { force: true });

  const running = runDocker(["ps", "--format", "{{.Names}}"], dockerListCeilingMs);
  if (running.stdout.split("\n").includes(edgeContainer)) {
    runDocker(["stop", "-t", "5", edgeContainer], dockerStopCeilingMs, { inherit: true });
    console.log(`stopped ${edgeContainer}`);
  } else {
    console.log(`${edgeContainer} is not running — the stack never served a function`);
    return;
  }

  // Prove the release rather than hope for it, but only when this checkout still knows its local
  // stack: an `if: always()` teardown also runs after a job that died before `.env.local` was ever
  // written, and a cleanup step must not make a job red for the wrong reason.
  if (!isLoopback(apiUrl) || !anonKey) {
    console.log(`${edgeContainer} released; endpoint re-probe skipped (this checkout has no loopback .env.local)`);
    return;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < stopDeadlineMs) {
    const { result } = await probe();
    if (result !== "served" && result !== "unconfigured") {
      console.log(`${functionName} no longer answers (${result}) after ${Date.now() - startedAt} ms`);
      return;
    }
    await sleep(pollIntervalMs);
  }
  fail(`${edgeContainer} stopped but ${apiUrl}/functions/v1/${functionName} still answers as served`);
}

try {
  await (verb === "start" ? start() : stop());
} catch (error) {
  fail(error.message);
}
