import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migration 26 is the one hosted write this release line is waiting on, and the qualification that
// says it is safe was, on 2026-10-17, produced by scratch drivers under `tmp/` — which answers once,
// leaves nothing the next session can re-run, and is exactly how a "dry-run was done" claim decays
// into a memory. This is that qualification as one committed operator instrument, in the shape the
// other hosted instruments already use: reads assembled from its own source, the replay wrapped in a
// transaction that cannot end without raising, and a forward-restore file whose digests re-derive.
//
// Nothing here touches production. The CLI is a recording stub, no credential is read from the
// operator's real file, and the cases below assert the properties that make the instrument safe to
// point at a live project: it refuses a project that is not DueWeave production, it sends no write
// outside the aborted block, it keeps the connection string out of its own output, and it fails
// closed rather than writing a restore file from answers it cannot fingerprint.

const projectRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(projectRoot, "scripts", "hosted-migration-qualification.mjs");
const migration = path.join(projectRoot, "supabase", "migrations", "20261017090000_current_cl39_edit_conflict_errcode_reachable.sql");

const instrument = await import(`file:///${script.replace(/\\/g, "/").replace(/^\/+/, "")}`);
// PRODUCTION_REF is deliberately not imported: the assertions below name the ref literally, so the
// instrument pinning its target to its own export cannot pass a case that a drifted export would
// silently send to a different project.
const { splitStatements, dryRunBlock, revertFile, definitionRead, probeBlock, parseJsonRows } = instrument;

const SECRET = "sesame,open?#pw";
const ENCODED_SECRET = encodeURIComponent(SECRET);

function workspace() {
  return mkdtempSync(path.join(tmpdir(), "dw-migration-qualification-"));
}

/** A stand-in Supabase CLI that records every argument vector and echoes its `--db-url` back, so a
 *  weak redaction would leak the credential into the same output the instrument prints. */
