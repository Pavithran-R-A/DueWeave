// A stand-in for `supabase db query` used by tests/hosted-account-erasure.contract.test.ts.
//
// It answers each frozen census statement with the JSON row shape production actually returned on
// 2026-10-15, and it refuses anything that does not ask for `--output-format json`: the erasure
// instrument is only trustworthy if its before/after numbers are parsed, not read off a text table.
import process from "node:process";

const argv = process.argv.slice(2);
const sql = argv[argv.length - 1];
const format = argv.indexOf("--output-format");

const AUTH_RESIDUE = [
  { auth_table: "flow_state", fk_to_users: "no foreign key", rows_total: 0, rows_without_user: 0, rows_for_owner: 0 },
  { auth_table: "identities", fk_to_users: "c", rows_total: 4, rows_without_user: 2, rows_for_owner: 1 },
  { auth_table: "one_time_tokens", fk_to_users: "c", rows_total: 2, rows_without_user: 0, rows_for_owner: 1 },
  { auth_table: "refresh_tokens", fk_to_users: "no foreign key", rows_total: 14, rows_without_user: 11, rows_for_owner: 1 },
  { auth_table: "sessions", fk_to_users: "c", rows_total: 14, rows_without_user: 11, rows_for_owner: 1 },
];

const LEDGER = {
  activities: 5, analytics_events: 0, clients: 1, entitlements: 2, founder_admins: 0, founder_audit_events: 0,
  founder_offer_config: 1, payments: 1, profiles: 2, promise_events: 1, promises: 1, purchase_claims: 0, receivables: 1,
};

const OWNER = {
  activities: 5, analytics_events: 0, clients: 1, entitlements: 1, founder_admins: 0, founder_audit_events: 0,
  payments: 1, profiles: 1, promise_events: 1, promises: 1, purchase_claims: 0, receivables: 1,
};

function answer() {
  if (/users_total/.test(sql)) {
    return [{ users_total: 2, confirmed: 1, unconfirmed: 1, sso_users: 0, identities: 4, sessions: 14, oldest_user: "2026-10-12 15:20:58.091956 +0000 UTC", newest_user: "2026-10-14 11:02:31.448102 +0000 UTC" }];
  }
  if (/recovery_sent_at/.test(sql)) {
    return [{ account: "dueweave+releaseqa-20261012@gmail.com", email_confirmed: true, email_confirmed_at: "2026-10-12 15:31:02.113174 +0000 UTC", recovery_sent_at: null, last_sign_in_at: "2026-10-15 06:12:44.902118 +0000 UTC", updated_at: "2026-10-15 06:12:44.902118 +0000 UTC" }];
  }
  if (/rows_for_owner/.test(sql)) return AUTH_RESIDUE;
  const scoped = sql.includes("::uuid");
  const source = scoped ? OWNER : LEDGER;
  return Object.entries(source).map(([tbl, rows]) => ({ tbl, rows }));
}

console.log("Connecting to remote database...");
if (format < 0 || argv[format + 1] !== "json") {
  console.log("STUB refused: the census answer is only shaped as JSON when the caller asks for it");
  process.exit(3);
}
console.log(JSON.stringify(answer(), null, 2));
console.log("A new version of Supabase CLI is available: v2.121.0 (currently installed v2.117.0)");
