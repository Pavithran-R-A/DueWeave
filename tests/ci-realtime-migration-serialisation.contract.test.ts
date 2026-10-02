import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// D-S9-14: runs 23, 24 and 34 all died inside `Replay every committed migration`, and run 34 is
// the first one whose retained log names the cause. Its browser job, step `__self_2.__run_4`
// (duration_ms=19631):
//
//   10:04:25.30 Recreating database...
//   10:04:36.93 Initialising schema...
//   10:04:37.88 + sudo -E -u nobody /app/bin/migrate
//   10:04:40.71 ** (Ecto.ConstraintError) constraint error when attempting to insert struct:
//   10:04:40.71     * "schema_migrations_pkey" (unique_constraint)
//   10:04:41.98 error running container: exit 1
//
// A duplicate row in a migration ledger cannot come from one pass: a pass reads the recorded
// versions and inserts only the pending ones. Two sessions inserted the same version. Both
// exist by construction in the order this action runs: `Start the local Supabase stack` leaves
// DueWeave's realtime container running, and the replay's `Recreating database` drops the
// database out from under it, so the running container reconnects and migrates while the
// replay's own transient container migrates the same database. Measured in the current order:
// the live container's log inside one replay window carried a full 33-migration pass that
// started 19.2 s into the replay and finished 7.4 s before the replay's own `/app/bin/migrate`
// trace -- the two passes were serialised by timing luck, not by design. Forced on one scratch
// database with an empty ledger, simultaneous passes produce run 34's verbatim error in one of
// the two passes (exit 1) while the sequential pair both exit 0.
//
// The repair is to remove the second writer from the window rather than to outrun it: pause
// this checkout's own realtime container for the duration of the replay, then bring the stack
// back. Asserted here in both halves -- the container name the pause is built from, and the
// step order that makes it a serialisation rather than a coincidence.
const projectRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(projectRoot, "scripts", "local-realtime-pause.mjs");
const actionPath = path.join(projectRoot, ".github", "actions", "local-supabase", "action.yml");

/** Run the pause script with no docker access: `--dry-run` prints the command, never runs it. */
function run(args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

/** A synthetic checkout that declares the given project id (or none). */
function checkoutWithProjectId(projectId?: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dueweave-realtime-pause-"));
  mkdirSync(path.join(dir, "supabase"), { recursive: true });
  writeFileSync(
    path.join(dir, "supabase", "config.toml"),
    projectId === undefined ? "# no project id declared\n" : `project_id = "${projectId}"\n`,
    "utf8",
  );
  return dir;
}

describe("local realtime pause (D-S9-14)", () => {
  it("names the realtime container this checkout's own project id owns", () => {
    const { status, stdout } = run(["--dry-run", "stop"]);
    expect(stdout, `the pause did not resolve a container (exit ${String(status)}): ${stdout || ""}`).toBe(
      "docker stop -t 5 supabase_realtime_dueweave",
    );
    expect(status).toBe(0);
  });

  // The name is derived from the checkout, so a rebranded project id cannot quietly make the
  // pause a no-op that still reports success -- and cannot point at another project's container.
  it("derives the container from the declared project id rather than hard-coding it", () => {
    const dir = checkoutWithProjectId("otherproject");
    try {
      expect(run(["--dry-run", "stop", "--project-root", dir]).stdout).toBe(
        "docker stop -t 5 supabase_realtime_otherproject",
      );
      expect(run(["--dry-run", "start", "--project-root", dir]).stdout).toBe("docker start supabase_realtime_otherproject");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // This host runs other projects' Supabase stacks too (the shared-machine rule in ci.yml), so
  // the command has to address one exact container. A pattern would be a global docker
  // operation with the project's name on it.
  it("addresses one exact container and never a pattern", () => {
    for (const verb of ["stop", "start"]) {
      const command = run(["--dry-run", verb]).stdout;
      expect(command.startsWith("docker "), true);
      for (const forbidden of ["--filter", "--format", "*", "name=", "grep", "xargs"]) {
        expect(command, `${verb} would match more than this checkout's container: ${command}`).not.toContain(forbidden);
      }
    }
  });

  // Failing closed is the point: a container name guessed from a checkout that declares no
  // project id would either stop nothing (and the step would look green) or stop the wrong
  // thing.
  it("refuses to name a container when the checkout declares no project id", () => {
    const dir = checkoutWithProjectId(undefined);
    try {
      const { status, stdout } = run(["--dry-run", "stop", "--project-root", dir]);
      expect(status, "the pause guessed a container name").not.toBe(0);
      expect(stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown verb instead of defaulting to one", () => {
    expect(run(["--dry-run", "restart"]).status, "an unrecognised verb was accepted").not.toBe(0);
  });
});

describe("local-supabase action step order (D-S9-14)", () => {
  const steps = readFileSync(actionPath, "utf8").split(/\n(?= {4}- name:)/);
  const indexNamed = (fragment: string) => steps.findIndex((step) => step.startsWith(`    - name: ${fragment}`));
  const replay = indexNamed("Replay every committed migration");
  const pause = steps.findIndex((step) => /node scripts\/local-realtime-pause\.mjs stop/.test(step));
  const restore = steps.findIndex((step) => /node scripts\/local-realtime-pause\.mjs start/.test(step));

  it("pauses this checkout's realtime container before the replay that races it", () => {
    expect(replay, "the composite no longer replays the migrations in its own step").toBeGreaterThanOrEqual(0);
    expect(pause, "nothing pauses the live realtime container before the replay").toBeGreaterThanOrEqual(0);
    expect(pause, "the pause must happen before the replay it serialises").toBeLessThan(replay);
  });

  it("brings the stack back after the replay, so the suites still qualify against realtime", () => {
    expect(restore, "nothing restores the realtime container after the replay").toBeGreaterThanOrEqual(0);
    expect(restore, "the restore must happen after the replay").toBeGreaterThan(replay);
  });

  // The pause and restore exist only for the replay. Gating them on the same condition as the
  // replay means a caller that skips the replay (`reset: "false"`) also skips touching the stack,
  // and a replay that fails stops the sequence before anything is quietly restarted.
  it("gates the pause and the restore on the same condition as the replay", () => {
    const condition = /if: \$\{\{ inputs\.reset == 'true' \}\}/;
    expect(steps[replay], "the replay is no longer conditional on the reset input").toMatch(condition);
    expect(steps[pause], "the pause runs even when no replay was asked for").toMatch(condition);
    expect(steps[restore], "the restore runs even when no replay was asked for").toMatch(condition);
  });

  it("leaves the replay itself the gate D-S9-10 defined", () => {
    expect(steps[replay], "the replay no longer runs the committed-migration replay").toContain("pnpm db:reset:local --debug");
    expect(steps[replay], "the replay output no longer passes the credential filter").toContain(
      "scripts/redact-cli-secrets.mjs",
    );
    expect(steps[replay], "a failed replay could be reported green through the pipe").toMatch(/set -o pipefail/);
  });
});
