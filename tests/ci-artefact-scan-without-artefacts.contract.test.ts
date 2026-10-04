import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// D-S9-15: run 34's browser job carried two red steps, and only one of them named the cause.
// The job failed at `Replay every committed migration` (D-S9-14), so Playwright never ran, so
// neither `test-results/` nor `playwright-report/` existed, so this step -- which exists to
// scan failure evidence before the platform uploads it -- reached the scanner with a directory
// it had never built:
//
//   node:fs:1630
//     const result = binding.readdir(
//   Error: ENOENT: no such file or directory, scandir '.../definitely-not-produced'
//       at walk (.../scripts/verify-secrets.mjs:91:7)
//
// A stack trace from a credential scanner reads like a credential was found, which is the
// opposite of what happened and sends a reviewer to the wrong file. The step is `if: always()`
// by design -- a failed journey is exactly the run whose artefacts need scanning -- so the
// repair belongs in the step, not in the scanner: ask whether the artefact exists, and say
// which of the two answers was taken.
//
// The scanner keeps its own behaviour, and PHASE 23's oracle depends on it. A `--dir` that names
// nothing is an error there, because "scanned nothing, therefore clean" is the failure mode a
// release gate cannot have; widening the scanner would make every scan quietly satisfiable. So
// the assertions below run the step's own command block against a scratch project: absence must
// not crash, and presence must still fail on a real finding.
const projectRoot = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(projectRoot, ".github", "workflows", "ci.yml");
const scanner = path.join(projectRoot, "scripts", "verify-secrets.mjs");

const stepName = "Scan artefacts before uploading them";

/** The `run:` body of the artefact-scan step, dedented exactly as Actions hands it to bash. */
function stepBody() {
  const lines = readFileSync(workflowPath, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  expect(start, `ci.yml no longer has a "${stepName}" step`).toBeGreaterThan(-1);
  const block = lines.findIndex((line, index) => index > start && line.trim() === "run: |");
  expect(block, `the "${stepName}" step no longer has a block run command`).toBeGreaterThan(-1);
  const indent = /^ */.exec(lines[block])![0].length + 2;
  const body: string[] = [];
  for (const line of lines.slice(block + 1)) {
    if (!line.trim()) {
      body.push("");
      continue;
    }
    if (!line.startsWith(" ".repeat(indent))) break;
    body.push(line.slice(indent));
  }
  return body.join("\n").trimEnd();
}

/**
 * A copy of the repository's scanner in a scratch project root, so the step's relative
 * `--dir test-results` resolves to a directory this test controls. `projectRoot` inside the
 * scanner is derived from its own location, so the copy is the same gate with the same rules.
 */
function scratchProject() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dueweave-artefact-scan-"));
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  copyFileSync(scanner, path.join(dir, "scripts", "verify-secrets.mjs"));
  return dir;
}

