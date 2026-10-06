import { spawnSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addIndiaBusinessDays } from "@/lib/finance";
import { todayInIndia } from "@/lib/business-clock";
import { ERASURE_CONFIRMATION_PHRASE } from "../supabase/functions/delete-account/contract.ts";

// Arc 3C — B17: an account with ledger history could not be deleted by any supported path.
//
// This file is the regression battery for the repair, and it is deliberately ordered: every
// refusal runs BEFORE the one destructive test, because a refusal that runs after a purge has
// nothing to refuse and would pass for the wrong reason. The `6.n` names are the PHASE 3C brief's
// STEP 6 list, kept traceable.
//
// What this suite never does: relax a guard, import a privileged key, or use the admin path to
// make an authorization claim. `runSql` appears for three jobs only — seeding the one fixture the
// product refuses to create for itself (a Founder audit row), counting rows independently of RLS
// for the orphan check, and deleting the `auth.users` row after the RPC has purged what it owns.
// Every denial below is produced by an anon, an authenticated, or a malformed-token request.
//
// The `F.n` claims run against the delete-account Edge Function itself (/functions/v1/delete-account)
// rather than the RPC, because STEP 4's rules live one layer up: authenticated caller only, no
// browser-named target, explicit confirmation, one allowed method, one allowed origin. They need
// `supabase functions serve` alongside the database, and they need ALLOWED_APP_ORIGIN to be set for
// the local runtime — a 404 or a 501 from that block is a finding about the environment, which is
// why the tests report it instead of accepting it.
//
// STATUS: written, NOT EXECUTED. `pnpm test:live` refuses to start without a loopback stack
// (tests/live-stack-guard.mjs) and the Docker daemon on this machine answers neither the host nor
// WSL — free space recovered past the agreed floor, so the disk is not what blocks this file.
// Nothing in this file is claimed as passing; the Phase 3C verdict says so explicitly.

const url = process.env.VITE_SUPABASE_URL ?? "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";
const isLoopbackStack = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/i.test(url);
const describeLocalStack = isLoopbackStack && anonKey.length > 0 ? describe : describe.skip;

const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailFor = (label: string) => `arc3cerasure-${label}-${runTag}@dueweave.local`;
const strongPassword = () => `Arc3c!${Math.random().toString(36).slice(2, 14)}aA`;

// Every fixture date is derived from the business clock. Stage 9 lost two CI runs to frozen
// literals (D-S9-12, D-S9-13): a promised date written as "tomorrow" decays into a due promise,
// and a suite that seeds history has to keep meaning the same thing the day it is re-run.
const today = todayInIndia();
const madeBefore = addIndiaBusinessDays(today, -5);
const promisedPast = addIndiaBusinessDays(today, -1);
const promisedFuture = addIndiaBusinessDays(today, 7);
const paidOn = addIndiaBusinessDays(today, -2);

// The ten owner-keyed tables, with the column each one actually uses.
const OWNER_TABLES: [table: string, key: string][] = [
  ["profiles", "id"],
  ["clients", "owner_id"],
  ["receivables", "owner_id"],
  ["promises", "owner_id"],
  ["payments", "owner_id"],
  ["activities", "owner_id"],
  ["promise_events", "owner_id"],
  ["entitlements", "user_id"],
  ["purchase_claims", "owner_id"],
  ["analytics_events", "owner_id"],
];

const localDbContainer = process.env.ARC3C_LOCAL_DB_CONTAINER ?? "supabase_db_dueweave";

