import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Stage 9 PHASE 17 measured a real hole: the React-warning gate that carries PHASE 16's
// rule ("a release journey that logs a console error, an uncaught error, an unanswered
// request or a React warning has failed") was implemented, run locally, and documented —
// and CI simply never launched it. Nothing noticed, because a job that runs four of the
// five gates looks identical to one that runs five.
//
// So the rule is asserted here: the set of commands CI runs has to cover the set of
// commands this repository calls the release. A gate added to `verify:release:local` or to
// the browser half fails this file until CI runs it too, and an exception that stops
// being needed is itself a failure, so the ignore list cannot rot.
const projectRoot = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(projectRoot, ".github", "workflows", "ci.yml");

/** Every command CI executes, in the order the file declares them. */
function runCommands(source: string): string[] {
  return [...source.matchAll(/^\s*run:\s*(.+)$/gm)].map((match) => match[1].trim());
}

/** The commands the release is defined to be, expanded one level past a composite gate. */
function releaseGateCommands(): string[] {
  const scripts = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")).scripts as Record<string, string>;
  const expand = (command: string): string[] =>
    command
      .split("&&")
      .flatMap((part) => {
        const trimmed = part.trim();
        const inner = /^pnpm\s+([\w:-]+)$/.exec(trimmed);
        // A composite gate (one whose body is only other `pnpm` gates) is not a gate of
        // its own: CI may run its steps directly, as it does for the database half.
        if (inner && scripts[inner[1]] && /^(&&|pnpm)/.test(scripts[inner[1]].trim())) return expand(scripts[inner[1]]);
        return [trimmed];
      })
      .filter((part) => part.startsWith("pnpm"));
  return [...expand(scripts["verify:release:local"]), ...browserGateCommands()];
}

function browserGateCommands(): string[] {
  // `verify:e2e:local` is the canonical *laptop* battery and CI is documented to run the
  // release-critical subset instead, so the browser half names the two scripts CI must
  // launch — not their spec lists, so adding a journey to the smoke list cannot quietly
  // change what this contract checks.
  return ["pnpm test:e2e:smoke", "pnpm test:e2e:react-warnings"];
}

// One entry per gate CI cannot run verbatim, with the reason. A gate listed here that CI
// in fact runs is a dead exemption and fails the last test.
const ciEquivalents: Record<string, string> = {
  "pnpm db:reset:local": "./.github/actions/local-supabase replays the committed migrations onto a fresh database, which is the same proof without a laptop-only CLI reset.",
};

function jobSource(source: string, job: string): string {
  const start = source.indexOf(`\n  ${job}:`);
  if (start === -1) return "";
  const rest = source.slice(start);
  const nextJob = rest.slice(1).search(/\n {2}\w[\w-]*:\n/);
  return nextJob === -1 ? rest : rest.slice(0, nextJob + 1);
}

