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

/** Every auth table that holds a `user_id`, read off the production catalog on 2026-10-13. Only
 *  `identities` and `sessions` carry a cascading foreign key to `auth.users`; `refresh_tokens` and
 *  `flow_state` hold a `user_id` with no foreign key at all, so nothing removes their rows when an
 *  account goes. */
const AUTH_ACCOUNT_TABLES = [
  "flow_state", "identities", "mfa_factors", "mfa_recovery_code_sets", "oauth_authorizations",
  "oauth_consents", "one_time_tokens", "refresh_tokens", "scim_users", "sessions",
  "webauthn_challenges", "webauthn_credentials",
];

/** The SQL the instrument would send for one labelled read, or the empty string if it offers none. */
function statementFor(out: string, label: string): string {
  const line = out.split("\n").find((entry) => entry.startsWith(`SQL ${label} `));
  return line ? line.replace(`SQL ${label} `, "") : "";
}

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
    for (const expected of ["auth-users", "account-state", "auth-residue", "ledger-census", "rls-coverage", "routine-posture", "default-privileges", "unindexed-foreign-keys", "migration-ledger", "owner-census"]) {
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
    const census = statementFor(out, "owner-census");
    expect(census, "no per-account census statement was offered").toBeTruthy();
    const instrumentPairs = [...census.matchAll(/select '(\w+)' as tbl, count\(\*\)(?: as \w+)? from public\.\1 where (\w+) = '/g)]
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
    const advisor = statementFor(out, "unindexed-foreign-keys");
    expect(advisor, "no foreign-key advisor statement was offered").toBeTruthy();
    expect(advisor).toMatch(/left join pg_index/i);
    expect(advisor).toMatch(/idx\.indkey is null/i);
    expect(advisor).toMatch(/nspname = 'public'/i);
  });

  // B05's last open half. Every other part of the fail-closed posture has been re-read on the real
  // project — routine grants, RLS coverage, and 92 anonymous probes that all died at the grant gate
  // — but `pg_default_acl` itself has never been read on hosted. The committed migration text and
  // the observable consequences are not the catalog row, and the blocker row says so. An empty
  // answer is a legitimate outcome, so this read must be one the operator can run again rather than
  // a claim in a document.
  it("reads the hosted default-privilege catalog rather than inferring it from consequences", async () => {
    const { out } = await run(["--dry-run"], {});
    const defaults = statementFor(out, "default-privileges");
    expect(defaults, "no default-privilege statement was offered").toBeTruthy();
    expect(defaults).toMatch(/from pg_default_acl/i);
    // Each aclitem has to be its own answer: a whole array on one line cannot be read against the
    // committed grant list.
    expect(defaults, "the default privileges are not broken out per grantee").toMatch(/unnest\s*\(\s*\w+\.defaclacl\s*\)/i);
    // Measured 2026-10-14: hosted refused this read the first time it was sent with
    // `set-returning functions are not allowed in COALESCE`. The spread has to come from a FROM
    // position so an empty or null array is carried by the join instead of by an expression the
    // parser rejects — and the failure message is what proves this was read from the catalog, not
    // guessed at.
    expect(defaults, "the spread is wrapped in an expression, which hosted rejects").not.toMatch(/coalesce\s*\(\s*unnest/i);
    expect(defaults, "the spread is not unnested from a FROM position").toMatch(/join\s+lateral\s+unnest\s*\(/i);
    // Which role's defaults, and for which scope — a schema entry and a database-wide entry mean
    // different things, and the grantor name is what proves the entry came from the migration role.
    expect(defaults).toMatch(/defaclrole/i);
    expect(defaults).toMatch(/pg_get_userbyid/i);
    expect(defaults, "a database-wide entry must not read as an empty schema").toMatch(/defaclnamespace/i);
    expect(defaults).toMatch(/database[- ]wide/i);
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

  // Measured on production 2026-10-13: one live account, but `auth.identities` holds 2 rows and
  // `auth.sessions` 11 whose `user_id` matches no user, plus 11 `auth.refresh_tokens` rows. Some
  // earlier account removal left referential residue behind in the auth schema. A census that only
  // counts the public tables would therefore report a clean erasure while rows naming the erased
  // account were still sitting in `auth` — which is the after-proof B17 is waiting on.
  it("counts the auth-schema rows that outlived the account they name", async () => {
    const { code, out } = await run(["--dry-run"], {});
    expect(code).toBe(0);
    const residue = statementFor(out, "auth-residue");
    for (const table of AUTH_ACCOUNT_TABLES) {
      expect(residue, `the residue read skips auth.${table}`).toContain(`auth.${table}`);
    }
    // Every table is counted twice: what it holds, and how much of it has no account behind it.
    expect(residue).toMatch(/rows_total/i);
    expect(residue, "a row is counted without an account only by the absence of a matching user").toMatch(/not exists \(select 1 from auth\.users/i);
    expect(residue).not.toContain(QA_OWNER);
  });

  it("reports each auth table's own referential action so a residue count can be attributed", async () => {
    const { out } = await run(["--dry-run"], {});
    const residue = statementFor(out, "auth-residue");
    expect(residue, "the residue read does not ask the catalog what the database would do").toMatch(/pg_constraint/i);
    expect(residue).toMatch(/auth\.users'::regclass/i);
    expect(residue, "a missing foreign key must read as missing rather than as a blank cell").toMatch(/coalesce/i);
  });

  it("counts the rows still tied to one account in the auth schema as well as the product tables", async () => {
    const { out } = await run(["--dry-run", "--owner", QA_OWNER], {});
    const residue = statementFor(out, "auth-residue");
    expect(residue, "the scoped census offers no per-account auth count").toMatch(/rows_for_owner/i);
    expect(residue).toContain(QA_OWNER);
    const tables = [...new Set([...residue.matchAll(/from auth\.(\w+)/g)].map((match) => match[1]))].sort();
    // `auth.users` itself appears once, as the anti-join every other count is measured against.
    expect(tables).toEqual([...AUTH_ACCOUNT_TABLES, "users"].sort());
  });

  it("carries the same auth table list whether or not an account was named", async () => {
    const unscoped = await run(["--dry-run"], {});
    const scoped = await run(["--dry-run", "--owner", QA_OWNER], {});
    const listed = (out: string) => [...new Set([...statementFor(out, "auth-residue").matchAll(/from auth\.(\w+)/g)].map((match) => match[1]))].sort();
    expect(listed(scoped.out)).toEqual(listed(unscoped.out));
    expect(listed(unscoped.out).length).toBe(AUTH_ACCOUNT_TABLES.length + 1);
  });

  // Measured on production 2026-10-15: the password grant answers `HTTP 400 / "Invalid login
  // credentials"` both for an address that has never been confirmed and for a confirmed account whose
  // password was just reset, so the sender's refusal text cannot tell a completed recovery from an
  // untouched one. The auth catalog can. This was first written against `password_changed_at`, and
  // production answered `column u.password_changed_at does not exist` — the hosted `auth.users` of
  // GoTrue v2.197.0 has no such column, so the read names the four it measured in that catalog dump
  // instead: when the address was confirmed, when the last sign-in landed, when the row last changed,
  // and when a recovery message was last requested.
  it("reads one named account's confirmation and recovery state from the auth catalog", async () => {
    const { code, out } = await run(["--dry-run", "--owner", QA_OWNER], {});
    expect(code).toBe(0);
    const state = statementFor(out, "account-state");
    expect(state, "no per-account auth state statement was offered").toBeTruthy();
    expect(state).toMatch(/from auth\.users/i);
    for (const column of ["email_confirmed_at", "last_sign_in_at", "updated_at", "recovery_sent_at"]) {
      expect(state, `the read does not ask for ${column}`).toMatch(new RegExp(column, "i"));
    }
    expect(state, "a confirmed address must not read as a blank cell").toMatch(/\) as email_confirmed\b/i);
    expect(state, "the read is not scoped to the account the operator named").toContain(QA_OWNER);
    // The one-way hash and the live one-time tokens sit in this same row. Reading them would carry a
    // spendable recovery link into an operator log, so the read names columns instead of the row.
    for (const secret of ["encrypted_password", "recovery_token", "confirmation_token", "email_change_token"]) {
      expect(state, `the read reaches the ${secret} column`).not.toMatch(new RegExp(secret, "i"));
    }
  });

  it("keeps per-account auth state out of a census that named no account", async () => {
    const { out } = await run(["--dry-run"], {});
    expect(statementFor(out, "account-state"), "an unscoped census would print every account's email and reset state").toBe("");
    const printed = statements(out).filter((statement) => /from auth\.users/i.test(statement));
    for (const statement of printed) {
      expect(statement, `an unscoped read prints account rows: ${statement.slice(0, 80)}`).not.toMatch(/\bselect\s+u\.email\b/i);
    }
  });
});
