import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Stage 9 limitation 6: `release-local-ci-state` was written, wired into both stack-using
// jobs, and relied upon by the reports as the reason a green run leaves nothing borrowed —
// and a grep over `tests/`, `docs/` and `*.md` found zero references to it. Nothing pinned
// its scope, so the next edit could widen `supabase stop --no-backup` into a `docker system
// prune`, or drop the `/proc/<pid>/cwd` guard from the port sweep, and every gate would stay
// green while doing it. On this host that is not a formatting concern: D-S9-8 was a CI job
// destroying another project's containers on the shared engine, and the same engine still
// runs them.
//
// So the sweep's scope is asserted against sources of truth rather than copied literals: the
// ports come from the Playwright configs that bind them, the artefact directories come from
// the scan step that reads them, and the workspace guard comes from the runner variable only
// a self-hosted job sets.
const projectRoot = path.resolve(import.meta.dirname, "..");
const actionPath = path.join(projectRoot, ".github", "actions", "release-local-ci-state", "action.yml");
const workflowPath = path.join(projectRoot, ".github", "workflows", "ci.yml");

// LF-normalised reads: every structural parse below finds a job or step boundary by an
// indentation-plus-newline pattern, and on this repository's CRLF working tree `:\r\n` does
// not match `:\n` — the job boundaries would silently vanish and a job body would read as the
// rest of the file.
const readText = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const actionSource = readText(actionPath);
const workflowSource = readText(workflowPath);

/**
 * Every `run:` script in a workflow or composite action, in file order — block scalars and
 * inline one-liners alike.
 *
 * A one-liner belongs here as much as a loop does: `run: docker system prune -f` is exactly
 * the widening this file exists to catch, and reading only block scalars would let it through
 * because it has no indentation to descend into.
 */
function runScripts(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const scripts: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const inline = /^\s*run:\s*(?!\|)[^\s|].*$/.exec(lines[index]);
    if (inline) {
      scripts.push(inline[0].replace(/^\s*run:\s*/, ""));
      continue;
    }
    const header = /^(?<indent>\s*)run:\s*\|\s*$/.exec(lines[index]);
    if (!header) continue;
    const own = header.groups.indent.length;
    const body: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line.trim() === "") {
        body.push("");
        cursor += 1;
        continue;
      }
      if (/^\s*/.exec(line)[0].length <= own) break;
      body.push(line);
      cursor += 1;
    }
    scripts.push(body.join("\n"));
    index = cursor - 1;
  }
  return scripts;
}

/** The loopback ports the release suites bind their servers to, read from the suites. */
function suitePorts(): string[] {
  return ["playwright.config.ts", "playwright.react-warnings.config.ts"].map((config) => {
    const text = readFileSync(path.join(projectRoot, config), "utf8");
    const port = /--port\s+(\d+)\s+--strictPort\s+--host\s+127\.0\.0\.1/.exec(text);
    expect(
      port,
      `${config} no longer binds a pinned loopback --port, so the cleanup scope has nothing to derive its ports from`,
    ).not.toBeNull();
    return port[1];
  });
}

