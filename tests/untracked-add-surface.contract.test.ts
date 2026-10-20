import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Stage A of the consumer-live arc measured what one careless `git add -A` would have staged at
// head `4d82978`: eight untracked, non-ignored repository-root artifacts — 2.5 MB of mailbox
// contents and QA identity files under `p3c-red-baseline/`, 1.4 MB of production row counts under
// `prod-census/`, two CI job-log dumps, a Playwright report, a database probe and two loose
// scratch drivers.
//
// The release already had a credential scanner for that tree, and it read none of it.
// `scripts/verify-secrets.mjs` lists its scope with `git ls-files`, which answers "what does the
// index know", never "what would the next `git add -A` make the index know". So the exact surface
// a `git add -A` touches was the exact surface no gate looked at — and a gate that cannot see a
// file cannot fail on it.
//
// Two properties are asserted here, one per half of the repair:
//   1. the scanner's default scope includes the untracked, non-ignored files, i.e. the staging
//      surface itself, and still honours `.gitignore` so ignored evidence is not silently scanned
//      *and* silently excused;
//   2. a repository root carrying loose untracked artifacts fails the release, so new evidence
//      lands either committed (reviewed) or ignored-with-a-name (never staged by accident),
//      never merely present.
//
// The scratch-project cases exist because a contract that only reads this repository's current
// state proves the state, not the rule: every behaviour below is exercised against a tree the
// test builds and tears down.
const projectRoot = path.resolve(import.meta.dirname, "..");
const hygieneScript = path.join(projectRoot, "scripts", "verify-untracked-hygiene.mjs");
const workflowPath = path.join(projectRoot, ".github", "workflows", "ci.yml");

const scripts = (
  JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

/**
 * Evidence the hosted instruments write into the repository root. Each one is kept on disk as the
 * release record and must never be stageable, so each needs its own root-anchored rule — a rule
 * that could also match a source directory elsewhere in the tree is exactly the broad ignore
 * pattern this brief forbids.
 */
const evidenceDirectories = [
  "p3c-red-baseline",
  "prod-census",
  "hosted-db-probe",
  "live-playwright-report",
  "6ab1d2b-ci-logs",
  "c105edc-ci-logs",
];

/**
 * A hard-rule shape that is not a credential: the PEM frame, with no key material. The header is
 * assembled rather than written out, which is what the scanner's own rule source does with its
 * pattern (`-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----` cannot match itself) — `private-key-block`
 * is a HARD rule, so it is deliberately not excusable by an allowlist entry, and this file has no
 * business carrying a PEM header on a line. The scratch file the cases below write *does* carry the
 * assembled frame, and that is what the scan has to catch.
 */
const inertPrivateKeyFrame = ["-----BEGIN", "PRIVATE KEY-----"].join(" ") + "\nnot-a-key-instrument-fixture\n";

/**
 * The release records that may still *describe* the retired QA identity path. Anywhere else in the
 * tree that path would be an instruction pointing at a file which cannot be read, so the list is
 * short and each member is checked below both for retirement language and for still earning its
 * place on the list.
 */
const historyDocs = ["docs/CONSUMER_LIVE_PROGRESS.md", "docs/SECURITY_MODEL.md"];

/**
 * This file, by the name git knows it by. A scan that searches for a literal string always finds
 * that literal in the source that searches for it, so the file holding the rule is a named carrier
 * like the history records — and it is named here rather than excused by a match on the pattern's
 * own shape, because a rule that denies its existence turns the gate into the failure it reports.
 * Measured: CI run `39379577996` failed exactly this way at head `e9759a5`, after the commit put
 * this file into `git ls-files` — the case had passed locally only while the file was still untracked.
 */
const pointerRuleFile = path.relative(projectRoot, import.meta.filename).split(path.sep).join("/");

/** Every tracked file allowed to carry the retired path, and why each earns its place. */
const namedCarriers = [...historyDocs, pointerRuleFile];

function scratchRepository(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "untracked-surface-"));
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    expect(result.status, `git ${args.join(" ")} failed in the scratch project: ${result.stderr}`).toBe(0);
  };
  git(["init", "-q"]);
  return dir;
}

