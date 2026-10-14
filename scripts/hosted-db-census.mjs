#!/usr/bin/env node
// The hosted production database has been read this release line by hand-typed queries, and each
// hand query left behind a claim the next session could not re-derive. This instrument answers the
// same questions again from the repository: how many accounts exist, whether any customer data is
// present, whether every table is still row-security-enforced, what the routine grants say now that
// migration 25 is applied, what the default-privilege catalog actually records for the role these
// migrations run as, which foreign keys the advisor still calls unindexed, and how many rows
// belong to one account — the before/after half of the erasure acceptance that `B17` still lacks.
//
// Two rules make it safe to point at production:
//   * It has no path to a statement it did not author. The SQL below is a frozen list of read-only
//     queries; there is no flag that accepts SQL, so the only way to write is to edit this file.
//   * The credential never leaves the connection string. It is read from an off-repo file, is
//     percent-encoded into the URL, and every byte the CLI prints is scrubbed of both forms.
//
// The database is reachable here through the session pooler, not the direct host: `db.<ref>` answers
// AAAA-only, and a network without an IPv6 route cannot use it. Measured 2026-10-13.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_REF = "ugzdqcytouwfdlcjujqv";
const DEFAULT_POOLER_HOST = "aws-0-ap-south-1.pooler.supabase.com";
const DEFAULT_POOLER_PORT = "5432";
const REDACTION = "[redacted-db-password]";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every table the product owns, so a census that silently skipped one would be visible in its count. */
const TABLES = [
  "activities", "analytics_events", "clients", "entitlements", "founder_admins",
  "founder_audit_events", "founder_offer_config", "payments", "profiles",
  "promise_events", "promises", "purchase_claims", "receivables",
];

/** The column that ties each table's rows to one account. Taken from the committed erasure
 *  migration's own DELETE statements, plus the RESTRICTing audit column it cannot delete from. */
const OWNER_COLUMN = {
  activities: "owner_id",
  analytics_events: "owner_id",
  clients: "owner_id",
  entitlements: "user_id",
  founder_admins: "user_id",
  founder_audit_events: "target_user_id",
  payments: "owner_id",
  profiles: "id",
  promise_events: "owner_id",
  promises: "owner_id",
  purchase_claims: "owner_id",
  receivables: "owner_id",
};

/** Every auth table that holds a `user_id`, read off the production catalog on 2026-10-13. Only
 *  `identities` and `sessions` carry a foreign key to `auth.users`; `refresh_tokens` and `flow_state`
 *  name an account with no foreign key behind it at all. Production then held 2 identities, 11
 *  sessions and 11 refresh tokens whose account is gone, so the erasure proof has to count this
 *  schema rather than assume the public-table purge is the whole of it. */
const AUTH_ACCOUNT_TABLES = [
  "flow_state", "identities", "mfa_factors", "mfa_recovery_code_sets", "oauth_authorizations",
  "oauth_consents", "one_time_tokens", "refresh_tokens", "scim_users", "sessions",
  "webauthn_challenges", "webauthn_credentials",
];

/** One row per auth table: how many rows it holds, how many name an account that no longer exists,
 *  what the database itself would have done to those rows on a delete, and — when an account was
 *  named — how many rows still name that account. */
function authResidueSql(owner) {
  return AUTH_ACCOUNT_TABLES.map((table) => {
    const columns = [
      `select '${table}' as auth_table, coalesce((select string_agg(c.confdeltype::text, ',' order by c.conname) from pg_constraint c where c.contype = 'f' and c.conrelid = 'auth.${table}'::regclass and c.confrelid = 'auth.users'::regclass), 'no foreign key') as fk_to_users`,
      `(select count(*) from auth.${table}) as rows_total`,
      `(select count(*) from auth.${table} a where a.user_id is not null and not exists (select 1 from auth.users u where u.id::text = a.user_id::text)) as rows_without_user`,
    ];
    if (owner) columns.push(`(select count(*) from auth.${table} a where a.user_id::text = '${owner}') as rows_for_owner`);
    return columns.join(", ");
  }).join(" union all ") + " order by 1";
}

const POSTURE = "with f as (select p.oid, p.prosecdef, coalesce(nullif(array_to_string(p.proconfig, ','), ''), '(none)') as config, pg_get_userbyid(p.proowner) as owner, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec, has_function_privilege('service_role', p.oid, 'execute') as svc_exec from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') select count(*) as routines, count(*) filter (where prosecdef) as security_definer, count(*) filter (where config like '%search_path%') as search_path_pinned, count(*) filter (where anon_exec) as anon_execute, count(*) filter (where svc_exec) as service_execute, count(*) filter (where owner <> 'postgres') as non_postgres_owner, count(*) filter (where prosecdef and config not like '%search_path%') as definer_unpinned from f";

const ADVISOR = "select class.relname as table_name, attr.attname as column_name, con.conname as constraint_name from pg_class class join pg_constraint con on con.conrelid = class.oid join pg_namespace nsp on nsp.oid = class.relnamespace join pg_attribute attr on attr.attrelid = class.oid and attr.attnum = con.conkey[1] left join pg_index idx on idx.indrelid = class.oid and idx.indkey[0] = attr.attnum where con.contype = 'f' and idx.indkey is null and nsp.nspname = 'public' order by 1, 2";

// B05's last open half: the fail-closed default privileges have been proved on hosted by their
// consequences (0 anonymous grants, 92 probes refused) and by the committed `alter default
// privileges` text, never by reading the catalog that holds them. One row per grantee, because a
// whole aclitem array on one line cannot be compared against the grant list the migration claims.
// The array is spread from a LATERAL join rather than inside an expression: hosted answered the
// first shape of this read with `set-returning functions are not allowed in COALESCE`, measured
// 2026-10-14, and the outer join is what keeps a role with no recorded default visible as one row
// instead of silently contributing no rows at all.
const DEFAULT_PRIVILEGES = "select pg_get_userbyid(d.defaclrole) as owner_role, case when d.defaclnamespace = 0 then 'database-wide' else n.nspname end as scope, coalesce(acl.entry::text, '(no default privileges recorded)') as default_privilege from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace left join lateral unnest(d.defaclacl) as acl(entry) on true order by 1, 2, 3";

