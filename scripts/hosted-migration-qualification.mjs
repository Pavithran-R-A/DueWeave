// Qualification for one forward migration against the hosted production project: read-only, except
// inside a transaction that cannot end without raising. Three rules, inherited from the pass that
// first ran this on 2026-10-17 and kept because each one is load-bearing:
//   * No replay may be attempted before a probe proves that a deliberately-aborted block persists
//     nothing through this CLI + pooler path. The CLI rejects a multi-statement string (`cannot
//     insert multiple commands into a prepared statement`), so `begin; …; rollback;` is not available
//     and the abort has to come from a raise inside one `do` block.
//   * The migration is then replayed inside such a block, and the routines it redefines are read
//     before and after and compared by digest: production must be byte-identical on both sides.
//   * The credential comes from the same off-repo file `scripts/hosted-db-census.mjs` uses, the
//     project is pinned to DueWeave production, and every byte printed is scrubbed.
//
// What this instrument never does is promote anything. `supabase db push` stays the owner's step;
// this answers whether that step is safe, and leaves the forward-restore file behind so the answer
// can be re-derived rather than remembered.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { cliPath, connectionUrl, passwordPath, query, scrub } from "./hosted-db-census.mjs";

const REDACTION = "[redacted-db-password]";

export const PRODUCTION_REF = "ugzdqcytouwfdlcjujqv";
const POOLER_HOST = "aws-0-ap-south-1.pooler.supabase.com";
const POOLER_PORT = "5432";

export const DEFAULT_MIGRATION = "supabase/migrations/20261017090000_current_cl39_edit_conflict_errcode_reachable.sql";
export const DEFAULT_REVERT_OUT = "supabase/rollback/20261017090000_revert_cl39_to_hosted_25_definition.sql";
const MIGRATION_VERSION = "20261017090000";
const PROBE_TABLE = "public.dw_cl39_rollback_probe";
const SIGNATURES = [
  "public.update_client(uuid, text, text, text, text, text, timestamp with time zone)",
  "public.update_receivable_details(uuid, text, text, text, timestamp with time zone)",
];
const ROUTINES = ["update_client", "update_receivable_details"];
const LEDGER_TABLES = ["clients", "receivables", "promises"];

/** Split SQL into top-level statements, tracking dollar-quoted bodies so the semicolons inside a
 *  plpgsql function do not cut it apart. Comments are dropped; a statement ends at a top-level
 *  semicolon. A naive `split(";")` here would produce a replay of nonsense, which is what the
 *  statement-count case in `tests/hosted-migration-qualification.contract.test.ts` holds shut.
 *
 *  Dropping comments is why this split is only ever used for the aborted replay: the block re-executes
 *  the migration minus its `--` lines, so the dry-run is semantically identical to the file and not
 *  byte-identical. `supabase db push` applies the file itself, comments and all. */
export function splitStatements(sql) {
  const statements = [];
  let current = "";
  let quote = null;
  let index = 0;
  while (index < sql.length) {
    if (sql.startsWith("--", index) && !quote) {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline + 1;
      current += "\n";
      continue;
    }
    const dollar = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(index));
    if (dollar && (!quote || quote === dollar[0])) {
      current += dollar[0];
      index += dollar[0].length;
      quote = quote ? null : dollar[0];
      continue;
    }
    if (sql[index] === "'") {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === "\\") end += 2;
        else if (sql[end] === "'") { end += 1; break; }
        else end += 1;
      }
      current += sql.slice(index, end);
      index = end;
      continue;
    }
    if (sql[index] === ";" && !quote) {
      if (current.trim()) statements.push(current.trim());
      current = "";
      index += 1;
      continue;
    }
    current += sql[index];
    index += 1;
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((statement) => /\S/.test(statement) && !statement.trimStart().startsWith("--"));
}

/** One routine's live body, with the digest the restore file has to reproduce. */
export function definitionRead(routine) {
  return `select md5(pg_get_functiondef(p.oid)) as definition_md5, length(pg_get_functiondef(p.oid)) as definition_chars, pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${routine}' order by 1`;
}

/** The transaction-abort proof: a table created and then abandoned by a raise in the same block. If
 *  this leaves the table behind, the replay would too, and nothing here may be attempted. */
export function probeBlock(table = PROBE_TABLE) {
  return `do $dwqualprobe$ begin execute 'create table ${table} (x int)'; raise exception 'dw-cl39 qualification probe: deliberate rollback'; end $dwqualprobe$;`;
}

/** Wrap a statement list so one aborted block replays all of it. Tags are chosen so they cannot
 *  collide with a tag used inside the migration's own bodies. */
export function dryRunBlock(statements, note = "dw-cl39 qualification dry-run complete: deliberate rollback") {
  const used = new Set();
  const body = statements
    .map((statement, position) => {
      let tag = `dwstmt${position}`;
      while (statement.includes(`$${tag}$`) || used.has(tag)) tag = `${tag}x`;
      used.add(tag);
      return `  execute $${tag}$\n${statement}\n$${tag}$;`;
    })
    .join("\n");
  return `do $dwqualdryrun$ begin\n${body}\n  raise exception '${note}';\nend $dwqualdryrun$;`;
}