function stubCli(recordFile: string, reply = "STUB no useful answer\n"): string {
  const file = path.join(workspace(), "stub-cli.mjs");
  writeFileSync(file, [
    "import { appendFileSync } from 'node:fs';",
    `appendFileSync(${JSON.stringify(recordFile)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    "const url = process.argv.indexOf('--db-url');",
    "console.log('Connecting to remote database...');",
    "console.log(url >= 0 ? 'STUB ' + process.argv[url + 1] : 'STUB no url');",
    `console.log(${JSON.stringify(reply)});`,
    "process.exit(0);",
    "",
  ].join("\n"));
  return file;
}

function passwordFile(password = SECRET): string {
  const file = path.join(workspace(), "prod-db-password");
  writeFileSync(file, `${password}\n`, { mode: 0o600 });
  return file;
}

function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string; calls: string[][] }> {
  const recordFile = path.join(workspace(), "calls.jsonl");
  writeFileSync(recordFile, "");
  const revertOut = path.join(workspace(), "revert.sql");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, "--revert-out", revertOut, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DWEAVE_DB_PASSWORD_FILE: passwordFile(), DWEAVE_SUPABASE_CLI: stubCli(recordFile), ...env },
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("close", (code) => {
      const raw = readFileSync(recordFile, "utf8").trim();
      resolve({ code, out, calls: raw ? raw.split("\n").map((line) => JSON.parse(line) as string[]) : [] });
    });
  });
}

const WRITE_VERB = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|vacuum|copy|call|refresh|reindex)\b/i;

/** Statements the instrument says it would send for a labelled catalog read. The label is a token
 *  of its own, so it comes off before the statement is judged: `SQL READ migration-ledger select …`. */
function readStatements(out: string): string[] {
  return out
    .split("\n")
    .filter((line) => line.startsWith("SQL READ "))
    .map((line) => line.replace(/^SQL READ \S+ /, ""));
}

/** The one-shot blocks the instrument would send, which carry no label. */
function blocksFor(out: string, kind: string): string[] {
  return out
    .split("\n")
    .filter((line) => line.startsWith(`SQL ${kind} `))
    .map((line) => line.replace(`SQL ${kind} `, ""));
}

// Each case that spawns pays one Node process per statement on a Windows host, so it needs far
// longer than the default five seconds; the assertions themselves are unchanged.
const SPAWNS = 90_000;

describe("hosted migration 26 qualification instrument", () => {
  it("cuts the committed migration into top-level statements without breaking a dollar-quoted body", () => {
    const statements = splitStatements(readFileSync(migration, "utf8"));
    // Eight is not decoration: 2 function bodies, 2 grants, 2 revokes, 2 comments. A naive split on
    // `;` would cut each plpgsql body apart and the replay would then be nonsense.
    expect(statements).toHaveLength(8);
    const bodies = statements.filter((statement: string) => /^\s*create or replace function/i.test(statement));
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      // Two matching tags in one statement is the proof the split did not cut the body apart, and it
      // holds whichever tag the committed file happens to use (`$$` here, `$function$` after
      // pg_get_functiondef re-emits it) — naming one spelling would test my memory of the file.
      const tags = body.match(/\$[A-Za-z0-9_]*\$/g) ?? [];
      expect(tags, `body does not carry exactly an opening and a closing dollar tag: ${body.slice(0, 80)}`).toHaveLength(2);
      expect(tags[0]).toBe(tags[1]);
      expect(body).toContain("return v_row;");
      // The whole point of migration 26: the conflict raise moves off 40001 onto the private code the
      // adapter can read. A split that dropped either body would pass the count above and fail here.
      expect(body).toContain("errcode = 'DW001'");
    }
    expect(statements.filter((statement: string) => /^\s*grant/i.test(statement))).toHaveLength(2);
    expect(statements.filter((statement: string) => /^\s*revoke/i.test(statement))).toHaveLength(2);
    expect(statements.filter((statement: string) => /^\s*comment/i.test(statement))).toHaveLength(2);
  });

  it("wraps the replay so the transaction cannot end without raising, and never commits", () => {
    const statements = splitStatements(readFileSync(migration, "utf8"));
    const block = dryRunBlock(statements);
    for (const statement of statements) {
      expect(block).toContain(statement);
    }
    expect(block).toMatch(/^\s*do\s/);
    expect(block).not.toMatch(/\bcommit\b/i);
    // The aborting raise has to be the block's last statement. Anchoring this on the block's *first*
    // `raise exception` was my error, not the wrapper's: the migration's own bodies raise, so the
    // earliest raise sits inside statement 1. What keeps the replay abortive is that after the final
    // raise nothing but the terminator remains.
    const lastRaise = block.lastIndexOf("raise exception");
    expect(lastRaise).toBeGreaterThan(-1);
    expect(
      block.slice(lastRaise),
      "the block must end in its own raise, so the transaction cannot reach a successful commit",
    ).toMatch(/^raise exception '[^']*deliberate rollback';\s*end \$[A-Za-z0-9_]*\$\s*;?$/);
  });

  it("names every statement it would send and keeps every catalog read asking for data only", async () => {
    const { code, out, calls } = await run(["--dry-run"]);
    expect(code).toBe(0);
    const reads = readStatements(out);
    expect(reads.length).toBeGreaterThan(5);
    for (const statement of reads) {
      expect(statement, `read does not start by asking for data: ${statement.slice(0, 80)}`).toMatch(/^\s*(select|with)\b/i);
      expect(statement, `read names a writing verb: ${statement.slice(0, 80)}`).not.toMatch(WRITE_VERB);
    }
    const blocks = [...blocksFor(out, "PROBE"), ...blocksFor(out, "REPLAY")];
    // The plan an operator reads has to be built from the committed file, not from a path that
    // drifted: eight statements is what that migration actually splits into (case 1).
    expect(out, "the dry run must report the committed migration's own statement count").toContain("SQL STATEMENTS 8");
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block).toMatch(/deliberate rollback/i);
      expect(block).not.toMatch(/\bcommit\b/i);
    }
    expect(calls, "a dry run must not reach the CLI at all").toEqual([]);
  }, SPAWNS);

  it("refuses a project that is not DueWeave production and never reaches the CLI", async () => {
    const { code, out, calls } = await run(["--project-ref", "somewhereelse"]);
    expect(code, out.slice(0, 200)).not.toBe(0);
    expect(out).toMatch(/ugzdqcytouwfdlcjujqv/);
    expect(calls).toEqual([]);
  }, SPAWNS);

  it("refuses when the operator's password file is absent and never reaches the CLI", async () => {
    const { code, out, calls } = await run([], { DWEAVE_DB_PASSWORD_FILE: path.join(workspace(), "no-such-file") });
    expect(code).not.toBe(0);
    expect(out).toMatch(/prod-db-password/);
    expect(calls).toEqual([]);
  }, SPAWNS);

  it("fails closed on answers it cannot fingerprint: no credential leaked, and no restore file written", async () => {
    const { code, out, calls } = await run([]);
    expect(code, "a stub that answers nothing must not look like a qualified migration").not.toBe(0);
    expect(out).toContain("STUB ");
    expect(out, "the connection string reached the output in its raw form").not.toContain(SECRET);
    expect(out, "the connection string reached the output in its percent-encoded form").not.toContain(ENCODED_SECRET);
    expect(out).toContain("[redacted-db-password]");
    const sentUrl = calls[0]?.[calls[0].indexOf("--db-url") + 1] ?? "";
    expect(sentUrl).toContain(ENCODED_SECRET);
    expect(sentUrl).not.toContain(SECRET);
    expect(sentUrl, sentUrl.replace(ENCODED_SECRET, "[encoded-secret]")).toMatch(/^postgresql:\/\/postgres\.ugzdqcytouwfdlcjujqv:/);
  }, SPAWNS);

  it("writes a forward-restore file whose header digests re-derive from the definitions it carries", () => {
    const first = "CREATE OR REPLACE FUNCTION public.update_client(a int)\n RETURNS int\n LANGUAGE plpgsql\nAS $function$\nbegin\n  return 1;\nend;\n$function$\n";
    const second = "CREATE OR REPLACE FUNCTION public.update_receivable_details(a int)\n RETURNS int\n LANGUAGE plpgsql\nAS $function$\nbegin\n  return 2;\nend;\n$function$\n";
    const text = revertFile([
      { routine: "update_client", definition: first },
      { routine: "update_receivable_details", definition: second },
    ]);
    expect(text).toContain(first.trimEnd());
    expect(text).toContain(second.trimEnd());
    for (const definition of [first, second]) {
      const digest = createHash("md5").update(definition).digest("hex");
      expect(text, `the header must carry the digest of exactly the bytes it restores: ${digest}`).toContain(digest);
    }
    expect((text.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(2);
    // The header is the only thing in the file that says *why* it exists and where the decision is
    // written. A doc path that does not resolve is how a restore fails at the worst possible hour.
    const named = text.match(/docs\/[A-Za-z0-9_.-]+\.md/)?.[0];
    expect(named, "the restore file must point at the release record").toBeTruthy();
    expect(existsSync(path.join(projectRoot, named)), `the restore file points at a doc that is not in the repo: ${named}`).toBe(true);
  });

  it("is reachable as a named release script, the way every other hosted instrument is", () => {
    // Without this, the qualification lives only in whoever remembers the command — and the next
    // session re-runs it by hand, which is how the scratch-driver version of this pass decayed.
    const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["verify:hosted:qualify"]).toBe("node scripts/hosted-migration-qualification.mjs");
  });

  it("finds the answer inside CLI output that pads the JSON with its own advisory lines", () => {
    // Measured on production 2026-10-17: `--output-format json` pretty-prints the array across many
    // lines and then appends "A new version of Supabase CLI is available" to the same stdout. Reading
    // from the opening bracket to the end of the text parses nothing, so the run reported a routine
    // definition it had actually received — a fail-closed answer, but a false one about production.
    const definition = "CREATE OR REPLACE FUNCTION public.update_client()\nAS $function$\nbegin\n  return 1;\nend;\n$function$\n";
    const answer = [
      "Connecting to remote database...",
      "[",
      "  {",
      `    "definition": ${JSON.stringify(definition)},`,
      `    "definition_chars": ${definition.length},`,
      `    "definition_md5": "${createHash("md5").update(definition).digest("hex")}"`,
      "  }",
      "]",
      "A new version of Supabase CLI is available: v2.121.0 (currently installed v2.117.0)",
      "We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started",
    ].join("\n");
    expect(parseJsonRows(answer)).toEqual([{ definition, definition_chars: definition.length, definition_md5: createHash("md5").update(definition).digest("hex") }]);
    expect(parseJsonRows('[{"x": 1}]')).toEqual([{ x: 1 }]);
    expect(parseJsonRows("STUB no useful answer")).toBeNull();
    // A bracket in prose is not an answer, and guessing with one would be worse than failing closed.
    expect(parseJsonRows("[note] some advisory\nstill no json here")).toBeNull();
  });

  it("reads a routine definition and the rollback probe as one statement each, so the CLI accepts them", () => {
    expect(definitionRead("update_client")).toMatch(/^select /);
    expect(definitionRead("update_client")).toContain("pg_get_functiondef");
    expect(definitionRead("update_client")).toContain("update_client");
    expect(splitStatements(definitionRead("update_client"))).toHaveLength(1);
    const probe = probeBlock("public.dw_cl39_rollback_probe");
    expect(splitStatements(probe)).toHaveLength(1);
    expect(probe).toMatch(/^do\s/);
    expect(probe).toContain("deliberate rollback");
  });
});
