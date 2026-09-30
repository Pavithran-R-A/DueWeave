import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// D-S9-7: the start-up banner the Supabase CLI prints carries the stack's freshly generated
// privileged key, and the step that launches it piped that banner straight to stdout. On a
// self-hosted runner stdout *is* the job log GitHub retains, so run 36555102272's `database`
// (10:25:45Z) and `browser` (10:32:44Z) logs each carried one `sb_secret_…` value. Nothing
// committed was leaked — the scanner over the tracked tree stays green — but a retained log is
// readable by anyone the repository gives Actions access to, and a self-hosted stack regenerates
// the same keys across jobs, so this is the same class of finding the credential gate exists to
// stop. The repair is a filter between the CLI and the log, asserted here.
const root = path.resolve(import.meta.dirname, "..");
const redactor = path.join(root, "scripts", "redact-cli-secrets.mjs");
const scanner = path.join(root, "scripts", "verify-secrets.mjs");
const actionPath = path.join(root, ".github", "actions", "local-supabase", "action.yml");

// Shapes assembled at runtime, never written as literals: `verify-secrets.mjs` treats a
// privileged credential in a tracked file as a HARD finding no allowlist can excuse, so this
// suite would fail the very gate it is testing if it spelled them out.
const secretKey = ["sb", "secret", "LocalStackKeyWithTheObservedShapeButNotReal"].join("_");
const publishableKey = ["sb", "publishable", "LocalStackKeyWithTheObservedShapeButNotReal"].join("_");
const signedToken = (role: string, signature: string) => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [encode({ alg: "HS256", typ: "JWT" }), encode({ role, iss: "supabase" }), signature.repeat(15)].join(".");
};
const serviceRoleToken = signedToken("service_role", "a");
const anonToken = signedToken("anon", "b");
const databaseUrl = ["postgres://postgres:", "LocalStackDbPassword", "@127.0.0.1:54322/postgres"].join("");

// The lines the run-18 logs actually showed, in the shape they arrive in.
const banner = [
  "│ 🔑 API URL      │ http://127.0.0.1:54321/rest/v1 │",
  "│ 🔑 Authentication Keys │",
  `│ Publishable     │ ${publishableKey} │`,
  `│ Secret          │ ${secretKey} │`,
  `│ URL             │ ${databaseUrl} │`,
  `│ Legacy JWT      │ ${serviceRoleToken} │`,
  `│ Anon JWT        │ ${anonToken} │`,
].join("\n");

function redact(input: string) {
  const result = spawnSync(process.execPath, [redactor], { input, encoding: "utf8" });
  expect(result.status, `the redactor exited ${String(result.status)}: ${result.stderr}`).toBe(0);
  return result.stdout;
}

/** This repository's own secret gate, aimed at one temporary file holding `text`. */
function gateExitCode(text: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dueweave-redaction-"));
  try {
    writeFileSync(path.join(dir, "job-log.txt"), text, "utf8");
    return spawnSync(process.execPath, [scanner, "--dir", dir], { encoding: "utf8" }).status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("CI log credential redaction", () => {
  it("carries the privileged shapes the secret gate refuses, before redaction", () => {
    // Without this the suite could pass by feeding the redactor nothing, and a filter that
    // masks no shape is exactly as useful as no filter at all.
    expect(gateExitCode(banner), "the fixture is not credential-bearing, so nothing below is proved").toBe(1);
  });

  it("masks every privileged shape in the CLI's start-up output", () => {
    expect(gateExitCode(redact(banner)), "a privileged shape survived the redactor").toBe(0);
  });

  it("masks the value and keeps the line, so the log still says a key existed", () => {
    const output = redact(banner);
    expect(output).not.toContain(secretKey);
    expect(output).not.toContain(serviceRoleToken);
    expect(output).not.toContain(databaseUrl);
    expect(output).toMatch(/Secret\s+│/);
    expect(output).toContain("[redacted-");
  });

  it("leaves the browser-safe values a reviewer needs to read the log", () => {
    const output = redact(banner);
    // `anon`/publishable keys ship in the bundle by design (see credential-boundary's own
    // exception), and dropping them would turn a diagnosable stack failure into a blank step.
    for (const kept of [publishableKey, anonToken, "http://127.0.0.1:54321/rest/v1"]) {
      expect(output).toContain(kept);
    }
    // The host and port of the database line are the diagnosis; only the credential goes.
    expect(output).toContain("127.0.0.1:54322/postgres");
  });

  it("runs the stack start through the filter without losing its exit code", () => {
    const action = spawnSync(process.execPath, [redactor], { input: "", encoding: "utf8" });
    expect(action.status, "the redactor must not fail on empty input").toBe(0);

    const steps = readFileSync(actionPath, "utf8").split(/\n(?= {4}- name:)/);
    // A line that *executes* the start command, not prose that mentions it: the action's
    // comment about the developer's own `pnpm supabase:start` is not a second leak path.
    const start = steps.filter((step) => /^[ \t]+pnpm supabase:start\s/m.test(step));
    expect(start.length, "the local-supabase action no longer starts the stack in exactly one step").toBe(1);
    expect(start[0], "the stack start step reaches the job log unredacted").toContain("scripts/redact-cli-secrets.mjs");
    expect(start[0], "both CLI streams have to pass the filter, not just stdout").toContain("2>&1");
    // `bash -e` alone does not look at the left side of a pipe: without pipefail a stack that
    // failed to start would exit 0 because the filter succeeded, and the job would run its
    // suites against nothing.
    expect(start[0], "redaction must not turn a failed stack start into a green step").toMatch(/set -o pipefail/);
  });

  // D-S9-10: the replay step is the second CLI invocation in this action, and the one runs 23 and
  // 24 died in. It now runs with the CLI's own `--debug`, which multiplies the lines that reach a
  // retained log, so the same three properties are pinned for it too instead of for one step.
  it("runs the migration replay through the same filter without losing its exit code", () => {
    const steps = readFileSync(actionPath, "utf8").split(/\n(?= {4}- name:)/);
    // Selected by its own step name, because a `run:` written on one line has no indented command
    // line for a shape regex to find — the whole point is that this block reaches the log.
    const replay = steps.find((step) => step.startsWith("    - name: Replay every committed migration"));
    expect(replay, "the local-supabase action no longer replays the migrations in its own step").toBeDefined();
    expect(replay, "the replay step must still run the committed-migration replay itself").toContain(
      "pnpm db:reset:local",
    );
    expect(replay, "the migration replay step reaches the job log unredacted").toContain(
      "scripts/redact-cli-secrets.mjs",
    );
    expect(replay, "both CLI streams have to pass the filter, not just stdout").toContain("2>&1");
    expect(replay, "redaction must not turn a failed migration replay into a green step").toMatch(
      /set -o pipefail/,
    );
  });
});