/** The catalog reads that answer whether the migration is safe to promote, none of which writes. */
export function reads() {
  const signatureList = SIGNATURES.map((signature) => `'${signature}'::regprocedure`).join(", ");
  return [
    {
      label: "migration-ledger",
      sql: `select count(*) as recorded_migrations, min(version) as oldest_version, max(version) as newest_version, count(*) filter (where version = '${MIGRATION_VERSION}') as pending_version_applied from supabase_migrations.schema_migrations`,
    },
    {
      label: "routine-privileges",
      sql: `select p.proname as routine, r.grantee as grantee, has_function_privilege(r.grantee, p.oid, 'execute') as can_execute from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join (values ('anon'), ('authenticated'), ('service_role'), ('postgres')) as r(grantee) where n.nspname = 'public' and p.oid in (${signatureList}) order by 1, 2`,
    },
    {
      label: "routine-security-posture",
      sql: `select p.proname as routine, p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner, coalesce(nullif(array_to_string(p.proconfig, ','), ''), '(none)') as config from pg_proc p where p.oid in (${signatureList}) order by 1`,
    },
    {
      label: "routine-dependencies-out",
      sql: `select p.proname as routine, d.deptype as deptype, d.refclassid::regclass as referenced_class, d.refobjid as referenced_oid from pg_depend d join pg_proc p on p.oid = d.objid where d.classid = 'pg_proc'::regclass and d.objid in (${signatureList}) order by 1, 2, 3, 4`,
    },
    {
      label: "routine-dependencies-in",
      sql: `select p.proname as routine, count(d.objid) as dependents from pg_proc p left join pg_depend d on d.refclassid = 'pg_proc'::regclass and d.refobjid = p.oid and d.classid <> 'pg_proc'::regclass where p.oid in (${signatureList}) group by 1 order by 1`,
    },
    {
      label: "rows-the-write-paths-touch",
      sql: `${LEDGER_TABLES.map((table) => `select '${table}' as table_name, count(*) as rows, count(*) filter (where updated_at is null) as rows_null_updated_at from public.${table}`).join(" union all ")} order by 1`,
    },
    { label: "probe-target", sql: `select coalesce(to_regclass('${PROBE_TABLE}')::text, 'absent') as probe_table` },
  ];
}

/** The committed forward-restore: the definitions exactly as production held them, each prefixed by
 *  the digest a reader can re-derive over the bytes this file actually carries. */
export function revertFile(entries, capturedOn = "2026-10-17") {
  const digests = entries.map((entry) => `${entry.routine} ${digest(entry.definition)}`).join(", ");
  const header = [
    `-- Forward-restore file: the two edit routines exactly as production held them at 25`,
    `-- migrations, read from the live catalog with pg_get_functiondef on ${capturedOn} through the`,
    `-- credential path scripts/hosted-db-census.mjs uses, and re-emitted by`,
    `-- scripts/hosted-migration-qualification.mjs. Running this file undoes migration`,
    `-- ${MIGRATION_VERSION}_current_cl39_edit_conflict_errcode_reachable.sql: it restores the conflict`,
    `-- raise to SQLSTATE 40001, which is what made a stale edit unreachable (see`,
    `-- docs/CONSUMER_LIVE_PROGRESS.md, "Migration 26 qualification against production").`,
    `-- Captured md5 (each digest is md5 of the definition below it, newline included): ${digests}.`,
  ].join("\n");
  return `${header}\n${entries.map((entry) => `${entry.definition};`).join("\n")}\n`;
}

export const digest = (text) => createHash("md5").update(text).digest("hex");

function parseArgs(argv) {
  const options = { ref: PRODUCTION_REF, host: POOLER_HOST, port: POOLER_PORT, dryRun: false, migration: DEFAULT_MIGRATION, revertOut: DEFAULT_REVERT_OUT };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--project-ref") options.ref = String(argv[++index] ?? "");
    else if (flag === "--pooler-host") options.host = String(argv[++index] ?? "");
    else if (flag === "--pooler-port") options.port = String(argv[++index] ?? "");
    else if (flag === "--migration") options.migration = String(argv[++index] ?? "");
    else if (flag === "--revert-out") options.revertOut = String(argv[++index] ?? "");
    else {
      console.error(`unknown argument: ${flag}`);
      console.error("usage: node scripts/hosted-migration-qualification.mjs [--dry-run] [--migration <path>] [--revert-out <path>] [--project-ref <ref>] [--pooler-host <host>] [--pooler-port <port>]");
      process.exit(2);
    }
  }
  return options;
}

/** The span of `text` that closes the JSON value opened at its first bracket, so whatever the CLI
 *  appends afterwards is left out of the parse. String contents are walked past rather than counted:
 *  a routine body carries both brackets and escaped quotes, and reading them as structure is what
 *  made the first version of this parser answer `null` for output that held a real definition. */