function census(owner) {
  const reads = [
    { label: "migration-ledger", sql: "select count(*) as recorded_migrations, max(version) as newest_version from supabase_migrations.schema_migrations" },
    {
      label: "auth-users",
      sql: "select (select count(*) from auth.users) as users_total, (select count(*) from auth.users where email_confirmed_at is not null) as confirmed, (select count(*) from auth.users where email_confirmed_at is null) as unconfirmed, (select count(*) from auth.users where is_sso_user) as sso_users, (select count(*) from auth.identities) as identities, (select count(*) from auth.sessions) as sessions, (select min(created_at) from auth.users) as oldest_user, (select max(created_at) from auth.users) as newest_user",
    },
    { label: "auth-residue", sql: authResidueSql(owner) },
    {
      label: "ledger-census",
      sql: TABLES.map((table) => `select '${table}' as tbl, count(*) as rows from public.${table}`).join(" union all ") + " order by 2 desc, 1",
    },
    {
      label: "rls-coverage",
      sql: "select count(*) filter (where c.relrowsecurity) as rls_enabled, count(*) as public_tables, (select count(*) from pg_policy pol join pg_class k on k.oid = pol.polrelid join pg_namespace n on n.oid = k.relnamespace where n.nspname = 'public') as policies from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'",
    },
    { label: "routine-posture", sql: POSTURE },
    { label: "default-privileges", sql: DEFAULT_PRIVILEGES },
    { label: "unindexed-foreign-keys", sql: ADVISOR },
  ];
  if (owner) {
    reads.push({
      label: "owner-census",
      sql: Object.entries(OWNER_COLUMN)
        .map(([table, column]) => `select '${table}' as tbl, count(*) as rows from public.${table} where ${column} = '${owner}'::uuid`)
        .join(" union all "),
    });
  }
  return reads;
}

function parseArgs(argv) {
  const options = { owner: "", ref: DEFAULT_REF, host: DEFAULT_POOLER_HOST, port: DEFAULT_POOLER_PORT, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--owner") options.owner = String(argv[++index] ?? "");
    else if (flag === "--project-ref") options.ref = String(argv[++index] ?? "");
    else if (flag === "--pooler-host") options.host = String(argv[++index] ?? "");
    else if (flag === "--pooler-port") options.port = String(argv[++index] ?? "");
    else {
      console.error(`unknown argument: ${flag}`);
      console.error("usage: node scripts/hosted-db-census.mjs [--owner <uuid>] [--dry-run] [--project-ref <ref>] [--pooler-host <host>] [--pooler-port <port>]");
      process.exit(2);
    }
  }
  if (options.owner && !UUID.test(options.owner)) {
    console.error(`refused: --owner must be a uuid, got ${options.owner}`);
    process.exit(2);
  }
  return options;
}

const passwordPath = () => process.env.DWEAVE_DB_PASSWORD_FILE ?? path.join(homedir(), ".config/dueweave/prod-db-password");
const cliPath = () => process.env.DWEAVE_SUPABASE_CLI ?? path.resolve("node_modules/supabase/dist/supabase.js");
const scrub = (text, secrets) => secrets.reduce((acc, secret) => (secret ? acc.split(secret).join(REDACTION) : acc), text);

// The pooler selects the project through the user name (`postgres.<ref>`), so the ref belongs in the
// credential's user part rather than the host. The URL is assembled through the parser instead of
// written out as `user:password@host`: the release tree may not carry a line shaped like a live
// connection string, secret or not, because `scripts/verify-secrets.mjs` treats that shape as a hard
// finding and a template that only *looks* assembled is one edit away from a real one.
function connectionUrl(ref, host, port, password) {
  const url = new URL(`postgresql://${encodeURIComponent(`postgres.${ref}`)}@${host}:${port}/postgres`);
  url.password = encodeURIComponent(password);
  return url.toString();
}

function query(cli, url, sql) {
  return new Promise((resolve) => {
    // The URL carries the credential, so it is passed as an argument to a direct spawn and never
    // through a shell: a shell would put it in a command line that other tooling can read back.
    const child = spawn(process.execPath, [cli, "db", "query", "--db-url", url, sql], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("error", (error) => resolve({ code: 1, text: `could not start the Supabase CLI: ${error.message}\n` }));
    child.on("close", (code) => resolve({ code, text: out }));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const reads = census(options.owner);
  console.log(`TARGET ref=${options.ref} user=postgres.${options.ref} host=${options.host} port=${options.port} database=postgres password=${REDACTION}`);
  for (const read of reads) console.log(`SQL ${read.label} ${read.sql}`);
  if (options.dryRun) {
    console.log(`DRY-RUN ${reads.length} statements listed; none sent, nothing read`);
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
  let failed = 0;
  for (const read of reads) {
    console.log(`READ ${read.label}`);
    const result = await query(cli, url, read.sql);
    process.stdout.write(scrub(result.text, secrets));
    if (result.code !== 0) {
      failed += 1;
      console.log(`FAILED ${read.label} exit=${result.code}`);
    }
  }
  console.log(`DONE ${reads.length - failed}/${reads.length} reads answered`);
  return failed === 0 ? 0 : 1;
}

main().then((code) => process.exit(code), (error) => {
  console.error(`census failed: ${error?.message ?? error}`);
  process.exit(1);
});
