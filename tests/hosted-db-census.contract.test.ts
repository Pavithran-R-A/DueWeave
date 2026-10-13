import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The account erasure, the hosted authorization re-reads and the unindexed-foreign-key advisor have
// all been answered this release line by hand-typed queries against the hosted database. A hand
// query answers once, leaves nothing behind, and cannot be re-run by the next session — which is
// exactly how B18's five findings and B17's "advisor re-reads have not been re-run" came to be
// remembered rather than measured. This is those reads as one repeatable operator instrument.
//
// What the instrument may never do is write. It connects as the project's postgres role, so the
// promise is enforced by the instrument having no path to a statement it did not author: every SQL
// it can send is in its own source, and the cases below prove each one asks for data only.
//
// Nothing here touches production. The CLI is stood in for by a recording stub, because a unit suite
// may not depend on what the hosted database is doing while it runs, and no credential is read from
// the operator's real file.

const projectRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(projectRoot, "scripts", "hosted-db-census.mjs");
const erasureMigration = path.join(projectRoot, "supabase", "migrations", "20261006120000_current_arc3c_account_erasure_path.sql");

const QA_OWNER = "5fbc55df-0cbc-4167-ae8a-aed24178b5cf";
const SECRET = "sesame,open?#pw";
const ENCODED_SECRET = encodeURIComponent(SECRET);

function workspace() {
  return mkdtempSync(path.join(tmpdir(), "dw-hosted-census-"));
}

/** A stand-in Supabase CLI that records every argument vector it is called with and echoes its
 *  `--db-url` back on stdout, so a weak redaction would leak the credential into the same output
 *  the instrument prints — which is the property the leak case below is really asserting. */