describe("CI gate manifest", () => {
  const source = readFileSync(workflowPath, "utf8");
  const commands = runCommands(source);
  const gates = releaseGateCommands();

  it("reads a real workflow and a real gate list, so an empty parse is not a pass", () => {
    expect(existsSync(workflowPath), `${workflowPath} is missing`).toBe(true);
    expect(commands.length, "no `run:` step parsed from ci.yml — the scan pattern is wrong").toBeGreaterThan(5);
    expect(gates.length, "the release command expanded to nothing — the scan pattern is wrong").toBeGreaterThan(5);
  });

  it("runs every gate the release is defined to be", () => {
    const missing = gates
      .filter((gate) => !(gate in ciEquivalents))
      .filter((gate) => !commands.some((command) => command.includes(gate)))
      .map((gate) => `${gate} — CI never launches it, so whatever it proves is laptop-only`);
    expect(missing, `ci.yml is missing these release gates:\n${missing.join("\n")}`).toEqual([]);
  });

  it("launches the browser gates from the job that has the stack and the bundle", () => {
    const browser = jobSource(source, "browser");
    expect(browser, "ci.yml has no `browser` job").not.toBe("");
    const browserCommands = runCommands(browser);
    for (const gate of ["pnpm test:e2e:smoke", "pnpm test:e2e:react-warnings"]) {
      expect(browserCommands, `the browser job never runs ${gate}`).toContain(gate);
    }
    // The order carries the proof: the warning suite drives `vite dev`, whose first paint
    // is thousands of module requests, and it is the slower and more fragile of the two.
    // Running it after the journeys keeps a dev-server cold start from hiding a journey
    // failure behind a timeout.
    expect(
      browserCommands.indexOf("pnpm test:e2e:smoke"),
      "the release journeys must run before the React-warning gate",
    ).toBeLessThan(browserCommands.indexOf("pnpm test:e2e:react-warnings"));
  });

  it("never asks a browser run to retry its way to green", () => {
    // PHASE 17: retries are the one way a correctness gate turns into a flake counter.
    const retryFlags = commands.filter((command) => /--retries\b|retry-failed/.test(command));
    expect(retryFlags, `CI retries browser runs, which hides the failure the gate exists to find: ${retryFlags.join(", ")}`).toEqual([]);
    for (const config of ["playwright.config.ts", "playwright.react-warnings.config.ts"]) {
      const text = readFileSync(path.join(projectRoot, config), "utf8");
      expect(text, `${config} does not pin \`retries: 0\``).toMatch(/retries:\s*0/);
    }
  });

  // PHASE 23's artefact step is only a gate if there are artefacts. The WSL dry run of the
  // browser job measured the opposite: `node scripts/verify-secrets.mjs --dir playwright-report`
  // exited 1 with ENOENT on a fully green run (79 journeys passed, 3 warning-gate tests passed),
  // because neither Playwright config declares a reporter that writes that directory — the
  // default reporter prints to stdout and produces only `test-results`. A scan of a directory
  // the pipeline never builds fails every run, and a scan widened to "tolerate absence" would
  // silently stop checking the thing it names. So the directories CI scans have to be ones the
  // browser run is configured to produce.
  it("scans only artefact directories the browser run is configured to produce", () => {
    const scanned = [...source.matchAll(/verify-secrets\.mjs --dir ([\w-]+)/g)].map((match) => match[1]);
    expect(scanned.length, "no artefact scan parsed from ci.yml — the scan pattern is wrong").toBeGreaterThan(1);
    expect(scanned, "CI scans a Playwright artefact directory under the wrong name").toEqual(
      expect.arrayContaining(["test-results", "playwright-report"]),
    );
    // `test-results` is Playwright's default output directory; a config that moved it would
    // leave the scan pointing at a folder nothing writes.
    for (const config of ["playwright.config.ts", "playwright.react-warnings.config.ts"]) {
      const text = readFileSync(path.join(projectRoot, config), "utf8");
      expect(text, `${config} moves outputDir away from the directory CI scans`).not.toMatch(/outputDir:/);
      expect(text, `${config} never writes playwright-report, so CI's scan and upload name a phantom`).toMatch(
        /\[\s*"html",\s*\{[^}]*outputFolder:\s*"playwright-report"/,
      );
      // An auto-opening report would make a failed local journey hang on a browser window,
      // which is a different failure than the one the gate reports.
      expect(text, `${config} must not open the report at the end of a run`).toMatch(/open:\s*"never"/);
    }
  });

  it("keeps every exemption honest", () => {
    const unused = Object.entries(ciEquivalents)
      .filter(([gate]) => !gates.includes(gate))
      .map(([gate]) => gate);
    expect(unused, `these exemptions name a gate that is not part of the release: ${unused.join(", ")}`).toEqual([]);
    const covered = Object.entries(ciEquivalents).filter(([gate]) => commands.some((command) => command.includes(gate)));
    expect(covered.map(([gate]) => gate), `these gates are now run by CI, so remove the exemption: ${covered.map(([gate]) => gate).join(", ")}`).toEqual([]);
  });

  // The matrix is the document a reviewer reads to know what a green CI actually proved,
  // which is exactly the claim F8 shows a job can lose. So its contents are derived from
  // the same source of truth as CI's: a gate that enters `verify:release:local` or the
  // browser half has to be written down, with where it runs.
  it("documents every release gate in the gate matrix", () => {
    const matrixPath = path.join(projectRoot, "docs", "RELEASE_GATE_MATRIX.md");
    expect(existsSync(matrixPath), `${matrixPath} is missing — the release gates have no written matrix`).toBe(true);
    const matrix = readFileSync(matrixPath, "utf8");
    // Matched with the `pnpm` prefix, not as a bare word: the matrix discusses "schema lint"
    // and "type-check" in prose, and prose is not a command a reviewer can copy.
    const undocumented = gates
      .map((gate) => `pnpm ${gate.replace(/^pnpm\s+/, "").split(/\s+/)[0]}`)
      .filter((command) => !matrix.includes(command));
    expect(undocumented, `these gates run in the release but the matrix does not name them:\n${undocumented.join("\n")}`).toEqual([]);
  });

  // A protection rule is written by copying check names out of a UI, and a check name that
  // no longer exists never runs again without anyone noticing. So the rule document and the
  // workflow are pinned to each other: the names must be the same set.
  it("requires exactly the checks the workflow publishes, and no others", () => {
    const jobNames = [...source.matchAll(/^ {4}name:\s+(.+)$/gm)].map((match) => match[1].trim());
    expect(jobNames, `ci.yml should publish three job-level checks, found: ${jobNames.join(", ")}`).toEqual([
      "Static verification",
      "Database contracts",
      "Browser release smoke",
    ]);

    const protectionPath = path.join(projectRoot, "docs", "RELEASE_PROTECTION.md");
    expect(existsSync(protectionPath), `${protectionPath} is missing — the branch protection plan has no record`).toBe(true);
    const protection = readFileSync(protectionPath, "utf8");
    // Only rows of the "Required checks" table count: the document discusses job names in
    // prose too, and prose cannot be typed into GitHub's check picker.
    const required = [...protection.matchAll(/^\| `(?:CI \/ )?([^`]+)` \| `[a-z][\w-]*` \|/gm)].map((match) => match[1].trim());
    expect(required.length, "no required-check rows parsed from RELEASE_PROTECTION.md — the scan pattern is wrong").toBeGreaterThan(2);
    expect([...required].sort(), "the protection plan does not require the checks CI publishes").toEqual([...jobNames].sort());

    for (const name of jobNames) {
      expect(protection, `the protection plan never names the ${name} check`).toContain(`\`${name}\``);
    }
    // Requiring the workflow-level name alone is the F8 failure class: a job that runs four
    // of five gates looks identical to one that runs five.
    expect(
      required,
      "the protection plan must require job-level checks, not the workflow-level `CI` check",
    ).not.toContain("CI");
  });

  it("keeps the integration PR a design, with the measurements that make it falsifiable", () => {
    const planPath = path.join(projectRoot, "docs", "PR_INTEGRATION_PLAN.md");
    expect(existsSync(planPath), `${planPath} is missing — PHASE 25 asks for a designed, not opened, PR`).toBe(true);
    const plan = readFileSync(planPath, "utf8");
    for (const fact of [
      "main", // the base
      "current-stage-9-security-ci", // the head
      "merge-base", // divergence is measured, not assumed
      "conflict", // conflict risk is stated per file that matters
      "workflow", // and so is the fact that CI itself arrives with the PR
    ]) {
      expect(plan.toLowerCase(), `the PR plan does not cover \`${fact}\``).toContain(fact.toLowerCase());
    }
    expect(plan, "the PR plan must state that no PR was opened").toMatch(/no pull request was created/i);
  });

  // A gate nobody can find is a gate nobody runs, and a link to a document that was renamed
  // reads exactly like a document that was never written. Both directions are checked: the
  // README's relative links must resolve, and the Stage 9 evidence set must be reachable from it.
  it("keeps every document the README points at real, and every Stage 9 document pointed at", () => {
    const readme = readFileSync(path.join(projectRoot, "README.md"), "utf8");
    const links = [...readme.matchAll(/\]\((docs\/[\w.-]+\.md)\)/g)].map((match) => match[1]);
    expect(new Set(links).size, "no docs links parsed from README.md — the scan pattern is wrong").toBeGreaterThan(5);
    const broken = [...new Set(links)].filter((link) => !existsSync(path.join(projectRoot, link)));
    expect(broken, `README.md links documents that do not exist: ${broken.join(", ")}`).toEqual([]);

    for (const document of [
      "docs/RELEASE_GATE_MATRIX.md",
      "docs/TEST_SKIP_CLASSIFICATION.md",
      "docs/SECURITY_CONTRACT_REQUALIFICATION.md",
      "docs/SECURITY_MODEL.md",
      "docs/PR_INTEGRATION_PLAN.md",
      "docs/RELEASE_PROTECTION.md",
      "docs/STAGE9_ABUSE_MATRIX.md",
    ]) {
      expect(readme, `${document} is part of the release evidence but the README never points at it`).toContain(`](${document})`);
    }
  });
});