/** Copy a repository script into a scratch project root so its derived projectRoot is the scratch tree. */
function copyInto(dir: string, relative: string): string {
  const target = path.join(dir, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(path.join(projectRoot, relative), "utf8"), "utf8");
  return target;
}

function run(file: string, args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function isIgnored(dir: string, target: string): boolean {
  return spawnSync("git", ["check-ignore", "-q", "--", target], { cwd: dir, encoding: "utf8" }).status === 0;
}

describe("The git add -A surface is a release gate", () => {
  it("scans the untracked, non-ignored files a `git add -A` would stage", () => {
    const dir = scratchRepository();
    try {
      writeFileSync(path.join(dir, "README.md"), "tracked by this test\n", "utf8");
      spawnSync("git", ["add", "README.md"], { cwd: dir, encoding: "utf8" });

      writeFileSync(path.join(dir, "qa-mailbox.txt"), inertPrivateKeyFrame, "utf8");
      const { status, output } = run(copyInto(dir, "scripts/verify-secrets.mjs"), [], dir);
      expect(
        status,
        "a credential-shaped file that `git add -A` would stage passed the scan: " + output,
      ).toBe(1);
      expect(output, "the finding does not name the untracked file it came from").toContain("qa-mailbox.txt");
      expect(output, "the finding does not name the rule that fired").toContain("private-key-block");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says the scope it actually read, instead of claiming only tracked material", () => {
    const dir = scratchRepository();
    try {
      writeFileSync(path.join(dir, "README.md"), "tracked by this test\n", "utf8");
      spawnSync("git", ["add", "README.md"], { cwd: dir, encoding: "utf8" });
      const { status, output } = run(copyInto(dir, "scripts/verify-secrets.mjs"), [], dir);
      expect(status, `a clean scratch tree failed the scan: ${output}`).toBe(0);
      expect(
        output,
        "the scanner claims a scope that excludes the untracked files `git add -A` stages",
      ).toContain("the tracked tree, the untracked files a `git add -A` would stage, and the built bundle");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still honours .gitignore, so a rule is a real boundary rather than a quieter scan", () => {
    const dir = scratchRepository();
    try {
      writeFileSync(path.join(dir, "README.md"), "tracked by this test\n", "utf8");
      spawnSync("git", ["add", "README.md"], { cwd: dir, encoding: "utf8" });
      writeFileSync(path.join(dir, ".gitignore"), "/evidence/\n", "utf8");
      mkdirSync(path.join(dir, "evidence"));
      writeFileSync(path.join(dir, "evidence", "qa-mailbox.txt"), inertPrivateKeyFrame, "utf8");
      const { status, output } = run(copyInto(dir, "scripts/verify-secrets.mjs"), [], dir);
      expect(status, `an ignored evidence directory was staged-surface material: ${output}`).toBe(0);
      expect(isIgnored(dir, "evidence/qa-mailbox.txt"), "the scratch rule did not ignore the probe file").toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails loudly when it cannot read the tree, instead of passing an unknown state", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "not-a-repository-"));
    try {
      copyInto(dir, "scripts/verify-secrets.mjs");
      const { status, output } = run(path.join(dir, "scripts", "verify-secrets.mjs"), [], dir);
      expect(status, `a tree git cannot answer for passed the scan: ${output}`).toBe(1);
      expect(output.toLowerCase(), "the failure does not say git was the problem").toContain("git");

      const hygiene = run(copyInto(dir, "scripts/verify-untracked-hygiene.mjs"), [], dir);
      expect(hygiene.status, `a tree git cannot answer for passed the hygiene gate: ${hygiene.output}`).toBe(1);
      expect(hygiene.output.toLowerCase(), "the hygiene failure does not say git was the problem").toContain("git");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names every loose artifact when the root is untidy, and passes once each is committed or ignored", () => {
    const dir = scratchRepository();
    try {
      writeFileSync(path.join(dir, "README.md"), "tracked by this test\n", "utf8");
      spawnSync("git", ["add", "README.md"], { cwd: dir, encoding: "utf8" });
      // The gate, committed: an untracked `scripts/` really is a loose root directory, so a
      // scratch tree that had not committed its own tool would be right to report it.
      const gateScript = copyInto(dir, "scripts/verify-untracked-hygiene.mjs");
      spawnSync("git", ["add", "scripts"], { cwd: dir, encoding: "utf8" });
      mkdirSync(path.join(dir, "prod-census"));
      writeFileSync(path.join(dir, "prod-census", "before.json"), "{}\n", "utf8");
      writeFileSync(path.join(dir, "_scratch_driver.mjs"), "export const x = 1;\n", "utf8");

      const gate = run(gateScript, [], dir);
      expect(gate.status, `a loose root artifact passed the hygiene gate: ${gate.output}`).toBe(1);
      expect(gate.output, "the gate does not name the loose file").toContain("_scratch_driver.mjs");
      expect(gate.output, "the gate does not name the loose directory").toContain("prod-census/");

      // Tracked, exactly as this repository's own rule file is: an unstaged `.gitignore` would be
      // a loose root artifact of its own and the gate would be right to report it.
      writeFileSync(path.join(dir, ".gitignore"), "/prod-census/\n", "utf8");
      spawnSync("git", ["add", ".gitignore"], { cwd: dir, encoding: "utf8" });
      const partial = run(path.join(dir, "scripts", "verify-untracked-hygiene.mjs"), [], dir);
      expect(partial.status, `an ignored directory still failed the gate: ${partial.output}`).toBe(1);
      expect(partial.output, "the gate stopped naming the entry it repaired").toContain("_scratch_driver.mjs");
      expect(partial.output, "the gate still reports a path the scratch rule now ignores").not.toContain("prod-census");

      rmSync(path.join(dir, "_scratch_driver.mjs"), { force: true });
      const clean = run(path.join(dir, "scripts", "verify-untracked-hygiene.mjs"), [], dir);
      expect(clean.status, `a tidy scratch root failed the gate: ${clean.output}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is launched by the release and by CI, and written down in the gate matrix", () => {
    expect(existsSync(hygieneScript), `${hygieneScript} does not exist`).toBe(true);
    expect(scripts["verify:hygiene"], "package.json has no `verify:hygiene` script").toBe(
      "node scripts/verify-untracked-hygiene.mjs",
    );
    expect(scripts["verify:release:local"], "the release does not run the hygiene gate").toContain("pnpm verify:hygiene");
    const workflow = readFileSync(workflowPath, "utf8");
    expect(
      [...workflow.matchAll(/^\s*run:\s*(.+)$/gm)].map((match) => match[1].trim()),
      "ci.yml never launches the hygiene gate, so whatever it proves is laptop-only",
    ).toContain("pnpm verify:hygiene");
    const matrix = readFileSync(path.join(projectRoot, "docs", "RELEASE_GATE_MATRIX.md"), "utf8");
    expect(matrix, "the gate matrix does not document `pnpm verify:hygiene`").toContain("pnpm verify:hygiene");
  });

  it("passes on this working tree: the root carries no untracked, non-ignored artifact", () => {
    const { status, output } = run(hygieneScript, [], projectRoot);
    expect(status, `the repository root carries loose artifacts again:\n${output}`).toBe(0);
  });

  it("ignores each evidence directory by name, anchored to the repository root", () => {
    // Read as lines, not as one substring: the working tree is checked out with CRLF endings on
    // this host, and a pattern that searches for `/name/\n` in that file only passes by accident.
    const gitignoreLines = readFileSync(path.join(projectRoot, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim());
    for (const directory of evidenceDirectories) {
      expect(
        gitignoreLines,
        `.gitignore has no rule for ${directory}/ that is anchored to the repository root`,
      ).toContain(`/${directory}/`);
      expect(isIgnored(projectRoot, `${directory}/sample-evidence.json`), `${directory}/ is not ignored`).toBe(true);
    }
    // The list is the contract: a rule added for a directory no instrument writes is a rule that
    // will outlive its reason, and a directory the instruments still write that lost its rule is
    // one `git add -A` away from the repository.
    expect(evidenceDirectories.length, "the evidence list is empty — the scan is vacuous").toBeGreaterThan(3);
  });

  it("leaves no live pointer at a repository credential path that no longer exists", () => {
    // The QA identity files were retired out of the tree on 2026-10-19; the keeper lives outside
    // the repository. A comment or a progress row that still tells a reader to pass
    // `p3c-red-baseline/qa-identity.json` sends them to a path that cannot be read, which reads
    // like the instrument is broken rather than like the pointer is stale.
    const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: projectRoot, encoding: "utf8" }).stdout
      .split("\0")
      .filter((file) => /\.(?:mjs|cjs|ts|tsx|js|md|json|yml|yaml)$/.test(file));
    expect(tracked.length, "git listed no source files — the scan is vacuous").toBeGreaterThan(20);
    const linesNamingRetiredPath = (file: string) => {
      const absolute = path.join(projectRoot, file);
      if (!existsSync(absolute)) return [];
      return readFileSync(absolute, "utf8")
        .split(/\r?\n/)
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => line.includes("p3c-red-baseline/qa-identity"))
        .map(({ line, number }) => `${file}:${number}: ${line.trim()}`);
    };

    const carriers = [...new Set(tracked.filter((file) => linesNamingRetiredPath(file).length > 0))].sort();
    // One assertion does both jobs. It cannot pass on a tree where nothing names the path, so the
    // scan is proved to fire on the bytes it reads; nothing outside the named carriers can join it,
    // so a stale pointer written into any other script, spec or document is a failure; and if this
    // file's own search pattern moved or disappeared, the carrier set would no longer match and the
    // rule would have to be re-named where it now lives.
    expect(
      carriers,
      `these tracked files name a deleted credential path; a new carrier must be named and justified, ` +
        `and a carrier that stopped mentioning it should leave the list:\n${carriers.join("\n")}`,
    ).toEqual([...namedCarriers].sort());

    // The history records may still describe the retired file, but only in prose that says so —
    // otherwise a reader cannot tell a record from an instruction. Matched per paragraph, because
    // a sentence that wraps across a hard break would otherwise be judged on half its words.
    for (const file of historyDocs) {
      const paragraphs = readFileSync(path.join(projectRoot, file), "utf8").split(/\r?\n[ \t]*\r?\n/);
      const stale = paragraphs
        .filter((paragraph) => paragraph.includes("p3c-red-baseline/qa-identity"))
        .filter((paragraph) => !/retired|deleted|no longer|off-repo|keeper|superseded/i.test(paragraph))
        .map((paragraph) => `${file}: ${paragraph.split(/\r?\n/)[0].trim().slice(0, 80)}`);
      expect(stale, `these history rows read like a usable pointer but do not say the path is retired:\n${stale.join("\n")}`).toEqual(
        [],
      );
      expect(
        paragraphs.some((paragraph) => paragraph.includes("p3c-red-baseline/qa-identity")),
        `${file} was listed as a history record but no longer mentions the retired path — the list is stale`,
      ).toBe(true);
    }

    expect(readFileSync(path.join(projectRoot, "docs", "SECURITY_MODEL.md"), "utf8")).toMatch(
      /~\/\.config\/dueweave/,
      "no document records the off-repo location pattern the retired pointers must be rewritten to",
    );
  });
});