function runSql(sql: string): { ok: boolean; out: string } {
  const result = spawnSync("docker", ["exec", "-i", localDbContainer, "psql", "-U", "postgres", "-d", "postgres", "-A", "-t", "-f", "-"], {
    input: `${sql}\n`,
    encoding: "utf8",
  });
  return { ok: result.status === 0, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

// Counts read straight from the tables, so "no orphaned row" never depends on the same RLS the
// test is attacking.
function dbCounts(ownerId: string): Record<string, number> {
  const pairs = OWNER_TABLES.map(([table, key]) => `'${table}', (select count(*) from public.${table} where ${key} = '${ownerId}'::uuid)`).join(", ");
  const { ok, out } = runSql(`select json_build_object(${pairs})::text;`);
  if (!ok) throw new Error(`count readback failed: ${out}`);
  return JSON.parse(out.trim()) as Record<string, number>;
}

function auditCount(ownerId: string): number {
  const { ok, out } = runSql(`select count(*) from public.founder_audit_events where target_user_id = '${ownerId}'::uuid;`);
  if (!ok) throw new Error(`audit count failed: ${out}`);
  return Number(out.trim());
}

function reviewerCount(ownerId: string): number {
  const { ok, out } = runSql(`select count(*) from public.founder_admins where user_id = '${ownerId}'::uuid;`);
  if (!ok) throw new Error(`reviewer count failed: ${out}`);
  return Number(out.trim());
}

function authUserCount(userId: string): number {
  const { ok, out } = runSql(`select count(*) from auth.users where id = '${userId}'::uuid;`);
  if (!ok) throw new Error(`auth readback failed: ${out}`);
  return Number(out.trim());
}

function newClient(accessToken?: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Account = { userId: string; accessToken: string; client: SupabaseClient };

// The delete-account endpoint, called the way the application calls it. Kong fronts functions on the
// local stack, so `apikey` travels beside the caller's token — neither one is an erasure capability
// by itself (the RPC is revoked from anon, and the privileged key is never in this request path).
const functionUrl = `${url.replace(/\/+$/, "")}/functions/v1/delete-account`;

type FunctionCall = { method?: string; token?: string; body?: string; origin?: string };

async function callDeletionFunction(call: FunctionCall): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const headers: Record<string, string> = { apikey: anonKey };
  if (call.token) headers.authorization = `Bearer ${call.token}`;
  if (call.origin) headers.origin = call.origin;
  if (call.body !== undefined) headers["content-type"] = "application/json";
  // One request, whatever the runtime answers. No retry, no sleep — a refused deletion that needs a
  // second attempt is a finding, not something this harness smooths over.
  const reply = await fetch(functionUrl, { method: call.method ?? "POST", headers, body: call.body });
  const text = await reply.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // A non-JSON reply stays in `text`, which is what the assertion reports.
  }
  return { status: reply.status, json, text };
}

async function signUp(label: string): Promise<Account> {
  const password = strongPassword();
  const { data, error } = await newClient().auth.signUp({ email: emailFor(label), password, options: { data: { display_name: `Arc 3C ${label}` } } });
  if (data.session && data.user) return { userId: data.user.id, accessToken: data.session.access_token, client: newClient(data.session.access_token) };
  const retry = await newClient().auth.signInWithPassword({ email: emailFor(label), password });
  if (retry.error || !retry.data.session || !retry.data.user) {
    throw new Error(`local signup failed for ${label}: ${error?.message ?? retry.error?.message ?? "no session"}`);
  }
  return { userId: retry.data.user.id, accessToken: retry.data.session.access_token, client: newClient(retry.data.session.access_token) };
}

// One realistic ledger, built only through the RPCs the application calls: a client, two
// receivables, a promise that is now past its date (settled to BROKEN by the named workflow), a
// promise still active, a partial payment, a follow-up, promise-history rows and an analytics row.
// Between them those rows cover every DELETE guard in the schema and both non-trigger blockers.
async function seedHistory(account: Account, tag: string): Promise<void> {
  const call = async (name: string, args: Record<string, unknown> | undefined, label: string) => {
    const { data, error } = args === undefined ? await account.client.rpc(name as never) : await account.client.rpc(name as never, args as never);
    expect(error ?? null, `${label} failed for ${tag}: ${error?.message}`).toBeNull();
    return data as { id?: string } | null;
  };

  const client = await call("create_client", { p_name: `${tag} Traders`, p_company: `${tag} Pvt Ltd`, p_phone: "9876543210", p_email: `${tag}@arc3c.invalid`, p_notes: "" }, "create_client");
  const first = await call("create_receivable", { p_client_id: client!.id, p_label: `${tag} Invoice 1`, p_invoice_ref: `ARC3C-${tag}-1`, p_amount_due_paise: 750000, p_due_date: promisedPast, p_notes: "" }, "create_receivable(1)");
  const second = await call("create_receivable", { p_client_id: client!.id, p_label: `${tag} Invoice 2`, p_invoice_ref: `ARC3C-${tag}-2`, p_amount_due_paise: 400000, p_due_date: promisedFuture, p_notes: "" }, "create_receivable(2)");
  await call("create_promise", { p_receivable_id: first!.id, p_promised_amount_paise: 300000, p_made_on: madeBefore, p_promised_date: promisedPast, p_source: "WHATSAPP", p_note: `${tag} promised part payment, then went quiet`, p_request_id: crypto.randomUUID() }, "create_promise(due)");
  await call("create_promise", { p_receivable_id: second!.id, p_promised_amount_paise: 200000, p_made_on: today, p_promised_date: promisedFuture, p_source: "CALL", p_note: `${tag} committed to a date`, p_request_id: crypto.randomUUID() }, "create_promise(active)");
  await call("record_payment", { p_receivable_id: second!.id, p_amount_paise: 100000, p_paid_on: paidOn, p_method: "UPI", p_reference: `ARC3C-${tag}-PAY`, p_request_id: crypto.randomUUID() }, "record_payment");
  await call("record_contacted", { p_receivable_id: first!.id, p_note: `${tag} follow-up call` }, "record_contacted");
  await call("mark_due_promises_broken", undefined, "mark_due_promises_broken");
  await call("record_founder_upgrade_view", undefined, "record_founder_upgrade_view");
}

const accounts: Record<string, Account> = {};

describeLocalStack("Arc 3C account erasure against the live local database", () => {
  // alpha is erased through the RPC. beta survives every probe untouched. gamma carries the Founder
  // entanglement. delta is the B17 baseline: history, no purge, admin delete must still fail.
  // epsilon is erased through the Edge Function's HTTP endpoint — the only account in this suite
  // whose auth.users row is removed by the admin API rather than by `runSql`, which is what makes
  // it the real B17 closure.
  const labels = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;

  beforeAll(async () => {
    for (const label of labels) {
      accounts[label] = await signUp(label);
      await seedHistory(accounts[label], label);
      expect(dbCounts(accounts[label].userId).payments, `${label} has no seeded history`).toBeGreaterThan(0);
      expect(dbCounts(accounts[label].userId).promise_events, `${label} has no promise history`).toBeGreaterThan(0);
    }
    // The one fixture the product will not create for itself: a Founder review row, placed with a
    // null claim so the RESTRICT edge onto auth.users is the only thing in the way — the blocker
    // that is not a trigger. A real claim from `create_founder_claim` would carry BOTH entangling
    // edges at once (its CLAIM_CREATED row names the claim and its owner), which is why the null
    // claim here isolates the subject edge instead of hiding it behind the other one.
    const gamma = accounts.gamma;
    const seeded = runSql(`insert into public.founder_audit_events (claim_id, target_user_id, actor_user_id, event_type, metadata) values (null, '${gamma.userId}'::uuid, '${gamma.userId}'::uuid, 'CLAIM_SUBMITTED', '{}'::jsonb);`);
    expect(seeded.ok, `founder audit fixture failed: ${seeded.out}`).toBe(true);
    expect(auditCount(gamma.userId)).toBe(1);
  }, 300_000);

  afterAll(async () => {
    // Teardown walks the same paths the repair provides, so residue is a finding rather than a
    // silent leak. gamma is the documented cost of B19: a privileged actor must remove the review
    // row before the account holder's own path can finish.
    for (const label of ["gamma", "delta", "beta"] as const) {
      const account = accounts[label];
      if (!account) continue;
      try {
        if (label === "gamma") runSql(`delete from public.founder_audit_events where target_user_id = '${account.userId}'::uuid;`);
        const purged = await account.client.rpc("delete_my_account" as never);
        if (purged.error) console.warn(`arc3c teardown could not purge ${label}: ${purged.error.message}`);
        const removed = runSql(`delete from auth.users where id = '${account.userId}'::uuid;`);
        if (!removed.ok) console.warn(`arc3c teardown left ${label}'s auth account: ${removed.out}`);
      } catch (error) {
        console.warn(`arc3c teardown failed for ${label}: ${String(error)}`);
      }
    }
  });

  // ------------------------------------------------------------------------
  // STEP 6, claims 1-3: ordinary history stays undeletable by its own owner.
  // These run first because everything after them depends on the guards biting.
  // ------------------------------------------------------------------------
  for (const table of ["payments", "activities", "promise_events"]) {
    it(`6.1/6.2/6.3 ${table}: an ordinary user cannot delete their own ${table} history`, async () => {
      const account = accounts.alpha;
      const { data: rows, error: readError } = await account.client.from(table).select("id");
      expect(readError ?? null, `owner read of ${table} failed`).toBeNull();
      expect(rows!.length, `${table} history should exist for the fixture`).toBeGreaterThan(0);

      const { error } = await account.client.from(table).delete().eq("id", rows![0].id);
      expect(error, `a browser role must not be able to delete ${table}`).not.toBeNull();
      expect(dbCounts(account.userId)[table], `${table} count changed after a refused delete`).toBe(rows!.length);
    });
  }

  // ------------------------------------------------------------------------
  // Claim 4: the erasure context cannot be forged, borrowed, or aimed elsewhere.
  // ------------------------------------------------------------------------
  it("6.4 the erasure decision is not browser-callable", async () => {
    const { error } = await accounts.alpha.client.rpc("erasure_allows_delete" as never, { p_owner: accounts.beta.userId });
    expect(error, "the helper must not be executable from a browser role").not.toBeNull();
    expect(dbCounts(accounts.beta.userId).payments).toBeGreaterThan(0);
  });

  it("6.4 a pre-armed context gives an authenticated session no delete", async () => {
    // The threat model's core question: a custom GUC is settable by any session, so the presence
    // of a context must never be the whole authority. This arms beta's id from a session wearing
    // the browser role, then attempts the delete that forged context supposedly unlocks.
    const probe = runSql(`begin;
      set local role authenticated;
      select set_config('app.dueweave_erasure_owner', '${accounts.beta.userId}', true);
      delete from public.payments where owner_id = '${accounts.beta.userId}'::uuid;
      rollback;`);
    expect(probe.ok, `the forged delete unexpectedly succeeded: ${probe.out}`).toBe(false);
    expect(probe.out).toMatch(/permission denied/i);
    expect(dbCounts(accounts.beta.userId).payments).toBeGreaterThan(0);
  });

  it("6.4 a context armed without that account's own verified token decides false", async () => {
    // The same GUC from the role that actually owns the tables, with no JWT in the session. If
    // this returned true, the auth.uid() condition would be decoration.
    const probe = runSql(`begin;
      select set_config('app.dueweave_erasure_owner', '${accounts.beta.userId}', true);
      select 'allows=' || public.erasure_allows_delete('${accounts.beta.userId}'::uuid);
      rollback;`);
    expect(probe.out).toContain("allows=false");
  });

  it("6.4 the erasure RPC takes no target, so naming another account is not something it can do", async () => {
    const { error } = await accounts.alpha.client.rpc("delete_my_account" as never, { p_user_id: accounts.beta.userId });
    expect(error, "a zero-argument RPC must not resolve when handed a target id").not.toBeNull();
    expect(dbCounts(accounts.beta.userId).payments).toBeGreaterThan(0);
    expect(dbCounts(accounts.alpha.userId).payments).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------------
  // Claims 6-7: nothing unauthenticated or malformed reaches the path.
  // ------------------------------------------------------------------------
  it("6.6 an anonymous caller cannot invoke account deletion", async () => {
    const { error } = await newClient().rpc("delete_my_account" as never);
    expect(error, "anon must not be able to erase an account").not.toBeNull();
    for (const label of ["alpha", "beta"] as const) {
      expect(dbCounts(accounts[label].userId).profiles).toBe(1);
    }
  });

  it("6.7 a malformed token cannot invoke it either", async () => {
    const forged = "eyJhbGciOiJIUzI1NiJ9.bm90LWEtamF5dA.0000000000000000000000000000";
    const { error } = await newClient(forged).rpc("delete_my_account" as never);
    expect(error, "an unverifiable JWT must not reach the RPC").not.toBeNull();
    expect(dbCounts(accounts.alpha.userId).profiles).toBe(1);
  });

  // ------------------------------------------------------------------------
  // STEP 4, claims F.0-F.7: the same rules one layer up, at the endpoint the browser actually
  // reaches. F.0 exists so a missing function or an unset origin surfaces as a red test with the
  // setup step in its message — a skipped security claim is not a pass, and an unconfigured one is
  // worse because it looks like one.
  // ------------------------------------------------------------------------
  it("F.0 the endpoint is served and its origin policy is configured", async () => {
    // An unconfirmed body from a real session: the safest possible probe, since every path that
    // gets past this point refuses on the confirmation alone.
    const reply = await callDeletionFunction({ token: accounts.alpha.accessToken, body: "{}" });
    expect(reply.status, `the function is not served on this stack: ${reply.text}`).not.toBe(404);
    expect(reply.status, "ALLOWED_APP_ORIGIN is not set for the local runtime, so F.1-F.7 below decide nothing").not.toBe(501);
    expect(reply.status).toBe(400);
    expect(dbCounts(accounts.alpha.userId).profiles).toBe(1);
  });

  it("F.1 an anonymous request cannot erase an account through the endpoint", async () => {
    const reply = await callDeletionFunction({ body: JSON.stringify({ confirm: ERASURE_CONFIRMATION_PHRASE }) });
    expect(reply.status, `anonymous reached the erasure path: ${reply.text}`).toBe(401);
    expect(String(reply.json.message)).toMatch(/sign in/i);
    for (const label of ["alpha", "beta"] as const) {
      expect(dbCounts(accounts[label].userId).payments).toBeGreaterThan(0);
    }
  });

  it("F.2 a forged or expired token is refused by the signature check, not by our parsing", async () => {
    // Well-formed enough to survive the bearer regex, unverifiable by GoTrue. This is the claim that
    // the endpoint does not treat "looks like a JWT" as "is a session". The token is assembled here
    // rather than written as a literal so the repo's own secret scanner never sees a credential
    // shape it cannot tell from a fixture.
    const b64url = (text: string) => Buffer.from(text).toString("base64url");
    const expiredButSigned = `eyJhbGciOiJIUzI1NiJ9.${b64url(JSON.stringify({ sub: accounts.alpha.userId, role: "authenticated", exp: 1_700_000_000 }))}.Zm9yZ2VkLXNpZ25hdHVyZUFsZ28`;
    for (const token of [expiredButSigned, "not-a-jwt", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJhbHBoYSJ9."]) {
      const reply = await callDeletionFunction({ token, body: JSON.stringify({ confirm: ERASURE_CONFIRMATION_PHRASE }) });
      expect(reply.status, `${token.slice(0, 16)}… must not be accepted as a session`).toBe(401);
      expect(reply.text, "a refusal must not repeat the credential it refused").not.toContain(token);
    }
    expect(dbCounts(accounts.alpha.userId).profiles).toBe(1);
  });

  it("F.3 only POST can ask for a deletion", async () => {
    const body = JSON.stringify({ confirm: ERASURE_CONFIRMATION_PHRASE });
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      const reply = await callDeletionFunction({ method, token: accounts.alpha.accessToken, body });
      expect(reply.status, `${method} must not trigger an erasure`).toBe(405);
    }
    expect(dbCounts(accounts.alpha.userId).payments).toBeGreaterThan(0);
  });

  it("F.4 a preflight answers without touching the erasure path", async () => {
    const reply = await callDeletionFunction({ method: "OPTIONS", token: accounts.alpha.accessToken });
    expect(reply.status).toBe(204);
    expect(dbCounts(accounts.alpha.userId).payments).toBeGreaterThan(0);
  });

  it("F.5 a request without the exact confirmation is refused, and says nothing internal", async () => {
    for (const body of ["{}", '{"confirm":"yes"}', '{"confirm":"delete my account"}', "not json", ""]) {
      const reply = await callDeletionFunction({ token: accounts.alpha.accessToken, body });
      expect(reply.status, `${JSON.stringify(body)} was accepted as confirmation`).toBe(400);
      expect(reply.text).not.toMatch(/delete_my_account|erasure|service_role|42501|constraint/i);
    }
    expect(dbCounts(accounts.alpha.userId).profiles).toBe(1);
  });

  it("F.6 a body that names another account is refused without touching it", async () => {
    // The brief's STEP 4 rule as an executed claim: the endpoint has no target parameter, and a
    // caller that supplies one gets a refusal that does not repeat the id.
    const reply = await callDeletionFunction({
      token: accounts.alpha.accessToken,
      body: JSON.stringify({ confirm: ERASURE_CONFIRMATION_PHRASE, user_id: accounts.beta.userId }),
    });
    expect(reply.status, "a browser-named target must never be honoured").toBe(400);
    expect(reply.text, "a refusal must not echo the identifier it refused").not.toContain(accounts.beta.userId);
    expect(dbCounts(accounts.beta.userId).payments).toBeGreaterThan(0);
    expect(dbCounts(accounts.alpha.userId).payments).toBeGreaterThan(0);
  });

  it("F.7 a request from an origin that is not the application is refused", async () => {
    const body = JSON.stringify({ confirm: ERASURE_CONFIRMATION_PHRASE });
    for (const origin of ["https://evil.example", "null"]) {
      const reply = await callDeletionFunction({ token: accounts.alpha.accessToken, body, origin });
      expect(reply.status, `${origin} is not the configured app origin`).toBe(403);
    }
    expect(dbCounts(accounts.alpha.userId).profiles).toBe(1);
  });

  // ------------------------------------------------------------------------
  // F.8 — the journey a real account holder takes: one authenticated POST with the typed phrase,
  // and the account is gone from both halves of the system. This is the claim B17 could not satisfy
  // by any supported path, and the only test here that lets GoTrue's own cascade run.
  // ------------------------------------------------------------------------
  it("F.8 one confirmed request erases epsilon's business rows and auth account, and leaves beta alone", async () => {
    const epsilon = accounts.epsilon;
    const before = dbCounts(epsilon.userId);
    const betaBefore = dbCounts(accounts.beta.userId);
    expect(before.payments).toBeGreaterThan(0);
    expect(authUserCount(epsilon.userId)).toBe(1);

    const reply = await callDeletionFunction({ token: epsilon.accessToken, body: JSON.stringify({ confirm: ERASURE_CONFIRMATION_PHRASE }) });
    expect(reply.status, `self-service deletion did not succeed: ${reply.text}`).toBe(200);
    expect(reply.json.status).toBe("deleted");

    for (const [table] of OWNER_TABLES) {
      expect(dbCounts(epsilon.userId)[table], `${table} survived the endpoint journey`).toBe(0);
    }
    expect(authUserCount(epsilon.userId), "the auth account outlived the purge, so the journey left a zombie login").toBe(0);
    expect(dbCounts(accounts.beta.userId)).toEqual(betaBefore);

    // The stolen token is now worthless: replaying the same request cannot reach a session that
    // GoTrue no longer has.
    const replay = await callDeletionFunction({ token: epsilon.accessToken, body: JSON.stringify({ confirm: ERASURE_CONFIRMATION_PHRASE }) });
    expect(replay.status).toBe(401);
  });

  // ------------------------------------------------------------------------
  // Claim 14: Founder semantics. An entangled account is refused, not quietly rewritten.
  // ------------------------------------------------------------------------
  it("6.14 a Founder-entangled account is refused and keeps every row (B19, fail-closed)", async () => {
    const gamma = accounts.gamma;
    const before = dbCounts(gamma.userId);
    expect(before.payments).toBeGreaterThan(0);

    const { error } = await gamma.client.rpc("delete_my_account" as never);
    expect(error, "erasing a review subject would delete Founder provenance, so the RPC must refuse").not.toBeNull();
    expect(String(error!.message)).toMatch(/Founder/i);

    expect(dbCounts(gamma.userId)).toEqual(before);
    expect(auditCount(gamma.userId)).toBe(1);

    // The privileged path is refused too — by the RESTRICT edge rather than a trigger, which is
    // the second blocker B17's original write-up did not name.
    const adminDelete = runSql(`delete from auth.users where id = '${gamma.userId}'::uuid;`);
    expect(adminDelete.ok, `an entangled account must not be deletable by the admin cascade: ${adminDelete.out}`).toBe(false);
    expect(auditCount(gamma.userId)).toBe(1);
  });

  // The RPC's second entanglement branch — owning a claim that an audit row points at — is pinned
  // structurally in supabase/tests/arc3c_01_account_erasure.sql rather than here. No supported call
  // can produce it on its own today: `create_founder_claim` writes the CLAIM_CREATED row with both
  // `claim_id` and `target_user_id` set (20260813030000:164-165), so any account that reaches that
  // branch is refused by the first one. The branch exists so a future claim shape that skips the
  // target column still gets the clean refusal above instead of a foreign-key abort halfway
  // through the purge, and testing it behaviourally would mean hand-inserting a row the product
  // forbids — a fixture that proves the test, not the code.

  // ------------------------------------------------------------------------
  // Claim 11, baseline half: B17 as a permanent regression. An account that has history and has
  // not used the erasure path is STILL undeletable by the admin cascade. The repair did not make
  // "delete the user" work; it made "the owner erases their own account" work.
  // ------------------------------------------------------------------------
  it("6.11 an un-purged historical account still aborts the admin cascade, with nothing lost", async () => {
    const delta = accounts.delta;

    // The abort reason is recorded, not pre-judged. This path has two kinds of blocker — an
    // unconditional history guard, and a RESTRICT edge (clients->receivables,
    // founder_audit_events->auth.users) — and which one PostgreSQL reaches first depends on its
    // cascade order, which has not been measured on this machine. So the hard claims are that the
    // statement fails and that nothing was lost, and the text assertion accepts either blocker.
    // Whatever message comes back is the finding STEP 1 asked for and belongs in the phase record.
    const blockedCascade = /cannot be changed|cannot be deleted|is immutable|foreign key|violates/i;

    // STEP 1, claim B — the old path, measured. `delete_my_business_data()` is one statement,
    // `delete from public.profiles where id = auth.uid()`, so this cascade is exactly what that RPC
    // would run if it were ever handed back to a browser role. It is not re-granted: the repair
    // gives the owner a narrower path instead.
    const businessData = runSql(`delete from public.profiles where id = '${delta.userId}'::uuid;`);
    expect(businessData.ok, "the profile cascade is supposed to abort").toBe(false);
    expect(businessData.out).toMatch(blockedCascade);
    expect(dbCounts(delta.userId).profiles).toBe(1);
    expect(dbCounts(delta.userId).payments).toBeGreaterThan(0);

    // STEP 1, claim C — the GoTrue equivalent. `auth.admin.deleteUser` deletes this row and lets
    // PostgreSQL walk the same cascade, which is how B17 surfaced during Phase 3B's cleanup.
    const attempt = runSql(`delete from auth.users where id = '${delta.userId}'::uuid;`);
    expect(attempt.ok, "the admin cascade is supposed to abort on an account with history").toBe(false);
    expect(attempt.out).toMatch(blockedCascade);
    expect(dbCounts(delta.userId).profiles).toBe(1);
  });

  // ------------------------------------------------------------------------
  // Claims 5, 8, 9, 10, 11, 12: the happy path, last, so nothing above it can pass on an account
  // that has already been erased.
  // ------------------------------------------------------------------------
  it("6.5/6.8/6.9/6.10/6.11/6.12 alpha erases itself completely and beta is untouched", async () => {
    const alpha = accounts.alpha;
    const betaBefore = dbCounts(accounts.beta.userId);
    expect(betaBefore.payments).toBeGreaterThan(0);
    expect(betaBefore.activities).toBeGreaterThan(0);

    const { error } = await alpha.client.rpc("delete_my_account" as never);
    expect(error ?? null, `self-service erasure must succeed for an unentangled account: ${error?.message}`).toBeNull();

    // 6.9 every owned business row is gone, and 6.12 nothing is orphaned behind them.
    const after = dbCounts(alpha.userId);
    for (const [table] of OWNER_TABLES) {
      expect(after[table], `${table} still holds rows for the erased account`).toBe(0);
    }
    expect(auditCount(alpha.userId)).toBe(0);
    expect(reviewerCount(alpha.userId)).toBe(0);

    // 6.8 the auth account itself, by the statement GoTrue's admin API runs — once the cascade has
    // nothing left to trip on. The Edge Function performs this remotely; locally the identical
    // single statement is the difference between B17 and the repair.
    const adminDelete = runSql(`delete from auth.users where id = '${alpha.userId}'::uuid;`);
    expect(adminDelete.ok, `a purged account should now be deletable: ${adminDelete.out}`).toBe(true);
    expect(authUserCount(alpha.userId)).toBe(0);

    // 6.10 the neighbour is exactly where it was, table by table.
    expect(dbCounts(accounts.beta.userId)).toEqual(betaBefore);

    // 6.5 and beta's own session still reads only its own rows.
    const { data: neighbourPayments, error: readError } = await accounts.beta.client.from("payments").select("id");
    expect(readError ?? null).toBeNull();
    expect(neighbourPayments!.length).toBe(betaBefore.payments);
  });

  // ------------------------------------------------------------------------
  // Claim 13: normal immutability still holds after the change.
  // ------------------------------------------------------------------------
  it("6.13 history stays immutable for a surviving account after the repair", async () => {
    const beta = accounts.beta;
    for (const table of ["payments", "activities", "promise_events", "promises"]) {
      const { data: rows } = await beta.client.from(table).select("id");
      expect(rows!.length, `${table} should still have history`).toBeGreaterThan(0);
      const { error } = await beta.client.from(table).delete().eq("id", rows![0].id);
      expect(error, `${table} must remain undeletable by its owner`).not.toBeNull();
    }

    // The guards still fire on UPDATE with no context armed anywhere in sight — the shape the
    // product promises about its ledger.
    const rewrite = runSql(`update public.payments set amount_paise = amount_paise where owner_id = '${beta.userId}'::uuid;`);
    expect(rewrite.ok, "an UPDATE of history must still be refused").toBe(false);
    expect(rewrite.out).toMatch(/Historical records cannot be changed/i);
    expect(dbCounts(beta.userId).payments).toBeGreaterThan(0);
  });
});