function jobBody(job: string): string {
  const start = workflowSource.indexOf(`\n  ${job}:`);
  if (start === -1) return "";
  const rest = workflowSource.slice(start);
  const next = rest.slice(1).search(/\n {2}\w[\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Every port sweep in the release-state path. The workflow's own pre-flight sweep is included
 * because it kills the same class of process with the same privilege: pinning only the action
 * would leave a widened sibling next to a scoped one and call that coverage.
 */
function clearStep(): string | null {
  const match = /\n {6}- name: Clear servers[\s\S]*?(?=\n {6}- |\n {4}\w)/.exec(workflowSource);
  return match ? match[0] : null;
}

function portSweeps(): { where: string; body: string }[] {
  const fromAction = runScripts(actionSource)
    .filter((body) => /for port in/.test(body))
    .map((body) => ({ where: "release-local-ci-state/action.yml", body }));
  const step = clearStep();
  const fromWorkflow = step
    ? runScripts(step)
        .filter((body) => /for port in/.test(body))
        .map((body) => ({ where: "ci.yml `Clear servers…` step", body }))
    : [];
  return [...fromAction, ...fromWorkflow];
}

describe("CI release-state cleanup scope (limitation 6)", () => {
  const sweeps = portSweeps();

  it("finds the sweep it is pinning, so an emptied file is not a pass", () => {
    expect(existsSync(actionPath), `${actionPath} is missing — the release state action was deleted`).toBe(true);
    expect(sweeps.length, "no port sweep parsed from the release-state path — the scan pattern is wrong").toBeGreaterThan(1);
    expect(suitePorts(), "the two suites must bind two distinct ports").toHaveLength(new Set(suitePorts()).size);
  });

  // `supabase stop` is project-keyed because the CLI reads this checkout's project id; a
  // `--workdir` or `docker` form would reach the shared engine's other stacks instead.
  it("releases this project's Supabase stack by project id and reports a failure to do so", () => {
    const stop = runScripts(actionSource).find((body) => /supabase stop/.test(body));
    expect(stop, "the release state action no longer stops the local Supabase stack").not.toBeUndefined();
    expect(stop).toMatch(/pnpm supabase stop --no-backup/);
    expect(stop, "the stack release swallowed its own failure, so a leaked stack is invisible").toMatch(/::warning::/);
    expect(stop).not.toMatch(/\|\|\s*true/);
    expect(stop).not.toMatch(/--workdir|--db-url|--project-ref/);
  });

  it("sweeps exactly the ports the suites bind, and nothing wider", () => {
    const expected = [...suitePorts()].sort();
    for (const { where, body } of sweeps) {
      const listed = /for port in ([^\n;]+?);?\s*do\b/m.exec(body);
      expect(listed, `${where} no longer enumerates its ports, so a widened or host-wide sweep is possible`).not.toBeNull();
      const ports = listed[1].split(/[\s,]+/).filter(Boolean).sort();
      expect(ports, `${where} sweeps ports no suite binds: ${ports.join(", ")}`).toEqual(expected);
    }
  });

  // Without the working-directory equality a listener on a qualified port that belongs to
  // the developer's own session — or to another checkout that reused the port — would be
  // killed by a CI job. `sort -u` matters for the same reason: `ss` prints one line per
  // address family, and an unguarded double `kill` races against an unrelated pid reuse.
  it("only touches a listener whose working directory is this checkout", () => {
    for (const { where, body } of sweeps) {
      expect(body, `${where} no longer reads the working directory of a listener`).toMatch(/readlink\s+"\/proc\/\$pid\/cwd"/);
      expect(body, `${where} kills a listener without proving it came from this workspace`).toContain('[ "$cwd" = "$GITHUB_WORKSPACE" ]');
      expect(body, `${where} could kill the same pid twice across address families`).toMatch(/sort -u/);
      const guard = body.indexOf('$GITHUB_WORKSPACE" ]; then');
      const kill = body.indexOf("kill ");
      expect(kill, `${where} has no kill step to scope`).toBeGreaterThan(-1);
      expect(kill, `${where} kills outside the workspace guard`).toBeGreaterThan(guard);
    }
  });

  // The negative half is the point of the file: every one of these is a host-wide sweep, and
  // a host-wide sweep on this engine is the D-S9-8 failure class rather than a cleanup. Only
  // shell scripts are scanned, never prose — the action's own description says the word
  // "prune" to forbid it.
  it("never becomes a global Docker or process cleanup", () => {
    const globalPatterns = [
      { label: "docker system prune", pattern: /docker\s+system\s+prune/i },
      { label: "docker container/image/volume/builder prune or rm", pattern: /docker\s+(container|image|volume|builder)\s+(prune|rm)/i },
      { label: "docker stop or kill by name, id or filter", pattern: /docker\s+(stop|kill)/i },
      { label: "docker ps discovery", pattern: /docker\s+ps/i },
      { label: "a docker volume or container remove by name", pattern: /docker\s+rm/i },
      { label: "pkill", pattern: /\bpkill\b/ },
      { label: "killall", pattern: /\bkillall\b/ },
      { label: "kill by signal", pattern: /kill\s+-(9|KILL|TERM|15|SIGTERM)\b/i },
      { label: "kill of the whole process group", pattern: /kill\s+(0|-0|--?all)\b/ },
      { label: "a bare prune", pattern: /\bprune\b/i },
      { label: "supabase stop for another project", pattern: /supabase\s+stop[^\n]*(--workdir|--db-url|--project-ref)/i },
    ];
    const targets = [
      ...runScripts(actionSource).map((body) => ({ where: "release-local-ci-state/action.yml", text: body })),
      ...sweeps.map((sweep) => ({ where: sweep.where, text: sweep.body })),
    ];
    expect(targets.length, "no shell script parsed from the release-state path").toBeGreaterThan(1);
    for (const { where, text } of targets) {
      const hit = globalPatterns.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
      expect(hit, `${where} now performs a host-wide cleanup: ${hit.join(", ")}`).toEqual([]);
    }
  });

  // A cleanup that is not wired to both stack jobs leaks the stack from the job that forgot
  // it, and the leak is invisible until the next run inherits a half-replayed database.
  it("is wired into every job that starts the local stack, and runs even when the job failed", () => {
    const stackUsers = ["static", "database", "browser"].filter((job) => jobBody(job).includes("./.github/actions/local-supabase"));
    expect(stackUsers, "the stack is started by the database and browser jobs only").toEqual(["database", "browser"]);
    for (const job of stackUsers) {
      const body = jobBody(job);
      expect(body, `the ${job} job starts a stack and never releases it`).toContain("./.github/actions/release-local-ci-state");
      const use = body.indexOf("./.github/actions/release-local-ci-state");
      expect(
        /\bif:\s*\$\{\{\s*always\(\)\s*\}\}/.test(body.slice(use, use + 120)),
        `the ${job} job skips its own cleanup when a step fails, which is the run whose state matters`,
      ).toBe(true);
    }
  });

  // The workspace's generated artefact directories are the only state the port sweep cannot
  // release, so their names are pinned to the directories the credential scan reads: a
  // `rm -rf` list that drifted from the scan list would either leak an artefact or delete
  // something outside the release.
  it("removes only the artefact directories the credential scan reads", () => {
    const clear = clearStep();
    expect(clear, "ci.yml no longer clears the previous job's servers and reports").not.toBeNull();
    const removed = [...clear.matchAll(/\brm -rf\s+([^\n]+)/g)].flatMap((match) => match[1].trim().split(/\s+/)).filter(Boolean);
    expect(removed.length, "the clear-servers step removes no directory — the parse found nothing to pin").toBeGreaterThan(0);
    const scanned = [...workflowSource.matchAll(/verify-secrets\.mjs --dir ([\w-]+)/g)].map((match) => match[1]);
    expect(scanned.length, "no artefact scan parsed from ci.yml — the scan pattern is wrong").toBeGreaterThan(1);
    expect([...new Set(removed)].sort(), "the cleanup list and the scan list name different directories").toEqual(
      [...new Set(scanned)].sort(),
    );
    for (const target of removed) {
      expect(target, `rm -rf reaches outside the workspace: ${target}`).toMatch(/^[\w.-]+$/);
    }
  });

  // The description is the contract a reviewer reads before editing the shell; when the scope
  // leaves the prose, the prose becomes the thing a future reader wrongly trusts.
  it("documents the scope it enforces", () => {
    const description = /^description: >\n(?:[ \t]+.*\n?)*/m.exec(actionSource);
    expect(description, "the release state action has no description — a reader has nothing to check the sweep against").not.toBeNull();
    const text = description[0].toLowerCase();
    for (const fact of ["project id", "workspace", "port", "global prune"]) {
      expect(text, `the action's description no longer states that the sweep is scoped by ${fact}`).toContain(fact);
    }
  });
});
