#!/usr/bin/env node
// Gate 7 of the release record asks for a zero-cost backup *and* restore, and `hosted-db-backup.mjs` made
// the backup executable while the restore stayed a sentence. The first rehearsal ever run turned that
// sentence into a trap: the structure dump loaded into a plain `createdb` database reported 13 tables, 51
// functions and 21 triggers, and **0 of its 15 row-level-security policies**, because every policy calls
// `auth.uid()` and a bare database has no `auth` schema. psql exits 0 when one statement of a file fails
// without ON_ERROR_STOP, so that half-recovered database — with RLS enabled and no policy granting anyone
// anything — would have looked like a successful recovery.
//
// So this rehearses the recovery the way recovery actually happens: a target provisioned like a new
// Supabase project, the dump fed with ON_ERROR_STOP=1, and a proof built from what came back — the same
// nine-object census read from production over the session pooler and from the restored database. With
// `--rows`, the customer-row dump is loaded after the structure and every public table is counted on
// both sides, so "the rows restored" is a measurement rather than a claim. A row dump carries values
// that identify clients, so it is held to the backup instrument's rule — refused if it lives inside this
// temporarily-public repository — and a failed load prints only psql's ERROR line, never DETAIL or
// CONTEXT, which quote the rows.
//
// The credential follows the rules the backup instrument already keeps: read from the operator's off-repo
// password file, handed to psql through the environment, and scrubbed from every printed byte.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_REF = "ugzdqcytouwfdlcjujqv";
const DEFAULT_POOLER_HOST = "aws-0-ap-south-1.pooler.supabase.com";
const DEFAULT_POOLER_PORT = "5432";
const REQUIRED_SCHEMAS = ["auth", "extensions", "vault"];
const REDACTION = "[redacted-db-password]";
const projectRoot = path.resolve(import.meta.dirname, "..");

const passwordPath = () => process.env.DWEAVE_DB_PASSWORD_FILE ?? path.join(homedir(), ".config/dueweave/prod-db-password");
const dockerBin = () => process.env.DWEAVE_DOCKER_BIN ?? "docker";
const scrub = (text, secrets) => secrets.reduce((acc, secret) => (secret ? acc.split(secret).join(REDACTION) : acc), text);

/** True for a path the repository would track: inside it, or equal to it. */
function isInsideRepository(target) {
  const relative = path.relative(projectRoot, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseArgs(argv) {
  const options = {
    dump: "",
    rows: "",
    allowNonEmpty: false,
    container: process.env.DWEAVE_RESTORE_CONTAINER ?? "supabase_db_dueweave",
    database: process.env.DWEAVE_RESTORE_DATABASE ?? "postgres",
    ref: process.env.DWEAVE_PROJECT_REF ?? DEFAULT_REF,
    host: process.env.DWEAVE_POOLER_HOST ?? DEFAULT_POOLER_HOST,
    port: process.env.DWEAVE_POOLER_PORT ?? DEFAULT_POOLER_PORT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dump") options.dump = path.resolve(String(argv[++index] ?? ""));
    else if (flag === "--rows") options.rows = path.resolve(String(argv[++index] ?? ""));
    else if (flag === "--container") options.container = String(argv[++index] ?? "");
    else if (flag === "--database") options.database = String(argv[++index] ?? "");
    else if (flag === "--project-ref") options.ref = String(argv[++index] ?? "");
    else if (flag === "--pooler-host") options.host = String(argv[++index] ?? "");
    else if (flag === "--pooler-port") options.port = String(argv[++index] ?? "");
    else if (flag === "--allow-non-empty") options.allowNonEmpty = true;
    else {
      console.error(`usage: node scripts/hosted-db-restore-rehearsal.mjs --dump <file.sql> [--rows <file.sql>] [--container <name>] [--database <name>] [--allow-non-empty]`);
      return null;
    }
  }
  if (!options.dump) {
    console.error("usage: node scripts/hosted-db-restore-rehearsal.mjs --dump <file.sql> [--rows <file.sql>] [--allow-non-empty]");
    return null;
  }
  for (const value of [options.container, options.database]) {
    if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
      console.error(`REFUSED ${value} is not a usable container or database name.`);
      return null;
    }
  }
  return options;
}

/** One census, nine counts, read from whichever database the caller points at. The leading literal is the
 *  marker the operator's stand-in psql answers on; psql itself returns it as the first word of the row. */
function censusSql() {
  const counts = [
    "'CENSUS_PROBE'",
    "'tables='||(select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')",
    "'views='||(select count(*) from information_schema.views where table_schema='public')",
    "'functions='||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')",
    "'triggers='||(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal)",
    "'policies='||(select count(*) from pg_policies where schemaname='public')",
    "'indexes='||(select count(*) from pg_indexes where schemaname='public')",
    "'sequences='||(select count(*) from information_schema.sequences where sequence_schema='public')",
    "'rls_tables='||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity)",
    "'constraints='||(select count(*) from pg_constraint con join pg_namespace n on n.oid=con.connamespace where n.nspname='public')",
  ];
  return `select ${counts.join(" || ' ' || ")}`;
}

const parseCensus = (text) =>
  Object.fromEntries(
    text
      .trim()
      .split(/\s+/)
      .filter((part) => part.includes("="))
      .map((part) => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)]),
  );