/** Run the workflow's own command block the way Actions does: `bash -e`, in the scratch project. */
function runStepBody(dir: string) {
  const script = path.join(dir, "step.sh");
  writeFileSync(script, stepBody(), { encoding: "utf8", mode: 0o755 });
  const result = spawnSync("bash", ["-e", script], { cwd: dir, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

describe("artefact scan without artefacts (D-S9-15)", () => {
  it("keeps the scanner itself strict about a directory it was told to scan", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "dueweave-scanner-strict-"));
    try {
      const result = spawnSync(process.execPath, [scanner, "--dir", path.join(dir, "never-produced")], {
        encoding: "utf8",
      });
      expect(result.status, "the scanner now reports success for a directory that does not exist").not.toBe(0);
      expect(result.stdout).not.toContain("No privileged credential found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still scans both artefact directories, on every outcome", () => {
    const body = stepBody();
    const lines = readFileSync(workflowPath, "utf8").split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
    expect(lines[start + 1].trim(), "the artefact scan no longer runs when the job failed").toBe(
      "if: ${{ always() }}",
    );
    for (const dir of ["test-results", "playwright-report"]) {
      expect(body, `the step no longer scans ${dir}`).toContain(`node scripts/verify-secrets.mjs --dir ${dir}`);
    }
  });

  it("reports which answer it took instead of crashing on the missing one", () => {
    const dir = scratchProject();
    try {
      const { status, output } = runStepBody(dir);
      // Run 34's shape: the journeys never ran, so nothing exists to scan. This must not be a
      // second red step with a Node stack trace in front of the real failure.
      expect(output, "the artefact scan reached the scanner with a directory that was never built").not.toContain(
        "ENOENT",
      );
      expect(status, `a run with no artefacts still failed the scan step: ${output}`).toBe(0);
      expect(output, "the step says nothing about the directories it skipped").toMatch(/test-results/);
      expect(output, "the step says nothing about the directories it skipped").toMatch(/playwright-report/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still fails, and says so, when an artefact directory exists and carries a finding", () => {
    const dir = scratchProject();
    try {
      // An environment file is a HARD finding whatever it holds (see the scanner's own comment),
      // and `.env.local` is precisely what a browser run can leave inside its output directory.
      mkdirSync(path.join(dir, "playwright-report"), { recursive: true });
      writeFileSync(path.join(dir, "playwright-report", ".env.local"), "generated by this test\n", "utf8");
      const { status, output } = runStepBody(dir);
      expect(status, "a credential-carrying artefact passed the guarded scan").toBe(1);
      expect(output).toContain("committed-env-file");
      // The absent half of the guard must not swallow the present half.
      expect(output, "the missing test-results directory masked the finding in the present one").not.toContain("ENOENT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Stage 9 limitation 4: `--dir` mode prints the default mode's closing sentence. Run 18's
// `browser` job therefore reported `No privileged credential found in the tracked tree or the
// built bundle` after scanning one file inside `test-results` -- a true statement about a tree it
// had not opened. The scan is real and the finding count is real; only the scope claim is wrong,
// which is precisely the kind of defect a reviewer stops reading for.
//
// The pair below is what keeps the first case from passing by accident. If the scanner dropped the
// sentence everywhere, `--dir` output would name no scope at all and a clean "scanned 1 file" line
// would read as though nothing needed saying. So the tracked-tree claim has to stay where it is
// true, and move where it is not.
describe("artefact scan scope reporting (limitation 4)", () => {
  const defaultModeClaim = "No privileged credential found in the tracked tree or the built bundle.";

  /**
   * The scratch copy, run the way CI runs it: from the project root, with a relative `--dir`.
   * The repository's own scanner derives its project root from its own location, so passing
   * `--dir test-results` to it would scan this working tree instead of the scratch one.
   */
  function runScanner(dir: string, args: string[]) {
    const result = spawnSync(process.execPath, [path.join(dir, "scripts", "verify-secrets.mjs"), ...args], {
      cwd: dir,
      encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  }

  it("names the directory it scanned when it was pointed at one", () => {
    const dir = scratchProject();
    try {
      mkdirSync(path.join(dir, "test-results"), { recursive: true });
      writeFileSync(path.join(dir, "test-results", "index.html"), "<html>the report</html>\n", "utf8");
      const { status, output } = runScanner(dir, ["--dir", "test-results"]);
      expect(status, `a clean artefact directory failed the scan: ${output}`).toBe(0);
      expect(output, "`--dir` mode still claims the tracked tree and the built bundle").not.toContain(defaultModeClaim);
      expect(output, "`--dir` mode does not say which directory it actually read").toContain("test-results");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says an artefact file is in the scanned directory, not that git tracks it", () => {
    const dir = scratchProject();
    try {
      mkdirSync(path.join(dir, "test-results"), { recursive: true });
      writeFileSync(path.join(dir, "test-results", ".env.local"), "generated by a browser run\n", "utf8");
      const { status, output } = runScanner(dir, ["--dir", "test-results"]);
      expect(status, "an environment file inside the scanned directory was not a finding").toBe(1);
      expect(output).toContain("committed-env-file");
      // Nothing here is tracked by git: the scratch project has no index at all, and a CI
      // artefact directory is untracked output by construction.
      expect(output, "the finding claims git tracking for a directory `--dir` mode never asked git about").not.toContain(
        "tracked by git",
      );
      expect(output, "the finding does not name the directory it came from").toContain("test-results");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the tracked-tree claim for the default mode, where it is true", () => {
    const dir = scratchProject();
    try {
      // The default mode lists its scope with `git ls-files`, so the scratch project needs an
      // index; nothing is committed and nothing outside this directory is touched.
      writeFileSync(path.join(dir, "README.md"), "tracked by this test\n", "utf8");
      for (const args of [["init", "-q"], ["add", "README.md"]]) {
        const git = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
        expect(git.status, `git ${args.join(" ")} failed in the scratch project: ${git.stderr}`).toBe(0);
      }
      const { status, output } = runScanner(dir, []);
      expect(status, `the default-mode scan failed on a clean scratch tree: ${output}`).toBe(0);
      expect(output, "the default mode no longer claims the scope it actually scans").toContain(defaultModeClaim);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