function jsonSpan(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[" || character === "{") depth += 1;
    else if (character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(0, index + 1);
    }
  }
  return "";
}

/** The CLI's version advisory lands on the same stdout as the answer, so the JSON is found rather
 *  than assumed; `null` means "this answer cannot be fingerprinted", which fails the run closed. */
export function parseJsonRows(text) {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trimStart().startsWith("[")) continue;
    try {
      const parsed = JSON.parse(jsonSpan(lines.slice(index).join("\n")));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // not the answer: a bracket in prose can open a line, and guessing with it would be worse
      // than failing closed
    }
  }
  return null;
}

const oneLine = (sql) => sql.replace(/\s+/g, " ").trim();

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.ref !== PRODUCTION_REF) {
    console.error(`refused: this instrument only addresses DueWeave production (project ref ${PRODUCTION_REF}), not ${options.ref}`);
    return 2;
  }
  console.log(`TARGET ref=${options.ref} user=postgres.${options.ref} host=${options.host} port=${options.port} database=postgres password=${REDACTION}`);
  console.log(`MIGRATION ${path.relative(process.cwd(), options.migration) || options.migration}`);

  const plan = reads();
  const statements = splitStatements(readFileSync(options.migration, "utf8"));
  const probe = probeBlock();
  const replay = dryRunBlock(statements);
  for (const read of plan) console.log(`SQL READ ${read.label} ${oneLine(read.sql)}`);
  console.log(`SQL STATEMENTS ${statements.length}`);
  console.log(`SQL PROBE ${oneLine(probe)}`);
  console.log(`SQL REPLAY ${oneLine(replay)}`);
  if (options.dryRun) {
    console.log(`DRY-RUN ${plan.length + 2} statements listed; nothing sent, nothing replayed`);
    return 0;
  }

  const file = passwordPath();
  if (!existsSync(file)) {
    console.error(`refused: no hosted database password at ${file} — it lives off-repo at ~/.config/dueweave/prod-db-password, mode 600`);
    return 1;
  }
  const password = readFileSync(file, "utf8").trim();
  const url = connectionUrl(options.ref, options.host, options.port, password);
  const secrets = [password, encodeURIComponent(password)];
  const cli = cliPath();
  const send = async (label, sql, format) => {
    const result = await query(cli, url, sql, format);
    const text = scrub(result.text, secrets);
    console.log(`\nSTEP ${label} exit=${result.code}`);
    console.log(text.trimEnd());
    return { ...result, text };
  };
  const readDefinition = async (phase, routine) => {
    const result = await send(`${phase}-definition ${routine}`, definitionRead(routine), "json");
    const rows = parseJsonRows(result.text);
    const row = Array.isArray(rows) ? rows.find((entry) => typeof entry.definition === "string") : null;
    if (!row) {
      console.log(`FAILED ${phase}-definition ${routine}: the answer carries no definition to fingerprint`);
      return null;
    }
    return { routine, md5: row.definition_md5, chars: row.definition_chars, definition: row.definition };
  };

  for (const read of plan) await send(`read ${read.label}`, read.sql);

  const before = [];
  for (const routine of ROUTINES) {
    const entry = await readDefinition("before", routine);
    if (!entry) return 1;
    before.push(entry);
  }

  const probeResult = await send("rollback-mechanism-probe", probe);
  const probeAfter = await send("probe-target-after", `select coalesce(to_regclass('${PROBE_TABLE}')::text, 'absent') as probe_table`);
  const mechanismProved = /deliberate rollback/i.test(probeResult.text) && /\babsent\b/.test(probeAfter.text);
  console.log(`\nVERDICT mechanism_proved=${mechanismProved}`);
  if (!mechanismProved) {
    console.log("REFUSED replay: a rolled-back block did not behave as nothing on this path, so the dry-run could leave state behind.");
    return 1;
  }

  const replayResult = await send("migration-dry-run", replay);
  const after = [];
  for (const routine of ROUTINES) {
    const entry = await readDefinition("after", routine);
    if (!entry) return 1;
    after.push(entry);
  }
  const probeFinal = await send("probe-target-final", `select coalesce(to_regclass('${PROBE_TABLE}')::text, 'absent') as probe_table`);

  let identical = true;
  for (const entry of before) {
    const counterpart = after.find((candidate) => candidate.routine === entry.routine);
    const same = counterpart.md5 === entry.md5;
    identical = identical && same;
    console.log(`COMPARE ${entry.routine} before=${entry.md5} after=${counterpart.md5} identical=${same}`);
  }
  const raised = /deliberate rollback/i.test(replayResult.text);
  const clean = /\babsent\b/.test(probeFinal.text);
  console.log(`DRY-RUN statements=${statements.length} raised-rollback=${raised} probe_absent_final=${clean} definitions_identical=${identical}`);

  if (!(raised && clean && identical)) {
    console.log("NOT QUALIFIED: production is not byte-identical on both sides of the replay, so no restore file was written.");
    return 1;
  }
  mkdirSync(path.dirname(path.resolve(options.revertOut)), { recursive: true });
  writeFileSync(options.revertOut, revertFile(before), "utf8");
  console.log(`WROTE ${options.revertOut}`);
  console.log(`QUALIFIED migration=${MIGRATION_VERSION} statements=${statements.length} restore_digests=${before.map((entry) => `${entry.routine} ${entry.md5}`).join(", ")}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