function stubCli(recordFile: string): string {
  const file = path.join(workspace(), "stub-cli.mjs");
  writeFileSync(file, [
    "import { appendFileSync } from 'node:fs';",
    `appendFileSync(${JSON.stringify(recordFile)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    "const url = process.argv.indexOf('--db-url');",
    "console.log('Connecting to remote database...');",
    "console.log(url >= 0 ? 'STUB ' + process.argv[url + 1] : 'STUB no url');",
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

function run(args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string; calls: string[][] }> {
  const recordFile = path.join(workspace(), "calls.jsonl");
  writeFileSync(recordFile, "");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
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

const WRITE_VERB = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|vacuum|copy|call|do|listen|notify|refresh|reindex|set|reset)\b/i;

/** The SQL the instrument would send, taken from its own `--dry-run` answer. */
function statements(out: string): string[] {
  return out.split("\n").filter((line) => /^SQL\s/.test(line)).map((line) => line.replace(/^SQL\s+\S+\s+/, ""));
}

// Each case that actually runs spawns one Node process per read, so on a Windows host the sequence
// needs far longer than the default five seconds; the assertions themselves are unchanged.
const SPAWNS = 60_000;

describe("hosted database census instrument", () => {
  it("names every statement it would send and every one of them asks for data only", async () => {
    const { code, out, calls } = await run(["--dry-run", "--owner", QA_OWNER], {});
    expect(code).toBe(0);
    const sql = statements(out);
    // A surprising zero here would be my pattern, not the instrument: the dry run has to answer.
    expect(sql.length).toBeGreaterThan(5);
    for (const statement of sql) {
      expect(statement, `statement does not start by asking for data: ${statement.slice(0, 80)}`).toMatch(/^\s*(select|with)\b/i);
      expect(statement, `statement names a writing verb: ${statement.slice(0, 80)}`).not.toMatch(WRITE_VERB);
    }
    expect(calls).toEqual([]);
  });

  it("runs the census without a credential in its output even though the stand-in echoes the connection string", async () => {
    const { code, out, calls } = await run(["--owner", QA_OWNER], {});
    expect(code).toBe(0);
    expect(out).toContain("STUB ");
    // The URL is built percent-encoded, so the encoded form is the one a printed line can actually
    // leak — and it decodes to the credential as surely as the raw bytes would. Ruling out only the
    // raw spelling passes even when nothing is redacted at all (measured that way on this case).
    expect(out, "the connection string reached the output in its raw form").not.toContain(SECRET);
    expect(out, "the connection string reached the output in its percent-encoded form").not.toContain(ENCODED_SECRET);
    expect(out).toContain("[redacted-db-password]");
    // The credential reaches the CLI percent-encoded, so the reserved characters cannot re-frame it.
    const sentUrl = calls[0]?.[calls[0].indexOf("--db-url") + 1] ?? "";
    expect(sentUrl).toContain(ENCODED_SECRET);
    expect(sentUrl).not.toContain(SECRET);
    // The session pooler selects the project through the user name, `postgres.<ref>`, so a ref that
    // drifted out of it would connect somewhere else entirely.
    expect(sentUrl, sentUrl.replace(ENCODED_SECRET, "[encoded-secret]")).toMatch(/^postgresql:\/\/postgres\.ugzdqcytouwfdlcjujqv:/);
  }, SPAWNS);

  it("refuses to run when the operator's password file is absent and never reaches the CLI", async () => {
    const { code, out, calls } = await run([], { DWEAVE_DB_PASSWORD_FILE: path.join(workspace(), "no-such-file") });
    expect(code).not.toBe(0);
    expect(out).toMatch(/prod-db-password/);
    expect(calls).toEqual([]);
  });

  it("sends one read-only statement per labelled read and reports each answer under its label", async () => {
    const { code, out, calls } = await run(["--owner", QA_OWNER], {});
    expect(code).toBe(0);
    const labels = out.split("\n").filter((line) => /^READ\s/.test(line)).map((line) => line.split(/\s+/)[1]);
    expect(new Set(labels).size).toBe(labels.length);
    for (const expected of ["auth-users", "ledger-census", "rls-coverage", "routine-posture", "unindexed-foreign-keys", "migration-ledger", "owner-census"]) {
      expect(labels).toContain(expected);
    }
    expect(calls.length).toBe(labels.length);
    for (const call of calls) {
      expect(call.slice(0, 2)).toEqual(["db", "query"]);
      expect(call[call.indexOf("--db-url") + 1]).toBeTypeOf("string");
    }
  }, SPAWNS);

  it("maps the per-account census onto exactly the tables the committed erasure deletes from", async () => {
    const { out } = await run(["--dry-run", "--owner", QA_OWNER], {});
    const census = statements(out).find((statement) => /owner-census/.test(out) && statement.includes(QA_OWNER));
    expect(census, "no per-account census statement was offered").toBeTruthy();
    const instrumentPairs = [...census!.matchAll(/select '(\w+)' as tbl, count\(\*\)(?: as \w+)? from public\.\1 where (\w+) = '/g)]
      .map((match) => `${match[1]}.${match[2]}`)
      .sort();
    // The authoritative purge set is migration 25's own DELETE statements.
    const source = readFileSync(erasureMigration, "utf8");
    const purgePairs = [...source.matchAll(/delete from public\.(\w+) where (\w+) = v_owner/gi)]
      .map((match) => `${match[1]}.${match[2]}`)
      .sort();
    expect(purgePairs.length).toBeGreaterThan(8);
    expect(instrumentPairs).toEqual(expect.arrayContaining(purgePairs));
    // `profiles` is purged by its own primary key, which the DELETE regex above cannot see.
    expect(instrumentPairs).toContain("profiles.id");
    // An audit event names the erased person through a RESTRICTing column, not a delete.
    expect(instrumentPairs).toContain("founder_audit_events.target_user_id");
  });

  it("refuses an owner that is not a uuid before it can be interpolated into a statement", async () => {
    const hostile = "1' or '1'='1";
    const { code, out, calls } = await run(["--owner", hostile], {});
    expect(code).not.toBe(0);
    expect(out).toMatch(/uuid/i);
    expect(calls).toEqual([]);
  }, SPAWNS);

  it("keeps the pooler address and project ref overridable while defaulting to the measured production pair", async () => {
    const { code, out } = await run(["--dry-run"], {});
    expect(code).toBe(0);
    expect(out).toMatch(/aws-0-ap-south-1\.pooler\.supabase\.com/);
    expect(out).toMatch(/ugzdqcytouwfdlcjujqv/);
    const overridden = await run(["--dry-run", "--pooler-host", "pool.example.test", "--project-ref", "abcdefghijklmn"], {});
    expect(overridden.out).toContain("pool.example.test");
    expect(overridden.out).toContain("abcdefghijklmn");
  });

  it("re-runs the advisor query that produced the five unindexed foreign keys in its measured shape", async () => {
    const { out } = await run(["--dry-run"], {});
    const advisor = statements(out).find((statement) => /contype = 'f'/i.test(statement));
    expect(advisor, "no foreign-key advisor statement was offered").toBeTruthy();
    expect(advisor).toMatch(/left join pg_index/i);
    expect(advisor).toMatch(/idx\.indkey is null/i);
    expect(advisor).toMatch(/nspname = 'public'/i);
  });

  it("is an operator command that no CI job or release gate may reach", async () => {
    const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["verify:hosted:census"]).toBe("node scripts/hosted-db-census.mjs");
    const workflows = readFileSync(path.join(projectRoot, ".github", "workflows", "ci.yml"), "utf8");
    expect(workflows).not.toContain("hosted-db-census");
    for (const gate of ["verify:release:local", "verify:e2e:local", "test:e2e:smoke"]) {
      expect(packageJson.scripts[gate]).not.toContain("hosted-db-census");
    }
  });

  it("carries the census across every public table the schema owns", async () => {
    const { out } = await run(["--dry-run"], {});
    const ledger = statements(out).find((statement) => /count\(\*\)(?: as \w+)? from public\.activities/i.test(statement) && !statement.includes(QA_OWNER));
    expect(ledger, "no whole-database ledger statement was offered").toBeTruthy();
    const tables = [...new Set([...ledger!.matchAll(/from public\.(\w+)/g)].map((match) => match[1]))];
    expect(tables).toEqual(expect.arrayContaining([
      "activities", "analytics_events", "clients", "entitlements", "founder_admins",
      "founder_audit_events", "founder_offer_config", "payments", "profiles",
      "promise_events", "promises", "purchase_claims", "receivables",
    ]));
  });
});