/** Every public table's row count as one JSON object, so a table that vanished and a table that lost rows
 *  are both visible in one comparison. `query_to_xml` is what lets a single statement count tables whose
 *  names are not known ahead of time. */
function rowCensusSql() {
  return (
    "select 'ROWCOUNT_PROBE'||coalesce(json_object_agg(t,n),'{}'::json)::text from (" +
    "select c.relname as t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::bigint as n " +
    "from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace " +
    "where nsp.nspname='public' and c.relkind in ('r','p')" +
    ") s"
  );
}

const parseRowCensus = (text) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return {};
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
};

const renderRowCensus = (census) => Object.entries(census).map(([table, count]) => `${table}=${count}`).join(" ");

/** `docker exec` through an argv array — no shell string is ever built from an input. */
function dockerExec(args, { stdin, env } = {}) {
  return new Promise((resolve) => {
    const bin = dockerBin();
    const useStub = existsSync(bin);
    const command = useStub ? process.execPath : bin;
    const launch = useStub ? [bin, ...args] : args;
    const child = spawn(command, launch, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString()));
    child.stderr.on("data", (chunk) => (err += chunk.toString()));
    child.on("error", (error) => resolve({ code: 127, out: "", err: String(error) }));
    child.on("close", (code) => resolve({ code, out, err }));
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) return 1;

  let password = "";
  if (existsSync(passwordPath())) password = readFileSync(passwordPath(), "utf8").trim();
  if (!password) {
    console.error(`REFUSED no database password at ${scrub(passwordPath(), [])} — the hosted census needs it.`);
    return 1;
  }
  const secrets = [password, encodeURIComponent(password)];
  const say = (line) => console.log(scrub(line, secrets));

  if (!existsSync(options.dump)) {
    say(`REFUSED the dump file ${options.dump} does not exist — run scripts/hosted-db-backup.mjs first.`);
    return 1;
  }

  if (options.rows) {
    if (isInsideRepository(options.rows)) {
      say(`REFUSED the row dump ${options.rows} is inside the repository; it must land outside the repository, because this tree is published and the file holds customer rows.`);
      return 1;
    }
    if (!existsSync(options.rows)) {
      say(`REFUSED the row dump ${options.rows} does not exist — run scripts/hosted-db-backup.mjs --data first.`);
      return 1;
    }
  }

  const schemasResult = await dockerExec([
    "exec",
    options.container,
    "psql",
    "-h",
    "127.0.0.1",
    "-U",
    "postgres",
    "-d",
    options.database,
    "-tAc",
    "select nspname from pg_namespace where nspname in ('auth','extensions','vault','realtime','storage') order by nspname",
  ]);
  const present = new Set(schemasResult.out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = REQUIRED_SCHEMAS.filter((schema) => !present.has(schema));
  if (missing.length > 0) {
    say(
      `REFUSED ${options.container}/${options.database} has no ${missing.join(", ")} schema. A plain Postgres database is not a recovery target: ` +
        `this rehearsal measured it loading the application tables, functions and triggers while every row-level security policy failed on a missing auth.uid(), ` +
        `which leaves RLS enabled and no policy granting anyone anything. Provision a Supabase project (or a local stack created by supabase start) and rehearse against that.`,
    );
    return 1;
  }

  const nonEmptyResult = await dockerExec([
    "exec",
    options.container,
    "psql",
    "-h",
    "127.0.0.1",
    "-U",
    "postgres",
    "-d",
    options.database,
    "-tAc",
    "select 'NONEMPTY_PROBE='||count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
  ]);
  const existingTables = Number((nonEmptyResult.out.match(/NONEMPTY_PROBE=(\d+)/) ?? [])[1] ?? "0");
  if (existingTables > 0 && !options.allowNonEmpty) {
    say(
      `REFUSED ${options.container}/${options.database} already holds ${existingTables} public tables and this dump is not idempotent — ` +
        `restoring onto a populated database fails partway. Rehearse into a fresh database, or pass --allow-non-empty when you mean it.`,
    );
    return 1;
  }

  say(`TARGET ${options.container}/${options.database} carries the Supabase schemas this dump depends on (${[...present].join(", ")}).`);

  const hostedResult = await dockerExec(
    [
      "exec",
      // Key without value: `docker exec` gives the child the container's environment, not the client's, so
      // naming PGPASSWORD here is what copies it in — and writing it as KEY=VALUE would put the secret in
      // argv, where the process list can read it.
      "-e",
      "PGPASSWORD",
      options.container,
      "psql",
      "-h",
      options.host,
      "-p",
      options.port,
      "-U",
      `postgres.${options.ref}`,
      "-d",
      "postgres",
      "-tAc",
      censusSql(),
    ],
    { env: { PGPASSWORD: password } },
  );
  if (hostedResult.code !== 0 || !hostedResult.out.trim()) {
    say(`REFUSED the hosted census failed (exit ${hostedResult.code}): ${hostedResult.err.trim()}`);
    return 1;
  }

  const dump = readFileSync(options.dump, "utf8");
  const restoreResult = await dockerExec(
    ["exec", "-i", options.container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", options.database, "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    { stdin: dump },
  );
  if (restoreResult.code !== 0 || restoreResult.err.trim()) {
    say(`RESTORE FAILED exit=${restoreResult.code}`);
    say(scrub(restoreResult.err.trim(), secrets));
    return 1;
  }
  say(`RESTORED ${path.basename(options.dump)} into ${options.container}/${options.database} with ON_ERROR_STOP=1 and nothing on stderr.`);

  const restoredResult = await dockerExec([
    "exec",
    options.container,
    "psql",
    "-h",
    "127.0.0.1",
    "-U",
    "postgres",
    "-d",
    options.database,
    "-tAc",
    censusSql(),
  ]);
  const production = parseCensus(hostedResult.out.replace(/CENSUS_PROBE/g, ""));
  const restored = parseCensus(restoredResult.out.replace(/CENSUS_PROBE/g, ""));
  const render = (census) => Object.entries(census).map(([key, value]) => `${key}=${value}`).join(" ");

  say(`PRODUCTION ${render(production)}`);
  say(`RESTORED   ${render(restored)}`);

  const differences = Object.keys(production).filter((key) => production[key] !== restored[key]);
  if (differences.length > 0 || Object.keys(restored).length !== Object.keys(production).length) {
    say(`MISMATCH ${differences.map((key) => `${key}: production=${production[key]} restored=${restored[key] ?? "absent"}`).join(", ")}`);
    return 1;
  }
  say("MATCH the restored database holds the same object census as the live project.");

  if (options.rows) {
    const hostedRowsResult = await dockerExec(
      ["exec", "-e", "PGPASSWORD", options.container, "psql", "-h", options.host, "-p", options.port, "-U", `postgres.${options.ref}`, "-d", "postgres", "-tAc", rowCensusSql()],
      { env: { PGPASSWORD: password } },
    );
    if (hostedRowsResult.code !== 0 || !hostedRowsResult.out.trim()) {
      say(`REFUSED the hosted row census failed (exit ${hostedRowsResult.code}): ${hostedRowsResult.err.trim()}`);
      return 1;
    }

    const rowsDump = readFileSync(options.rows, "utf8");
    // `session_replication_role = replica` defers FK checks and disables user triggers for this session:
    // a public data dump names auth users whose identities live in another schema and are not in it, and
    // `--data-only` rows must land as they were rather than be re-derived by triggers.
    const rowsRestore = await dockerExec(
      ["exec", "-i", options.container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-d", options.database, "-q", "-v", "ON_ERROR_STOP=1", "-v", "DWEAVE_ROWS=1", "-c", "set session_replication_role = replica", "-f", "-"],
      { stdin: rowsDump },
    );
    if (rowsRestore.code !== 0 || rowsRestore.err.trim()) {
      say(`ROWS RESTORE FAILED exit=${rowsRestore.code}`);
      for (const line of rowsRestore.err.split(/\r?\n/)) {
        if (/\b(?:ERROR|FATAL|PANIC):/.test(line)) say(line);
      }
      say("NOTE pg DETAIL and CONTEXT are withheld: they quote the rows being loaded. Re-run the load in the operator's console if the ERROR line above is not enough.");
      return 1;
    }
    say(`ROWS LOADED ${path.basename(options.rows)} into ${options.container}/${options.database} with ON_ERROR_STOP=1 and session_replication_role=replica.`);

    const restoredRowsResult = await dockerExec([
      "exec",
      options.container,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-d",
      options.database,
      "-tAc",
      rowCensusSql(),
    ]);
    const productionRows = parseRowCensus(hostedRowsResult.out);
    const restoredRows = parseRowCensus(restoredRowsResult.out);
    say(`ROWS PRODUCTION ${renderRowCensus(productionRows)}`);
    say(`ROWS RESTORED ${renderRowCensus(restoredRows)}`);

    const tables = [...new Set([...Object.keys(productionRows), ...Object.keys(restoredRows)])];
    const rowDifferences = tables.filter((table) => productionRows[table] !== restoredRows[table]);
    if (rowDifferences.length > 0) {
      say(`ROWS MISMATCH ${rowDifferences.map((table) => `${table}: production=${productionRows[table] ?? "absent"} restored=${restoredRows[table] ?? "absent"}`).join(", ")}`);
      return 1;
    }
    say(`ROWS MATCH every public table came back with the same row count (${tables.length} tables).`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(String(error?.message ?? error));
    process.exit(1);
  });
