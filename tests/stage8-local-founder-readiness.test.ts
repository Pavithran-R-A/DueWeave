import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FOUNDER_PRICE_PAISE, founderReadinessGaps } from "../client/src/lib/founder-readiness";
import type { FounderOffer } from "../client/src/types/domain";

const url = process.env.VITE_SUPABASE_URL ?? "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";

// Browser-safe credentials only, as in the Stage 3 suite: no service-role key is
// read, imported or passed anywhere in this file. Every refusal asserted below
// comes from an anon or authenticated browser-role request.
const isLoopbackStack = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/i.test(url);
const describeLocalStack = isLoopbackStack && anonKey.length > 0 ? describe : describe.skip;

const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// The label also lands in the email local-part, so it is slugged here once
    // rather than depending on every caller to pick a address-safe word.
const emailFor = (label: string) => `stage8-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${runTag}@dueweave.local`;
const newPassword = () => `Stage8!${Math.random().toString(36).slice(2, 12)}aA`;

// Synthetic, clearly non-routable fixture values. `.invalid` is reserved and
// never deliverable, and `dueweave-test@upi` is the Stage 4.2A synthetic VPA.
// None of these are shipped defaults: the delivered row is restored in
// afterAll and re-read to prove it.
const FIXTURE_VPA = "dueweave-test@upi";
const FIXTURE_PAYEE = "DueWeave Test Fixture";
const FIXTURE_SUPPORT = "founder-support+fixture@example.invalid";
const FIXTURE_REFUND_TEXT =
  "Fixture refund terms for local Stage 8 verification only: a Founder purchase may be refunded on request within seven days of activation when paid features have not been materially used.";

function newClient(accessToken?: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const localDbContainer = process.env.STAGE8_LOCAL_DB_CONTAINER ?? "supabase_db_dueweave";

// Local Postgres administration. Used for exactly two things, both of which the
// brief assigns to a trusted operator rather than to the app: provisioning the
// synthetic reviewer allowlist row (PHASE 22) and moving the single
// `FOUNDER_V1` row between readiness states (PHASE 66 — there is deliberately no
// browser control that does this). It is never used to make or bypass an
// authorization assertion.
//
// `ON_ERROR_STOP=1` is load-bearing. psql exits 0 even when the statement
// errors, so without it a write refused by a check constraint looks like a
// successful configuration change, and a gate test then reports a correct
// refusal as "accepted". Measured: with the flag, the three shapes the table
// refuses outright are recorded as inexpressible instead of misread.
function localAdmin(sql: string) {
  execFileSync("docker", ["exec", "-i", localDbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], {
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function localAdminValue(sql: string): string {
  return execFileSync("docker", ["exec", "-i", localDbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

type Row = Record<string, unknown>;
type Probe = { error: PostgrestError | null; data?: unknown };

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function rowsOf(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  if (value && typeof value === "object") return [value as Row];
  return [];
}

// A malformed probe (typo, missing column, wrong argument shape) must never be
// booked as a security win, so those codes fail the run rather than pass it.
const MALFORMED_CODES = new Set(["42P01", "42703", "42883", "42P10", "22P02", "23503", "PGRST204", "PGRST205", "PGRST102"]);

type Denial = { blocked: boolean; detail: string };

function denial(who: string, probe: Probe, expectedMessage?: string): Denial {
  if (!probe.error) return { blocked: false, detail: `${who} request was accepted` };
  const code = probe.error.code ?? "P0000";
  if (MALFORMED_CODES.has(code)) {
    return { blocked: false, detail: `${who} probe was malformed (${code}: ${probe.error.message})` };
  }
  if (expectedMessage && !probe.error.message.includes(expectedMessage)) {
    return { blocked: false, detail: `${who} refused for an unexpected reason (${code}: ${probe.error.message})` };
  }
  return { blocked: true, detail: `${who} refused with ${code}: ${probe.error.message}` };
}

function notCallable(who: string, probe: Probe): Denial {
  if (!probe.error) return { blocked: false, detail: `${who} call was accepted` };
  const code = probe.error.code ?? "P0000";
  const detail = `${who} refused with ${code}: ${probe.error.message}`;
  return { blocked: code === "42501" || code === "PGRST202", detail };
}

type Category =
  | "readiness-gate"
  | "lifecycle"
  | "idempotency"
  | "snapshot"
  | "cross-tenant"
  | "utr-integrity"
  | "validation"
  | "reviewer-boundary"
  | "review-queue"
  | "approval-atomicity"
  | "seat-cap"
  | "rejection"
  | "reconsideration"
  | "revocation"
  | "immutability"
  | "evidence-privacy"
  | "state-neutrality";

type Outcome = "refused" | "accepted" | "unchanged" | "changed" | "observed";
const ledger: Array<{ category: Category; label: string; outcome: Outcome; detail: string }> = [];

function blocked(category: Category, label: string, result: Denial) {
  ledger.push({ category, label, outcome: result.blocked ? "refused" : "accepted", detail: result.detail });
  assert(result.blocked, `[${category}] ${label} — ${result.detail}`);
}

function allowed(category: Category, label: string, probe: Probe) {
  const detail = probe.error ? `${probe.error.code ?? "P0000"} ${probe.error.message}` : "accepted";
  ledger.push({ category, label, outcome: probe.error ? "refused" : "accepted", detail });
  assert(probe.error === null, `[${category}] ${label} — expected acceptance: ${detail}`);
}

function observed(category: Category, label: string, detail: string) {
  ledger.push({ category, label, outcome: "observed", detail });
}

// jsonb rebuilds objects in its own key order, so a textual compare reports a
// change that never happened. Key order carries no meaning here; the values do.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Row).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function unchanged(category: Category, label: string, actual: unknown, expected: unknown) {
  const same = stable(actual) === stable(expected);
  ledger.push({
    category,
    label,
    outcome: same ? "unchanged" : "changed",
    detail: same ? "stored state unchanged" : `expected ${stable(expected)}, found ${stable(actual)}`,
  });
  assert(same, `[${category}] ${label} — stored state changed: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

type Account = { userId: string; email: string; accessToken: string; client: SupabaseClient };

async function bootstrap(label: string): Promise<Account> {
  const email = emailFor(label);
  const { data, error } = await newClient().auth.signUp({
    email,
    password: newPassword(),
    options: { data: { display_name: `Stage 8 ${label}` } },
  });
  assert(!error && !!data.session && !!data.user, `local signup failed for ${label}: ${error?.message ?? "no session"}`);
  return {
    userId: data.user!.id,
    email,
    accessToken: data.session!.access_token,
    client: newClient(data.session!.access_token),
  };
}

function offerRow(): FounderOffer {
  const json = localAdminValue(
    "select jsonb_build_object('amountPaise', amount_paise, 'founderCap', founder_cap, 'payeeName', payee_name, 'upiId', upi_id, 'paymentDestinationStatus', payment_destination_status, 'supportContact', support_contact, 'supportContactStatus', support_contact_status, 'refundPolicyStatus', refund_policy_status, 'refundPolicyText', refund_policy_text, 'disclosuresStatus', disclosures_status, 'reviewWindowCopy', review_window_copy, 'enabled', enabled) from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
  );
  const row = JSON.parse(json) as Record<string, unknown>;
  return {
    amountPaise: Number(row.amountPaise),
    founderCap: Number(row.founderCap),
    availableSpots: 0,
    payeeName: String(row.payeeName ?? ""),
    upiId: row.upiId == null ? undefined : String(row.upiId),
    paymentDestinationStatus: String(row.paymentDestinationStatus) as FounderOffer["paymentDestinationStatus"],
    supportContact: String(row.supportContact ?? ""),
    supportContactStatus: String(row.supportContactStatus) as FounderOffer["supportContactStatus"],
    refundPolicyStatus: String(row.refundPolicyStatus) as FounderOffer["refundPolicyStatus"],
    refundPolicyText: row.refundPolicyText == null ? undefined : String(row.refundPolicyText),
    disclosuresStatus: String(row.disclosuresStatus) as FounderOffer["disclosuresStatus"],
    reviewWindowCopy: String(row.reviewWindowCopy ?? ""),
    enabled: row.enabled === true,
  };
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function writeOffer(patch: Partial<FounderOffer>) {
  const columns: Record<string, keyof FounderOffer> = {
    enabled: "enabled",
    amount_paise: "amountPaise",
    founder_cap: "founderCap",
    payee_name: "payeeName",
    upi_id: "upiId",
    payment_destination_status: "paymentDestinationStatus",
    support_contact: "supportContact",
    support_contact_status: "supportContactStatus",
    refund_policy_status: "refundPolicyStatus",
    refund_policy_text: "refundPolicyText",
    disclosures_status: "disclosuresStatus",
  };
  const sets = Object.entries(columns)
    .filter(([, key]) => key in patch)
    .map(([column, key]) => `${column} = ${sqlLiteral(patch[key])}`);
  assert(sets.length > 0, "writeOffer called with no changed columns");
  localAdmin(`update public.founder_offer_config set ${sets.join(", ")} where offer_key = 'FOUNDER_V1';`);
}

// The trusted-operator configuration the readiness conjunction describes:
// destination LIVE with a synthetic VPA, support CONFIGURED, refund terms and
// disclosures approved. Nothing here is a real payment destination. `founderCap`
// is included because the seat-cap tests deliberately move it, and every
// re-application of this shape must also put the cap back.
const READY_OFFER: Partial<FounderOffer> = {
  paymentDestinationStatus: "LIVE",
  upiId: FIXTURE_VPA,
  payeeName: FIXTURE_PAYEE,
  supportContact: FIXTURE_SUPPORT,
  supportContactStatus: "CONFIGURED",
  refundPolicyStatus: "APPROVED",
  refundPolicyText: FIXTURE_REFUND_TEXT,
  disclosuresStatus: "APPROVED",
  enabled: true,
  founderCap: 50,
};

function claimFingerprint(ownerEmails: string[]) {
  const list = ownerEmails.map((email) => sqlLiteral(email)).join(",");
  const json = localAdminValue(`
    select coalesce(jsonb_agg(jsonb_build_object('claim_id', c.claim_id, 'status', c.status, 'amount', c.amount_paise, 'plan', c.plan, 'utr', c.utr_reference, 'payer', c.payer_name, 'reviewed_by', c.reviewed_by) order by c.claim_id), '[]'::jsonb)::text
      from public.purchase_claims c join auth.users u on u.id = c.owner_id
     where u.email in (${list});`);
  return JSON.parse(json) as unknown[];
}

function auditFingerprint(ownerEmails: string[]) {
  const list = ownerEmails.map((email) => sqlLiteral(email)).join(",");
  const json = localAdminValue(`
    select coalesce(jsonb_agg(jsonb_build_object('event_type', e.event_type, 'actor', e.actor_user_id is not null, 'metadata', e.metadata) order by e.occurred_at, e.id), '[]'::jsonb)::text
      from public.founder_audit_events e join auth.users u on u.id = e.target_user_id
     where u.email in (${list});`);
  return JSON.parse(json) as Array<{ event_type: string; actor: boolean; metadata: Record<string, unknown> }>;
}

// Filtered to the plan this stage can grant. Every account already carries a
// default FREE entitlement from signup (proved by its own test below), so
// "no entitlement" would be false; "no Founder entitlement" is the assertion
// that actually means payment has not happened.
function founderEntitlementsFor(userIds: string[]) {
  const list = userIds.map((id) => `'${id}'::uuid`).join(",");
  const json = localAdminValue(`
    select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'plan', plan, 'status', status, 'source', source) order by user_id), '[]'::jsonb)::text
      from public.entitlements where user_id in (${list}) and plan = 'FOUNDER';`);
  return JSON.parse(json) as unknown[];
}

function planRowsFor(userIds: string[]) {
  const list = userIds.map((id) => `'${id}'::uuid`).join(",");
  const json = localAdminValue(`
    select coalesce(jsonb_agg(jsonb_build_object('plan', plan, 'status', status, 'source', source) order by plan), '[]'::jsonb)::text
      from public.entitlements where user_id in (${list});`);
  return JSON.parse(json) as unknown[];
}

function activeFounderCount() {
  return Number(localAdminValue("select count(*) from public.entitlements where plan = 'FOUNDER' and status = 'ACTIVE';"));
}

// The exact statement that puts the delivered row back. Both the final test and
// the teardown call it, so the assertion "the gate is closed again" describes the
// same write the suite relies on rather than a hope about it.
function restoreOffer(delivered: FounderOffer) {
  localAdmin(`
    update public.founder_offer_config
       set enabled = ${sqlLiteral(delivered.enabled)},
           amount_paise = ${sqlLiteral(delivered.amountPaise)},
           founder_cap = ${sqlLiteral(delivered.founderCap)},
           payee_name = ${sqlLiteral(delivered.payeeName)},
           upi_id = ${sqlLiteral(delivered.upiId)},
           payment_destination_status = ${sqlLiteral(delivered.paymentDestinationStatus)},
           support_contact = ${sqlLiteral(delivered.supportContact || null)},
           support_contact_status = ${sqlLiteral(delivered.supportContactStatus)},
           refund_policy_status = ${sqlLiteral(delivered.refundPolicyStatus)},
           refund_policy_text = ${sqlLiteral(delivered.refundPolicyText || null)},
           disclosures_status = ${sqlLiteral(delivered.disclosuresStatus)}
     where offer_key = 'FOUNDER_V1';`);
}

// Teardown: remove the synthetic accounts. The history guards refuse DELETE even
// to the table owner, which this suite proves elsewhere, so the purge skips them
// for one transaction with `set local session_replication_role = replica`. That
// reverts at commit, takes no lock on the guarded tables and touches no RLS
// setting — unlike `alter table … disable trigger`, which asks for
// ACCESS EXCLUSIVE on a table a concurrent money write may hold a row lock on
// and fires the ddl_command_end notify that reloads PostgREST's schema cache.
// The setting is superuser-only and transaction-scoped; the local superuser
// already bypasses RLS, so this grants the run no authority it should not have.
function purgeFixtures() {
  localAdmin(`begin;
    set local session_replication_role = replica;
    delete from public.founder_audit_events where target_user_id in (select id from auth.users where email like 'stage8-%@dueweave.local') or actor_user_id in (select id from auth.users where email like 'stage8-%@dueweave.local');
    delete from public.founder_admins where user_id in (select id from auth.users where email like 'stage8-%@dueweave.local');
    delete from public.purchase_claims where owner_id in (select id from auth.users where email like 'stage8-%@dueweave.local');
    delete from public.analytics_events where owner_id in (select id from auth.users where email like 'stage8-%@dueweave.local');
    delete from public.activities where owner_id in (select id from auth.users where email like 'stage8-%@dueweave.local');
    delete from public.promise_events where owner_id in (select id from auth.users where email like 'stage8-%@dueweave.local');
    delete from public.payments where owner_id in (select id from auth.users where email like 'stage8-%@dueweave.local');
    delete from public.promises where owner_id in (select id from auth.users where email like 'stage8-%@dueweave.local');
    delete from public.receivables where owner_id in (select id from auth.users where email like 'stage8-%@dueweave.local');
    delete from public.clients where owner_id in (select id from auth.users where email like 'stage8-%@dueweave.local');
    delete from public.entitlements where user_id in (select id from auth.users where email like 'stage8-%@dueweave.local');
    delete from public.profiles where id in (select id from auth.users where email like 'stage8-%@dueweave.local');
    delete from auth.users where email like 'stage8-%@dueweave.local';
    commit;`);
}

function utrFor(label: string) {
  return `STAGE8${label}${runTag.slice(0, 6).toUpperCase()}`;
}

const state: {
  delivered?: FounderOffer;
  customerA?: Account;
  customerB?: Account;
  reviewer?: Account;
  reviewerTwo?: Account;
  outsider?: Account;
  claimAC?: string;
} = {};

// Every test here drives a real Postgres through Realtime/PostgREST plus local
    // administration, so it needs a larger budget than the default five seconds.
describeLocalStack("Stage 8 local Founder readiness: real accounts, one shared local database", { timeout: 45_000, hookTimeout: 90_000 }, () => {
  beforeAll(async () => {
    state.delivered = offerRow();
    state.customerA = await bootstrap("alpha");
    state.customerB = await bootstrap("beta");
    state.reviewer = await bootstrap("reviewer");
    state.reviewerTwo = await bootstrap("reviewer2");
    state.outsider = await bootstrap("outsider");
    // PHASE 22 — a reviewer is an ordinary authenticated account plus one
    // `founder_admins` row. The row is written here because that allowlist is
    // server-controlled: no browser RPC can add a reviewer, which is what
    // PHASE 23 and PHASE 63 then assert from the other direction.
    localAdmin(`
      insert into public.founder_admins (user_id) values ('${state.reviewer!.userId}'::uuid), ('${state.reviewerTwo!.userId}'::uuid);`);
    writeOffer(READY_OFFER);
  });

  afterAll(() => {
    // Restore the delivered offer first, before any purge, so an assertion
    // failure in the middle of the run can never leave the gate open.
    restoreOffer(state.delivered!);
    purgeFixtures();

    mkdirSync(path.resolve("test-results"), { recursive: true });
    writeFileSync(
      path.resolve("test-results", "stage8-ledger.json"),
      JSON.stringify({ runTag, generatedAt: new Date().toISOString(), entries: ledger }, null, 2)
    );
  });

  it("ships a delivered offer that the readiness model reports as NOT READY", () => {
    const delivered = state.delivered!;
    expect(delivered.paymentDestinationStatus).toBe("PLACEHOLDER");
    expect(delivered.upiId).toBeUndefined();
    const gaps = founderReadinessGaps(delivered);
    expect(gaps.length).toBeGreaterThan(0);
    observed("readiness-gate", "delivered offer gaps", gaps.join(","));
  });

  it("starts every account on FREE, which is what makes a missing grant meaningful", async () => {
    const fresh = await bootstrap("plain");
    // "No entitlement" would be a false claim — signup provisions a default FREE
    // row. Every later `[]` below is about the FOUNDER plan specifically.
    expect(planRowsFor([fresh.userId])).toEqual([{ plan: "FREE", status: "ACTIVE", source: "DEFAULT" }]);
    expect(founderEntitlementsFor([fresh.userId])).toEqual([]);
  });

  it("refuses claim creation and submission against the delivered row", async () => {
    const a = state.customerA!;
    // beforeAll opened the gate for the rest of the suite, so this test puts the
    // shipped row back first. It then re-opens it the only sanctioned way: the
    // trusted local configuration path, never a browser call.
    restoreOffer(state.delivered!);
    const before = claimFingerprint([a.email]);
    blocked(
      "readiness-gate",
      "create_founder_claim refuses PLACEHOLDER destination",
      denial("A", await a.client.rpc("create_founder_claim"), "Founder payment instructions are not ready yet")
    );
    blocked(
      "readiness-gate",
      "submit_founder_payment refuses PLACEHOLDER destination",
      denial(
        "A",
        await a.client.rpc("submit_founder_payment", { p_claim_id: "DW-F-NONE0000000", p_utr_reference: utrFor("G"), p_payer_name: "Gated Probe" }),
        "Payment instructions are not ready for submission"
      )
    );
    unchanged("readiness-gate", "no claim row was created by a gated request", claimFingerprint([a.email]), before);
    writeOffer(READY_OFFER);
    expect(founderReadinessGaps(offerRow())).toEqual([]);
  });

  it("opens the gate only through the trusted local configuration path", () => {
    const opened = offerRow();
    expect(opened.paymentDestinationStatus).toBe("LIVE");
    expect(founderReadinessGaps(opened)).toEqual([]);
    expect(opened.amountPaise).toBe(FOUNDER_PRICE_PAISE);
    observed("readiness-gate", "trusted configuration applied", "LIVE + synthetic fixture destination");
  });

  it("reports the configured destination to the customer through get_founder_offer", async () => {
    const { data, error } = await state.customerA!.client.rpc("get_founder_offer");
    assert(!error, `get_founder_offer failed: ${error?.message}`);
    const row = rowsOf(data)[0];
    expect(row.payment_destination_status).toBe("LIVE");
    expect(row.upi_id).toBe(FIXTURE_VPA);
    expect(row.payee_name).toBe(FIXTURE_PAYEE);
    expect(Number(row.amount_paise)).toBe(FOUNDER_PRICE_PAISE);
    expect(row.support_contact).toBe(FIXTURE_SUPPORT);
    expect(String(row.refund_policy_text)).toBe(FIXTURE_REFUND_TEXT);
    expect(row.disclosures_status).toBe("APPROVED");
  });

  // PHASE 11 — every one-missing-precondition state, executed against the RPCs.
  // Each row names the refusal the database actually raises for that term.
  const NOT_READY = "Founder payment instructions are not ready yet";
  const NOT_READY_TO_SUBMIT = "Payment instructions are not ready for submission";
  const gateCases: Array<[string, Partial<FounderOffer>, string]> = [
    ["offer disabled", { enabled: false }, "Founder access is not available right now"],
    ["destination back to PLACEHOLDER", { paymentDestinationStatus: "PLACEHOLDER", upiId: null as unknown as string }, NOT_READY],
    ["destination in synthetic TEST mode", { paymentDestinationStatus: "TEST" }, NOT_READY],
    ["support status back to PENDING", { supportContactStatus: "PENDING" }, NOT_READY],
    ["support address shorter than the gate allows", { supportContact: "ab" }, NOT_READY],
    ["refund policy withdrawn for approval", { refundPolicyStatus: "PENDING_APPROVAL", refundPolicyText: null as unknown as string }, NOT_READY],
    ["disclosures withdrawn", { disclosuresStatus: "PENDING" }, NOT_READY],
    // These shapes are refused by the table's own checks, which is a stronger
    // guarantee than an RPC test: the incomplete state cannot be stored at all.
    ["LIVE with no VPA", { upiId: null as unknown as string }, NOT_READY],
    ["LIVE with a whitespace VPA", { upiId: "   " }, NOT_READY],
    ["LIVE with no payee name", { payeeName: "  " }, NOT_READY],
    ["price changed away from 49900", { amountPaise: 49_901 }, NOT_READY],
    ["cap set below its own floor", { founderCap: 0 }, NOT_READY],
    ["refund text approved below the reviewed minimum", { refundPolicyText: "Refunds on request." }, NOT_READY],
  ];

  for (const [label, patch, createMessage] of gateCases) {
    it(`holds the readiness conjunction when ${label}`, async () => {
      const a = state.customerA!;
      let storedRejected = false;
      try {
        writeOffer({ ...READY_OFFER, ...patch });
      } catch {
        storedRejected = true;
      }
      const created = await a.client.rpc("create_founder_claim");
      const submitted = await a.client.rpc("submit_founder_payment", {
        p_claim_id: "DW-F-NONE0000000",
        p_utr_reference: utrFor("M"),
        p_payer_name: "Matrix Payer",
      });
      if (storedRejected) {
        // The state could not be written, so the row still satisfies the
        // conjunction; assert that the refusal came from the data layer and that
        // the offer is still fully configured rather than half-opened.
        expect(founderReadinessGaps(offerRow())).toEqual([]);
        observed("readiness-gate", `${label} is inexpressible in storage`, "check constraint refused the write");
        allowed("readiness-gate", `${label}: claim creation stays available while the stored config is complete`, created);
      } else {
        blocked("readiness-gate", `${label}: create_founder_claim`, denial("A", created, createMessage));
        blocked("readiness-gate", `${label}: submit_founder_payment`, denial("A", submitted, NOT_READY_TO_SUBMIT));
      }
      writeOffer(READY_OFFER);
    });
  }

  it("creates one DRAFT claim that carries the offer's commercial facts", async () => {
    const a = state.customerA!;
    const { data, error } = await a.client.rpc("create_founder_claim");
    allowed("lifecycle", "create_founder_claim once ready", { error });
    const claim = rowsOf(data)[0];
    state.claimAC = String(claim.claim_id);
    expect(claim.status).toBe("DRAFT");
    expect(Number(claim.amount_paise)).toBe(FOUNDER_PRICE_PAISE);
    expect(claim.plan).toBe("FOUNDER");
    expect(claim.owner_id).toBe(a.userId);
    expect(String(claim.utr_reference)).toBe("");
    expect(String(claim.payer_name)).toBe("");
    expect(a.client.auth).toBeTruthy();
    ledger.push({ category: "snapshot", label: "claim created with plan/amount/owner/claim_id", outcome: "accepted", detail: String(claim.claim_id) });
  });

  it("returns the same open claim when create is called twice, and races to one claim", async () => {
    const a = state.customerA!;
    const first = state.claimAC!;
    const again = await a.client.rpc("create_founder_claim");
    allowed("idempotency", "second create_founder_claim", { error: again.error });
    expect(String(rowsOf(again.data)[0].claim_id)).toBe(first);
    const open = claimFingerprint([a.email]).filter((row) => ["DRAFT", "PENDING_REVIEW"].includes(String((row as Row).status)));
    expect(open.length).toBe(1);

    const r1 = await newClient(a.accessToken).rpc("create_founder_claim");
    const r2 = await newClient(a.accessToken).rpc("create_founder_claim");
    allowed("idempotency", "concurrent create #1", { error: r1.error });
    allowed("idempotency", "concurrent create #2", { error: r2.error });
    const concurrent = claimFingerprint([a.email]).filter((row) => ["DRAFT", "PENDING_REVIEW"].includes(String((row as Row).status)));
    expect(concurrent.length).toBe(1);
    expect(String(rowsOf(r1.data)[0].claim_id)).toBe(first);
    expect(String(rowsOf(r2.data)[0].claim_id)).toBe(first);
  });

  it("keeps an opening claim neutral through every read and view-recording call", async () => {
    const a = state.customerA!;
    const before = {
      claims: claimFingerprint([a.email]),
      entitlements: founderEntitlementsFor([a.userId]),
      audit: auditFingerprint([a.email]).map((row) => row.event_type),
    };
    expect(before.claims.length).toBe(1);
    expect(before.entitlements.length).toBe(0);
    expect(before.audit).toEqual(["CLAIM_CREATED"]);
    for (const call of [
      ["get_founder_offer", () => a.client.rpc("get_founder_offer")],
      ["record_founder_upgrade_view", () => a.client.rpc("record_founder_upgrade_view")],
      ["read own purchase_claims", () => a.client.from("purchase_claims").select("*")],
      ["read own entitlements", () => a.client.from("entitlements").select("*")],
      ["read own analytics_events", () => a.client.from("analytics_events").select("*")],
    ] as const) {
      allowed("state-neutrality", `D-S8-1 ${call[0]}`, { error: (await call[1]()).error });
    }
    unchanged("state-neutrality", "D-S8-1 reading the offer never advances a claim", claimFingerprint([a.email]), before.claims);
    unchanged("state-neutrality", "D-S8-1 reading the offer never activates Founder", founderEntitlementsFor([a.userId]), before.entitlements);
    unchanged("state-neutrality", "D-S8-1 reading the offer never writes review history", auditFingerprint([a.email]).map((row) => row.event_type), before.audit);
  });

  it("submits the reference and leaves the claim pending with no entitlement", async () => {
    const a = state.customerA!;
    const { data, error } = await a.client.rpc("submit_founder_payment", {
      p_claim_id: state.claimAC,
      p_utr_reference: utrFor("A"),
      p_payer_name: "Asha Customer",
    });
    allowed("lifecycle", "submit_founder_payment", { error });
    const claim = rowsOf(data)[0];
    expect(claim.status).toBe("PENDING_REVIEW");
    expect(claim.utr_reference).toBe(utrFor("A"));
    expect(claim.submitted_at).toBeTruthy();
    expect(claim.reviewed_at).toBeNull();
    expect(founderEntitlementsFor([a.userId])).toEqual([]);
    expect(auditFingerprint([a.email]).map((row) => row.event_type)).toEqual(["CLAIM_CREATED", "CLAIM_SUBMITTED"]);
  });

  it("refuses to submit the same claim twice and to cancel a submitted claim", async () => {
    const a = state.customerA!;
    blocked(
      "lifecycle",
      "second submit of a pending claim",
      denial("A", await a.client.rpc("submit_founder_payment", { p_claim_id: state.claimAC, p_utr_reference: utrFor("A2"), p_payer_name: "Asha Customer" }), "already been submitted or closed")
    );
    blocked(
      "lifecycle",
      "customer cancel of a submitted claim",
      denial("A", await a.client.rpc("cancel_founder_claim", { p_claim_id: state.claimAC }), "Only an unsubmitted payment claim can be cancelled")
    );
    expect(claimFingerprint([a.email])[0]).toMatchObject({ status: "PENDING_REVIEW", utr: utrFor("A") });
  });

  it("refuses every malformed reference and payer name without touching the draft", async () => {
    const probe = await bootstrap("shapes");
    const made = await probe.client.rpc("create_founder_claim");
    allowed("validation", "probe account opens a draft", { error: made.error });
    const claimId = String(rowsOf(made.data)[0].claim_id);
    const before = claimFingerprint([probe.email]);
    for (const [label, value] of [
      ["five characters", "AB123"],
      ["underscore", `${utrFor("U")}_X`],
      ["slash", `${utrFor("SL")}/1`],
      ["empty", "   "],
      ["sixty-five characters", "A".repeat(65)],
    ] as const) {
      blocked(
        "validation",
        `reference refused for ${label}`,
        denial("probe", await probe.client.rpc("submit_founder_payment", { p_claim_id: claimId, p_utr_reference: value, p_payer_name: "Shape Probe" }), "Enter a payment reference")
      );
    }
    for (const [label, payer] of [
      ["one character", "A"],
      ["one hundred twenty one characters", "A".repeat(121)],
      ["blank", "   "],
    ] as const) {
      blocked(
        "validation",
        `payer name refused for ${label}`,
        denial("probe", await probe.client.rpc("submit_founder_payment", { p_claim_id: claimId, p_utr_reference: utrFor("P"), p_payer_name: payer }), "Enter the payer name")
      );
    }
    // A shape refusal is an answer, not a transition: after nine rejected probes
    // the claim must still be the same untouched DRAFT with no entitlement.
    unchanged("validation", "rejected shapes leave the draft untouched", claimFingerprint([probe.email]), before);
    expect((claimFingerprint([probe.email])[0] as Row).status).toBe("DRAFT");
    expect(founderEntitlementsFor([probe.userId])).toEqual([]);
  });

  it("stores the reference normalized and accepts every boundary shape", async () => {
    const cases: Array<[string, string, string, string]> = [
      ["padded", `  ${utrFor("N").toLowerCase()}  `, utrFor("N"), "Babu Customer"],
      // "trim, remove spaces, uppercase" is the normalization the brief maps, so
      // an interior space is a formatting difference, not an invalid reference.
      ["inner spaces", "AB 12 34", "AB1234", "Space Separator"],
      ["shortest", "abc123", "ABC123", "அஷ்விNI Küññу"],
      ["longest", "B".repeat(64), "B".repeat(64), "Boundary Payer"],
    ];
    for (const [label, input, storedUtr, payer] of cases) {
      const account = await bootstrap(label);
      const made = await account.client.rpc("create_founder_claim");
      allowed("validation", `${label} opens a draft`, { error: made.error });
      const claimId = String(rowsOf(made.data)[0].claim_id);
      const submitted = await account.client.rpc("submit_founder_payment", {
        p_claim_id: claimId,
        p_utr_reference: input,
        p_payer_name: payer,
      });
      allowed("validation", `${label} accepted`, { error: submitted.error });
      const claim = rowsOf(submitted.data)[0];
      expect(claim.utr_reference).toBe(storedUtr);
      expect(claim.payer_name).toBe(payer.trim());
      expect(claim.status).toBe("PENDING_REVIEW");
      expect(founderEntitlementsFor([account.userId])).toEqual([]);
    }
  });

  it("races two accounts on one reference and accepts exactly one", async () => {
    const [c, d] = await Promise.all([bootstrap("race1"), bootstrap("race2")]);
    const [madeC, madeD] = await Promise.all([c.client.rpc("create_founder_claim"), d.client.rpc("create_founder_claim")]);
    const idC = String(rowsOf(madeC.data)[0].claim_id);
    const idD = String(rowsOf(madeD.data)[0].claim_id);
    const shared = utrFor("RACE");
    const results = await Promise.all([
      c.client.rpc("submit_founder_payment", { p_claim_id: idC, p_utr_reference: shared, p_payer_name: "Race One" }),
      d.client.rpc("submit_founder_payment", { p_claim_id: idD, p_utr_reference: shared.toLowerCase(), p_payer_name: "Race Two" }),
    ]);
    const accepted = results.filter((result) => !result.error);
    const refused = results.filter((result) => result.error);
    expect(accepted.length).toBe(1);
    expect(refused.length).toBe(1);
    const message = refused[0].error!.message;
    expect(message).toContain("already been submitted");
    expect(`${refused[0].error!.code} ${message}`).not.toMatch(/23505|duplicate key value/i);
    const pending = localAdminValue(`select count(*) from public.purchase_claims where upper(utr_reference) = upper(${sqlLiteral(shared)}) and status in ('PENDING_REVIEW','APPROVED','REJECTED');`);
    expect(pending).toBe("1");
    expect(founderEntitlementsFor([c.userId, d.userId])).toEqual([]);
    observed("utr-integrity", "concurrent duplicate reference", `1 accepted, 1 controlled refusal, ${pending} stored reference`);
  });

  it("refuses a reused payment reference across accounts and after a rejection", async () => {
    const e = await bootstrap("dup");
    const made = await e.client.rpc("create_founder_claim");
    const claimId = String(rowsOf(made.data)[0].claim_id);
    const first = await e.client.rpc("submit_founder_payment", { p_claim_id: claimId, p_utr_reference: utrFor("D"), p_payer_name: "Dup Owner" });
    allowed("utr-integrity", "first submission of the reference", { error: first.error });

    // Another account cannot adopt a reference that is already in evidence. Each
    // probe runs against a DRAFT so the refusal proves the uniqueness gate, not
    // the claim-state gate.
    const f = await bootstrap("reuse");
    const theirDraft = await f.client.rpc("create_founder_claim");
    const theirClaim = String(rowsOf(theirDraft.data)[0].claim_id);
    const before = claimFingerprint([f.email]);
    for (const [label, value] of [
      ["exact match", utrFor("D")],
      ["lower case", utrFor("D").toLowerCase()],
      ["padded with spaces", `  ${utrFor("D")}  `],
      ["split by an inner space", `${utrFor("D").slice(0, 4)} ${utrFor("D").slice(4)}`],
    ] as const) {
      blocked(
        "utr-integrity",
        `cross-account reuse in ${label}`,
        denial("F", await f.client.rpc("submit_founder_payment", { p_claim_id: theirClaim, p_utr_reference: value, p_payer_name: "Reuser" }), "That payment reference has already been submitted")
      );
    }
    unchanged("utr-integrity", "a refused reuse leaves the draft untouched", claimFingerprint([f.email]), before);

    // The owning account cannot reuse it either once its claim is closed out.
    await state.reviewer!.client.rpc("reject_founder_claim", { p_claim_id: claimId, p_reason: "Duplicate probe" });
    const reopened = await e.client.rpc("create_founder_claim");
    allowed("utr-integrity", "a rejected account may open a fresh claim", { error: reopened.error });
    blocked(
      "utr-integrity",
      "same account reusing its own earlier reference",
      denial("E", await e.client.rpc("submit_founder_payment", { p_claim_id: String(rowsOf(reopened.data)[0].claim_id), p_utr_reference: utrFor("D"), p_payer_name: "Dup Owner" }), "That payment reference has already been submitted")
    );
    expect(founderEntitlementsFor([e.userId, f.userId])).toEqual([]);
  });

  it("lets a customer cancel only their own draft", async () => {
    const b = state.customerB!;
    const fresh = await bootstrap("canceller");
    const made = await fresh.client.rpc("create_founder_claim");
    const claimId = String(rowsOf(made.data)[0].claim_id);
    blocked("lifecycle", "cancel of another account's draft", denial("B", await b.client.rpc("cancel_founder_claim", { p_claim_id: claimId }), "This payment claim is not available for this account"));
    expect(claimFingerprint([fresh.email])[0]).toMatchObject({ status: "DRAFT" });
    const cancelled = await fresh.client.rpc("cancel_founder_claim", { p_claim_id: claimId });
    allowed("lifecycle", "owner cancels own draft", { error: cancelled.error });
    expect(rowsOf(cancelled.data)[0].status).toBe("CANCELLED");
    expect(auditFingerprint([fresh.email]).map((row) => row.event_type)).toContain("CLAIM_CANCELLED");
    const restart = await fresh.client.rpc("create_founder_claim");
    allowed("lifecycle", "a cancelled customer may start a fresh claim", { error: restart.error });
    expect(String(rowsOf(restart.data)[0].claim_id)).not.toBe(claimId);
    expect(rowsOf(restart.data)[0].status).toBe("DRAFT");
  });

  it("keeps one claim's commercial facts stable when the offer changes later", async () => {
    const a = state.customerA!;
    const before = claimFingerprint([a.email]);
    writeOffer({ payeeName: "Renamed Payee Fixture" });
    unchanged("snapshot", "renaming the payee does not rewrite an existing claim", claimFingerprint([a.email]), before);
    writeOffer(READY_OFFER);
    // A second reviewer action must compare against the stored amount, which is
    // what keeps a stale claim from being approved at a different price.
    const review = await state.reviewer!.client.rpc("list_pending_founder_claims");
    allowed("review-queue", "reviewer lists pending claims", { error: review.error });
    const mine = rowsOf(review.data).find((row) => row.claim_id === state.claimAC);
    expect(mine).toBeTruthy();
    expect(Number(mine!.amount_paise)).toBe(FOUNDER_PRICE_PAISE);
  });

  it("refuses every cross-account attempt on a foreign claim", async () => {
    const a = state.customerA!;
    const b = state.customerB!;
    const claimId = state.claimAC!;
    const foreignUtr = String(claimFingerprint([a.email])[0].utr);
    const probes: Array<[string, Promise<Probe>, string]> = [
      ["read A's claim through the table", b.client.from("purchase_claims").select("*").eq("claim_id", claimId), ""],
      ["submit A's claim", b.client.rpc("submit_founder_payment", { p_claim_id: claimId, p_utr_reference: utrFor("X"), p_payer_name: "Mallory" }), "not available for this account"],
      ["cancel A's claim", b.client.rpc("cancel_founder_claim", { p_claim_id: claimId }), "not available for this account"],
      ["approve A's claim", b.client.rpc("approve_founder_claim", { p_claim_id: claimId }), "Founder review access is not available"],
      ["reject A's claim", b.client.rpc("reject_founder_claim", { p_claim_id: claimId, p_reason: "x" }), "Founder review access is not available"],
      ["update A's claim row", b.client.from("purchase_claims").update({ payer_name: "Mallory" }).eq("claim_id", claimId).select(), ""],
      ["delete A's claim row", b.client.from("purchase_claims").delete().eq("claim_id", claimId).select(), ""],
    ];
    for (const [label, probe, expected] of probes) {
      const settled = await probe;
      if (expected) {
        blocked("cross-tenant", label, denial("B", settled, expected));
      } else {
        const touched = rowsOf(settled.data).length;
        const verdict = settled.error ? denial("B", settled) : { blocked: touched === 0, detail: `B touched ${touched} row(s) of A's claim` };
        blocked("cross-tenant", label, verdict);
      }
    }
    unchanged("cross-tenant", "A's claim is byte-for-byte untouched", claimFingerprint([a.email])[0].utr, foreignUtr);
    const bSees = rowsOf(await b.client.from("purchase_claims").select("*"));
    expect(bSees.some((row) => row.claim_id === claimId)).toBe(false);
    expect(bSees.some((row) => row.utr_reference === foreignUtr)).toBe(false);
  });

  it("refuses direct customer writes to a claim outside the protected transitions", async () => {
    const a = state.customerA!;
    const claimId = state.claimAC!;
    for (const [label, patch] of [
      ["status", { status: "APPROVED" }],
      ["amount", { amount_paise: 1 }],
      ["plan", { plan: "FREE" }],
      ["reference", { utr_reference: "FORGED1" }],
      ["payer", { payer_name: "Forged Payer" }],
      ["owner", { owner_id: state.outsider!.userId }],
      ["claim id", { claim_id: "DW-F-FORGED1234" }],
    ] as const) {
      const probe = await a.client.from("purchase_claims").update(patch).eq("claim_id", claimId).select();
      const touched = rowsOf(probe.data).length;
      blocked("immutability", `owner cannot rewrite ${label}`, probe.error ? denial("A", probe) : { blocked: touched === 0, detail: `A changed ${touched} claim column(s) directly` });
    }
    const inserts = await a.client.from("purchase_claims").insert({ owner_id: a.userId, claim_id: "DW-F-DIRECT0001", plan: "FOUNDER", amount_paise: FOUNDER_PRICE_PAISE, status: "DRAFT" }).select();
    blocked("immutability", "owner cannot insert a claim row directly", inserts.error ? denial("A", inserts) : { blocked: rowsOf(inserts.data).length === 0, detail: "direct claim insert was accepted" });
    unchanged("immutability", "A's claim still reads as pending with its own facts", claimFingerprint([a.email])[0], {
      claim_id: claimId,
      status: "PENDING_REVIEW",
      amount: FOUNDER_PRICE_PAISE,
      plan: "FOUNDER",
      utr: utrFor("A"),
      payer: "Asha Customer",
      reviewed_by: null,
    });
  });

  it("refuses every reviewer RPC to an ordinary account and leaks nothing", async () => {
    const outsider = state.outsider!;
    const reviewer = state.reviewer!;
    for (const [name, args] of [
      ["approve_founder_claim", { p_claim_id: state.claimAC }],
      ["reject_founder_claim", { p_claim_id: state.claimAC, p_reason: "not verified" }],
      ["reconsider_founder_claim", { p_claim_id: state.claimAC, p_bank_history_verified: true, p_note: "note" }],
      ["revoke_founder_entitlement", { p_user_id: reviewer.userId, p_reason: "test" }],
      ["list_pending_founder_claims", {}],
      ["list_rejected_founder_claims", {}],
      ["get_founder_funnel", {}],
    ] as const) {
      blocked("reviewer-boundary", `ordinary user cannot call ${name}`, denial("Outsider", await outsider.client.rpc(name, args as Record<string, unknown>), "Founder review access is not available"));
    }
    for (const helper of ["assert_founder_admin", "is_founder_admin", "prevent_direct_purchase_claim_change"]) {
      blocked("reviewer-boundary", `helper ${helper} is not callable from the browser`, notCallable("Outsider", await outsider.client.rpc(helper)));
    }
    const queue = await outsider.client.from("founder_audit_events").select("*");
    blocked("reviewer-boundary", "audit history is not readable from the browser", queue.error ? denial("Outsider", queue) : { blocked: rowsOf(queue.data).length === 0, detail: `outsider read ${rowsOf(queue.data).length} audit rows` });
    const allowlist = await outsider.client.from("founder_admins").select("*");
    blocked("reviewer-boundary", "reviewer allowlist is not readable from the browser", allowlist.error ? denial("Outsider", allowlist) : { blocked: rowsOf(allowlist.data).length === 0, detail: `outsider read ${rowsOf(allowlist.data).length} allowlist rows` });
    const offerWrite = await outsider.client.from("founder_offer_config").update({ payment_destination_status: "PLACEHOLDER" }).eq("offer_key", "FOUNDER_V1").select();
    blocked("reviewer-boundary", "customer cannot write the offer configuration", offerWrite.error ? denial("Outsider", offerWrite) : { blocked: rowsOf(offerWrite.data).length === 0, detail: "customer changed the payment destination" });
  });

  it("shows the reviewer exactly the pending fields and nothing else", async () => {
    const reviewer = state.reviewer!;
    const { data, error } = await reviewer.client.rpc("list_pending_founder_claims");
    allowed("review-queue", "reviewer lists pending claims", { error });
    const rows = rowsOf(data);
    expect(rows.length).toBeGreaterThan(0);
    const columns = new Set(rows.flatMap((row) => Object.keys(row)));
    expect([...columns].sort()).toEqual(["amount_paise", "claim_id", "owner_email", "owner_id", "payer_name", "submitted_at", "utr_reference"]);
    const mine = rows.find((row) => row.claim_id === state.claimAC)!;
    expect(mine.owner_email).toBe(state.customerA!.email);
    expect(mine.payer_name).toBe("Asha Customer");
    expect(mine.utr_reference).toBe(utrFor("A"));
    expect(Number(mine.amount_paise)).toBe(FOUNDER_PRICE_PAISE);
    for (const forbidden of ["password", "token", "pin", "otp", "email_password", "raw_user_meta_data", "receivable", "client_name"]) {
      expect(JSON.stringify(rows).toLowerCase()).not.toContain(forbidden);
    }
    observed("review-queue", "queue columns", [...columns].sort().join(","));
  });

  it("approves atomically: claim, entitlement, reviewer, audit and analytics land together", async () => {
    const reviewer = state.reviewer!;
    const a = state.customerA!;
    const before = { audit: auditFingerprint([a.email]).length, analytics: Number(localAdminValue(`select count(*) from public.analytics_events e join auth.users u on u.id = e.owner_id where u.email = ${sqlLiteral(a.email)}`)) };
    const { data, error } = await reviewer.client.rpc("approve_founder_claim", { p_claim_id: state.claimAC });
    allowed("approval-atomicity", "reviewer approves the pending claim", { error });
    expect(rowsOf(data)[0]).toMatchObject({ status: "APPROVED" });
    expect(claimFingerprint([a.email])[0]).toMatchObject({ status: "APPROVED", reviewed_by: reviewer.userId });
    expect(founderEntitlementsFor([a.userId])).toEqual([{ user_id: a.userId, plan: "FOUNDER", status: "ACTIVE", source: "PURCHASE" }]);
    const events = auditFingerprint([a.email]);
    expect(events.map((row) => row.event_type)).toEqual(["CLAIM_CREATED", "CLAIM_SUBMITTED", "CLAIM_APPROVED"]);
    expect(events.at(-1)!.metadata).toEqual({ source: "manual_bank_review" });
    const after = Number(localAdminValue(`select count(*) from public.analytics_events e join auth.users u on u.id = e.owner_id where u.email = ${sqlLiteral(a.email)}`));
    expect(after - before.analytics).toBe(1);
    observed("approval-atomicity", "activation analytics event", localAdminValue(`select e.event_name || '|' || e.metadata::text from public.analytics_events e join auth.users u on u.id = e.owner_id where u.email = ${sqlLiteral(a.email)} and e.event_name = 'founder_activated'`));
  });

  it("is idempotent on repeat approval: no second entitlement, seat or activation event", async () => {
    const reviewer = state.reviewer!;
    const a = state.customerA!;
    const seats = activeFounderCount();
    const auditBefore = auditFingerprint([a.email]);
    const analyticsBefore = localAdminValue(`select count(*)||'/'||coalesce(string_agg(event_name, ',' order by event_name), '') from public.analytics_events e join auth.users u on u.id = e.owner_id where u.email = ${sqlLiteral(a.email)}`);
    for (const again of [1, 2]) {
      const { data, error } = await reviewer.client.rpc("approve_founder_claim", { p_claim_id: state.claimAC });
      allowed("idempotency", `repeat approval #${again}`, { error });
      expect(rowsOf(data)[0]).toMatchObject({ status: "APPROVED" });
    }
    expect(activeFounderCount()).toBe(seats);
    expect(founderEntitlementsFor([a.userId])).toEqual([{ user_id: a.userId, plan: "FOUNDER", status: "ACTIVE", source: "PURCHASE" }]);
    unchanged("idempotency", "repeat approval appends no audit event", auditFingerprint([a.email]), auditBefore);
    expect(localAdminValue(`select count(*)||'/'||coalesce(string_agg(event_name, ',' order by event_name), '') from public.analytics_events e join auth.users u on u.id = e.owner_id where u.email = ${sqlLiteral(a.email)}`)).toBe(analyticsBefore);
  });

  it("refuses an already approved claim to be reopened or resubmitted by the customer", async () => {
    const a = state.customerA!;
    blocked("lifecycle", "customer cannot reopen an approved claim", denial("A", await a.client.rpc("submit_founder_payment", { p_claim_id: state.claimAC, p_utr_reference: utrFor("RE"), p_payer_name: "Asha Customer" }), "already been submitted or closed"));
    blocked("lifecycle", "customer cannot cancel an approved claim", denial("A", await a.client.rpc("cancel_founder_claim", { p_claim_id: state.claimAC }), "Only an unsubmitted payment claim can be cancelled"));
    const restart = await a.client.rpc("create_founder_claim");
    blocked("lifecycle", "an approved account cannot claim again", denial("A", restart, "Founder access is already active for this account"));
  });

  it("keeps available spots equal to cap minus active Founder entitlements", async () => {
    const { data, error } = await state.outsider!.client.rpc("get_founder_offer");
    allowed("seat-cap", "offer read for spot accounting", { error });
    const row = rowsOf(data)[0];
    const cap = Number(row.founder_cap);
    const active = activeFounderCount();
    expect(Number(row.available_spots)).toBe(Math.max(0, cap - active));
    expect(active).toBeGreaterThanOrEqual(1);
    observed("seat-cap", "spot accounting", `cap ${cap}, active ${active}, available ${row.available_spots}`);
  });

  it("races two approvals for one remaining seat and never exceeds the cap", async () => {
    const reviewer = state.reviewer!;
    const reviewerTwo = state.reviewerTwo!;
    const [w1, w2] = await Promise.all([bootstrap("seat1"), bootstrap("seat2")]);
    const made = await Promise.all([w1.client.rpc("create_founder_claim"), w2.client.rpc("create_founder_claim")]);
    const ids = made.map((result) => String(rowsOf(result.data)[0].claim_id));
    await Promise.all(ids.map((claimId, index) => {
      const owner = index === 0 ? w1 : w2;
      return owner.client.rpc("submit_founder_payment", { p_claim_id: claimId, p_utr_reference: utrFor(`S${index}`), p_payer_name: `Seat Buyer ${index}` });
    }));
    const seatsBefore = activeFounderCount();
    writeOffer({ founderCap: seatsBefore + 1 });
    const results = await Promise.all([
      reviewer.client.rpc("approve_founder_claim", { p_claim_id: ids[0] }),
      reviewerTwo.client.rpc("approve_founder_claim", { p_claim_id: ids[1] }),
    ]);
    const accepted = results.filter((result) => !result.error);
    const refused = results.filter((result) => result.error);
    expect(accepted.length).toBe(1);
    expect(refused.length).toBe(1);
    expect(refused[0].error!.message).toContain("currently full");
    expect(activeFounderCount()).toBe(seatsBefore + 1);
    const approved = claimFingerprint([w1.email, w2.email]).filter((row) => String((row as Row).status) === "APPROVED");
    expect(approved.length).toBe(1);
    writeOffer(READY_OFFER);
    observed("seat-cap", "one-seat race", `${accepted.length} approved, ${refused.length} refused, active ${activeFounderCount()}`);
    // The loser stays pending, and a later approval after the cap is raised must
    // succeed, so a refused race is not a lost claim.
    const retry = await reviewer.client.rpc("approve_founder_claim", { p_claim_id: refused[0] ? ids[results.indexOf(refused[0])] : ids[0] });
    allowed("seat-cap", "the other seat fills once capacity is restored", { error: retry.error });
  });

  it("rejects a pending claim with reviewer, timestamp, note and audit, and no entitlement", async () => {
    const reviewer = state.reviewer!;
    const c = await bootstrap("reject");
    const made = await c.client.rpc("create_founder_claim");
    const claimId = String(rowsOf(made.data)[0].claim_id);
    await c.client.rpc("submit_founder_payment", { p_claim_id: claimId, p_utr_reference: utrFor("R"), p_payer_name: "Ravi Customer" });
    const { data, error } = await reviewer.client.rpc("reject_founder_claim", { p_claim_id: claimId, p_reason: "Reference not found in bank history" });
    allowed("rejection", "reviewer rejects a pending claim", { error });
    expect(rowsOf(data)[0]).toMatchObject({ status: "REJECTED" });
    const stored = localAdminValue(`select jsonb_build_object('status', status, 'reviewed_at', reviewed_at is not null, 'reviewed_by', reviewed_by, 'note', review_note)::text from public.purchase_claims where claim_id = ${sqlLiteral(claimId)};`);
    expect(JSON.parse(stored)).toMatchObject({ status: "REJECTED", reviewed_at: true, reviewed_by: reviewer.userId, note: "Reference not found in bank history" });
    expect(founderEntitlementsFor([c.userId])).toEqual([]);
    const events = auditFingerprint([c.email]);
    expect(events.map((row) => row.event_type)).toEqual(["CLAIM_CREATED", "CLAIM_SUBMITTED", "CLAIM_REJECTED"]);
    expect(events.at(-1)!.metadata).toEqual({ reason: "Reference not found in bank history", source: "manual_bank_review" });
    const analytics = localAdminValue(`select coalesce(string_agg(event_name, ',' order by event_name), '') from public.analytics_events e join auth.users u on u.id = e.owner_id where u.email = ${sqlLiteral(c.email)};`);
    expect(analytics.split(",")).toContain("founder_rejected");
    const customer = await c.client.from("purchase_claims").select("claim_id, status, reviewed_at, submitted_at").eq("claim_id", claimId).single();
    expect(customer.data).toMatchObject({ status: "REJECTED" });
    observed("rejection", "customer-visible columns", Object.keys(customer.data ?? {}).sort().join(","));
  });

  it("keeps reviewer detail out of the customer's claim read", async () => {
    const c = await bootstrap("noteshow");
    const made = await c.client.rpc("create_founder_claim");
    const claimId = String(rowsOf(made.data)[0].claim_id);
    await c.client.rpc("submit_founder_payment", { p_claim_id: claimId, p_utr_reference: utrFor("NS"), p_payer_name: "Note Seeker" });
    await state.reviewer!.client.rpc("reject_founder_claim", { p_claim_id: claimId, p_reason: "Internal note: account 9876543210 differs" });
    const asAppReads = await c.client.from("purchase_claims")
      .select("id, claim_id, plan, amount_paise, payer_name, utr_reference, status, submitted_at, reviewed_at, created_at")
      .eq("claim_id", claimId)
      .single();
    allowed("rejection", "the application's own column list reads back", { error: asAppReads.error });
    expect(asAppReads.data).not.toHaveProperty("review_note");
    expect(asAppReads.data).not.toHaveProperty("reviewed_by");
    const wide = await c.client.from("purchase_claims").select("*").eq("claim_id", claimId).single();
    observed("evidence-privacy", "raw select-star exposure", wide.data && "review_note" in (wide.data as Row) ? "review_note is readable by the owning account" : "review_note is not readable by the owning account");
    expect(rowsOf(wide.data)[0]?.review_note ?? null).toBe("Internal note: account 9876543210 differs");
  });

  it("reconsiders a rejected claim only with explicit bank verification, keeping original evidence", async () => {
    const reviewer = state.reviewer!;
    const c = await bootstrap("reconsider");
    const made = await c.client.rpc("create_founder_claim");
    const claimId = String(rowsOf(made.data)[0].claim_id);
    const utr = utrFor("RC");
    await c.client.rpc("submit_founder_payment", { p_claim_id: claimId, p_utr_reference: utr, p_payer_name: "Reba Customer" });
    await reviewer.client.rpc("reject_founder_claim", { p_claim_id: claimId, p_reason: "Not visible at review time" });
    const before = localAdminValue(`select jsonb_build_object('utr', utr_reference, 'payer', payer_name, 'amount', amount_paise, 'plan', plan)::text from public.purchase_claims where claim_id = ${sqlLiteral(claimId)};`);
    const { data, error } = await reviewer.client.rpc("reconsider_founder_claim", { p_claim_id: claimId, p_bank_history_verified: true, p_note: "Confirmed in bank statement after the settlement window" });
    allowed("reconsideration", "trusted reconsideration approves the claim", { error });
    expect(rowsOf(data)[0]).toMatchObject({ status: "APPROVED" });
    const after = localAdminValue(`select jsonb_build_object('utr', utr_reference, 'payer', payer_name, 'amount', amount_paise, 'plan', plan)::text from public.purchase_claims where claim_id = ${sqlLiteral(claimId)};`);
    expect(after).toBe(before);
    const events = auditFingerprint([c.email]).map((row) => row.event_type);
    expect([...events].sort()).toEqual(["CLAIM_APPROVED_AFTER_REVIEW", "CLAIM_CREATED", "CLAIM_RECONSIDERED", "CLAIM_REJECTED", "CLAIM_SUBMITTED"]);
    // The reconsideration pair is written in one transaction, so both rows carry
    // the same `occurred_at` and the id is a random uuid: which of the two sorts
    // first is not something the schema guarantees, and the suite does not
    // pretend otherwise. The history itself is complete and attributable.
    observed("reconsideration", "intra-transaction audit order", "both reconsideration events present; ordering is not schema-enforced");
    expect(auditFingerprint([c.email]).every((row) => row.actor)).toBe(true);
    expect(founderEntitlementsFor([c.userId])).toEqual([{ user_id: c.userId, plan: "FOUNDER", status: "ACTIVE", source: "PURCHASE" }]);
  });

  // PHASE 33 — the negative matrix around reconsideration.
  it("refuses reconsideration outside a rejected claim and without verification", async () => {
    const reviewer = state.reviewer!;
    const outsider = state.outsider!;
    const pending = await bootstrap("pendformatrix");
    const made = await pending.client.rpc("create_founder_claim");
    const pendingId = String(rowsOf(made.data)[0].claim_id);
    await pending.client.rpc("submit_founder_payment", { p_claim_id: pendingId, p_utr_reference: utrFor("PM"), p_payer_name: "Pending Person" });
    const cancelledOwner = await bootstrap("cancelled");
    const cancelledDraft = await cancelledOwner.client.rpc("create_founder_claim");
    const cancelledId = String(rowsOf(cancelledDraft.data)[0].claim_id);
    await cancelledOwner.client.rpc("cancel_founder_claim", { p_claim_id: cancelledId });
    const approvedId = state.claimAC!;
    const unknownId = "DW-F-NOSUCH00001";

    // Ordered the way the function checks: authorization, then the operator
    // attestation, then the note, then the claim's own state, then capacity.
    const matrix: Array<[string, Account, string, boolean, string]> = [
      ["reviewer who skipped the bank-history attestation", reviewer, pendingId, false, "Confirm bank-history verification"],
      ["ordinary account with a valid attestation", outsider, pendingId, true, "Founder review access is not available"],
      ["a claim that is still pending", reviewer, pendingId, true, "Only a rejected Founder claim can be reconsidered"],
      ["a cancelled claim", reviewer, cancelledId, true, "Only a rejected Founder claim can be reconsidered"],
      ["an already approved claim", reviewer, approvedId, true, "Only a rejected Founder claim can be reconsidered"],
      ["a claim id that does not exist", reviewer, unknownId, true, "This Founder claim is not available"],
    ];
    for (const [label, actor, claimId, verified, expected] of matrix) {
      blocked("reconsideration", label, denial(label, await actor.client.rpc("reconsider_founder_claim", { p_claim_id: claimId, p_bank_history_verified: verified, p_note: "matrix probe" }), expected));
    }
    const changedPayer = await bootstrap("capfull");
    const theirDraft = await changedPayer.client.rpc("create_founder_claim");
    const theirClaim = String(rowsOf(theirDraft.data)[0].claim_id);
    await changedPayer.client.rpc("submit_founder_payment", { p_claim_id: theirClaim, p_utr_reference: utrFor("CF"), p_payer_name: "Capacity Test" });
    await reviewer.client.rpc("reject_founder_claim", { p_claim_id: theirClaim, p_reason: "not matched" });
    const seats = activeFounderCount();
    writeOffer({ founderCap: seats });
    blocked("reconsideration", "cap full", denial("reviewer", await reviewer.client.rpc("reconsider_founder_claim", { p_claim_id: theirClaim, p_bank_history_verified: true, p_note: "cap probe" }), "currently full"));
    writeOffer(READY_OFFER);
    expect(founderEntitlementsFor([changedPayer.userId])).toEqual([]);
    const long = await reviewer.client.rpc("reconsider_founder_claim", { p_claim_id: theirClaim, p_bank_history_verified: true, p_note: "n".repeat(301) });
    blocked("reconsideration", "over-long note", denial("reviewer", long, "concise"));
    const after = await reviewer.client.rpc("reconsider_founder_claim", { p_claim_id: theirClaim, p_bank_history_verified: true, p_note: "verified late" });
    allowed("reconsideration", "the same claim reconsiders after capacity is restored", { error: after.error });
    expect(claimFingerprint([changedPayer.email])[0]).toMatchObject({ status: "APPROVED", utr: utrFor("CF"), payer: "Capacity Test" });
  });

  it("revokes Founder access with reason and audit while keeping purchase history", async () => {
    const reviewer = state.reviewer!;
    const a = state.customerA!;
    const claimBefore = claimFingerprint([a.email]);
    const auditBefore = auditFingerprint([a.email]);
    blocked("revocation", "blank reason refused", denial("reviewer", await reviewer.client.rpc("revoke_founder_entitlement", { p_user_id: a.userId, p_reason: "   " }), "concise revocation reason"));
    const { error } = await reviewer.client.rpc("revoke_founder_entitlement", { p_user_id: a.userId, p_reason: "Refund issued after support review" });
    allowed("revocation", "reviewer revokes an active entitlement", { error });
    expect(founderEntitlementsFor([a.userId])).toEqual([{ user_id: a.userId, plan: "FOUNDER", status: "REVOKED", source: "PURCHASE" }]);
    unchanged("revocation", "the approved claim stays as purchase evidence", claimFingerprint([a.email]), claimBefore);
    const events = auditFingerprint([a.email]);
    expect(events.length).toBe(auditBefore.length + 1);
    expect(events.at(-1)!.event_type).toBe("ENTITLEMENT_REVOKED");
    expect(events.at(-1)!.metadata).toEqual({ reason: "Refund issued after support review", source: "manual_admin_action" });
    const again = await reviewer.client.rpc("revoke_founder_entitlement", { p_user_id: a.userId, p_reason: "double revoke" });
    blocked("revocation", "second revoke refused", denial("reviewer", again, "No active Founder entitlement is available for revocation"));
    const selfRevoke = await a.client.rpc("revoke_founder_entitlement", { p_user_id: a.userId, p_reason: "my own" });
    blocked("revocation", "an owner cannot revoke their own entitlement", denial("A", selfRevoke, "Founder review access is not available"));
    const restart = await a.client.rpc("create_founder_claim");
    allowed("lifecycle", "a revoked account may claim again", { error: restart.error });
    expect(rowsOf(restart.data)[0]).toMatchObject({ status: "DRAFT" });
  });

  it("applies the free-plan limit again after revocation without deleting records", async () => {
    const reviewer = state.reviewer!;
    const owner = await bootstrap("freelimit");
    const { data: madeClient, error: clientError } = await owner.client.rpc("create_client", { p_name: "Revocation Co", p_company: "", p_phone: "9876500001", p_email: "", p_notes: "" });
    allowed("revocation", "revoked owner still creates a client", { error: clientError });
    const clientId = String((madeClient as Row).id ?? (rowsOf(madeClient)[0]?.id ?? ""));
    assert(clientId, "client fixture must exist");
    const createdIds: string[] = [];
    for (let index = 1; index <= 3; index += 1) {
      const { data, error } = await owner.client.rpc("create_receivable", {
        p_client_id: clientId, p_label: `Invoice ${index}`, p_invoice_ref: `INV-${index}`, p_amount_due_paise: 10_000 * index, p_due_date: "2026-10-15", p_notes: "",
      });
      allowed("revocation", `free owner creates active receivable ${index}`, { error });
      createdIds.push(String((data as Row).id));
    }
    const overflow = await owner.client.rpc("create_receivable", {
      p_client_id: clientId, p_label: "Invoice 4", p_invoice_ref: "INV-4", p_amount_due_paise: 40_000, p_due_date: "2026-10-15", p_notes: "",
    });
    blocked("revocation", "a free account is capped at three active receivables", denial("owner", overflow, "Free plan allows up to 3 active receivables"));
    const claim = await owner.client.rpc("create_founder_claim");
    allowed("lifecycle", "the capped owner can start a Founder claim", { error: claim.error });
    const claimId = String(rowsOf(claim.data)[0].claim_id);
    await owner.client.rpc("submit_founder_payment", { p_claim_id: claimId, p_utr_reference: utrFor("FL"), p_payer_name: "Limit Seeker" });
    await reviewer.client.rpc("approve_founder_claim", { p_claim_id: claimId });
    expect(founderEntitlementsFor([owner.userId])).toEqual([{ user_id: owner.userId, plan: "FOUNDER", status: "ACTIVE", source: "PURCHASE" }]);
    const beyond = await owner.client.rpc("create_receivable", {
      p_client_id: clientId, p_label: "Invoice 4", p_invoice_ref: "INV-4", p_amount_due_paise: 40_000, p_due_date: "2026-10-15", p_notes: "",
    });
    allowed("revocation", "an active Founder is not capped at three", { error: beyond.error });
    const revoke = await reviewer.client.rpc("revoke_founder_entitlement", { p_user_id: owner.userId, p_reason: "Seat returned for verification" });
    allowed("revocation", "reviewer revokes the Founder entitlement", { error: revoke.error });
    unchanged("revocation", "all four active receivables survive revocation", createdIds.length + 1, 4);
    const after = await owner.client.rpc("create_receivable", {
      p_client_id: clientId, p_label: "Invoice 5", p_invoice_ref: "INV-5", p_amount_due_paise: 50_000, p_due_date: "2026-10-15", p_notes: "",
    });
    blocked("revocation", "a further transition then meets the free limit", denial("owner", after, "Free plan allows up to 3 active receivables"));
    const readable = await owner.client.from("receivables").select("id, status").eq("client_id", clientId);
    allowed("revocation", "existing records stay readable after revocation", { error: readable.error });
    expect(rowsOf(readable.data).length).toBe(4);
  });

  it("refuses to rewrite audit history", async () => {
    const a = state.customerA!;
    const reviewer = state.reviewer!;
    const auditId = localAdminValue(`select e.id from public.founder_audit_events e join auth.users u on u.id = e.target_user_id where u.email = ${sqlLiteral(a.email)} order by occurred_at limit 1;`);
    for (const [label, actor] of [["owner", a.client] as const, ["reviewer", reviewer.client] as const, ["outsider", state.outsider!.client] as const]) {
      const update = await actor.from("founder_audit_events").update({ event_type: "CLAIM_CREATED" }).eq("id", auditId).select();
      blocked("immutability", `${label} cannot update audit history`, update.error ? denial(label, update) : { blocked: rowsOf(update.data).length === 0, detail: `${label} rewrote an audit row` });
      const remove = await actor.from("founder_audit_events").delete().eq("id", auditId).select();
      blocked("immutability", `${label} cannot delete audit history`, remove.error ? denial(label, remove) : { blocked: rowsOf(remove.data).length === 0, detail: `${label} deleted an audit row` });
      const insert = await actor.from("founder_audit_events").insert({ target_user_id: a.userId, event_type: "CLAIM_APPROVED" }).select();
      blocked("immutability", `${label} cannot forge audit history`, insert.error ? denial(label, insert) : { blocked: rowsOf(insert.data).length === 0, detail: `${label} inserted an audit row directly` });
    }
    expect(auditFingerprint([a.email]).length).toBeGreaterThan(2);
  });

  it("keeps analytics evidence bounded and free of commercial detail", () => {
    const emails = [state.customerA!.email, state.customerB!.email];
    const dump = localAdminValue(`
      select coalesce(jsonb_agg(jsonb_build_object('event', e.event_name, 'metadata', e.metadata, 'entity_type', e.entity_type))::text, '[]')
        from public.analytics_events e join auth.users u on u.id = e.owner_id where u.email in (${emails.map(sqlLiteral).join(",")});`);
    const rows = JSON.parse(dump) as Array<{ event: string; metadata: Record<string, unknown>; entity_type: string | null }>;
    expect(rows.length).toBeGreaterThan(0);
    const allowedEvents = new Set(["upgrade_viewed", "founder_claim_created", "founder_payment_submitted", "founder_activated", "founder_rejected"]);
    const allowedKeys = new Set(["surface", "source"]);
    const secrets = [utrFor("A"), "Asha Customer", "Babu Customer", FIXTURE_VPA, FIXTURE_SUPPORT, "review_note"];
    for (const row of rows) {
      expect(allowedEvents.has(row.event), row.event).toBe(true);
      for (const key of Object.keys(row.metadata)) expect(allowedKeys.has(key), key).toBe(true);
      const text = JSON.stringify(row.metadata);
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
    observed("evidence-privacy", "analytics events seen", [...new Set(rows.map((row) => row.event))].sort().join(","));
  });

  it("counts the funnel by its real event names and calls none of them revenue", async () => {
    const { data, error } = await state.reviewer!.client.rpc("get_founder_funnel");
    allowed("evidence-privacy", "reviewer reads the funnel", { error });
    const names = rowsOf(data).map((row) => String(row.event_name));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(["upgrade_viewed", "founder_claim_created", "founder_payment_submitted", "founder_activated", "founder_rejected"]).toContain(name);
      expect(name).not.toMatch(/paid|revenue|sale|checkout|captured/i);
    }
    const countOf = (name: string) => Number(rowsOf(data).find((row) => row.event_name === name)?.event_count ?? 0);
    // Every activation was a submission and every submission was a claim, so the
    // funnel can only descend. An inverted column would mean the counts were
    // invented rather than observed. `upgrade_viewed` is independent of the
    // chain, so it is reported rather than compared.
    expect(countOf("founder_activated")).toBeLessThanOrEqual(countOf("founder_payment_submitted"));
    expect(countOf("founder_payment_submitted")).toBeLessThanOrEqual(countOf("founder_claim_created"));
    expect(countOf("founder_claim_created")).toBeGreaterThan(0);
    observed("evidence-privacy", "upgrade views are independent", `upgrade_viewed=${countOf("upgrade_viewed")}`);
    observed("evidence-privacy", "funnel rows", rowsOf(data).map((row) => `${row.event_name}=${row.event_count}`).join(","));
  });

  it("keeps a reviewer an ordinary customer for everyone else's ledger", async () => {
    const reviewer = state.reviewer!;
    const victim = state.customerB!;
    blocked("reviewer-boundary", "a reviewer cannot call the internal predicate either", notCallable("reviewer", await reviewer.client.rpc("is_founder_admin")));
    const role = localAdminValue(`select rolname||'|'||(rolsuper::text)||'/'||(rolbypassrls::text) from pg_roles where rolname = 'authenticated';`);
    expect(role).toMatch(/^authenticated\|false\/false$/);
    for (const table of ["clients", "receivables", "promises", "payments", "activities"]) {
      const probe = await reviewer.client.from(table).select("*");
      const verdict = probe.error
        ? denial("reviewer", probe)
        : { blocked: rowsOf(probe.data).every((row) => String(row.owner_id ?? "") === reviewer.userId), detail: `reviewer read ${rowsOf(probe.data).length} ${table} row(s)` };
      blocked("reviewer-boundary", `reviewer cannot read ${table} rows of another account`, verdict);
    }
    const victimReceivable = localAdminValue(`select r.id from public.receivables r join auth.users u on u.id = r.owner_id where u.email = ${sqlLiteral(victim.email)} limit 1;`) || "none";
    if (victimReceivable !== "none") {
      const read = await reviewer.client.from("receivables").select("*").eq("id", victimReceivable);
      blocked("reviewer-boundary", "reviewer cannot read a specific foreign receivable", read.error ? denial("reviewer", read) : { blocked: rowsOf(read.data).length === 0, detail: "reviewer read a foreign receivable" });
      const write = await reviewer.client.rpc("record_payment", { p_receivable_id: victimReceivable, p_amount_paise: 100, p_paid_on: "2026-09-20", p_method: "UPI", p_reference: "x", p_request_id: "00000000-0000-4000-8000-000000000001" });
      blocked("reviewer-boundary", "reviewer cannot record a payment on a foreign receivable", denial("reviewer", write));
    }
    const own = await reviewer.client.rpc("create_client", { p_name: "Reviewer Own Co", p_company: "", p_phone: "9876500009", p_email: "", p_notes: "" });
    allowed("reviewer-boundary", "reviewer keeps ordinary owner powers on their own ledger", { error: own.error });
  });

  it("restores the delivered offer and leaves no fixture residue", async () => {
    const delivered = state.delivered!;
    restoreOffer(delivered);
    const current = offerRow();
    expect(current).toEqual(delivered);
    expect(current.paymentDestinationStatus).toBe("PLACEHOLDER");
    expect(current.upiId).toBeUndefined();
    expect(founderReadinessGaps(current).length).toBeGreaterThan(0);
    const closed = await state.customerB!.client.rpc("create_founder_claim");
    blocked("readiness-gate", "gate is closed again for the next suite", denial("B", closed, "Founder payment instructions are not ready yet"));
    // Purging here, then re-checking from outside the transaction, is what makes
    // "no fixture residue" an observation rather than a promise about teardown.
    purgeFixtures();
    const residue = Number(localAdminValue("select count(*) from public.purchase_claims where owner_id in (select id from auth.users where email like 'stage8-%@dueweave.local');"));
    expect(residue).toBe(0);
    expect(Number(localAdminValue("select count(*) from public.founder_admins where user_id in (select id from auth.users where email like 'stage8-%@dueweave.local');"))).toBe(0);
    expect(Number(localAdminValue("select count(*) from public.entitlements where user_id in (select id from auth.users where email like 'stage8-%@dueweave.local');"))).toBe(0);
    expect(Number(localAdminValue("select count(*) from public.founder_audit_events where target_user_id in (select id from auth.users where email like 'stage8-%@dueweave.local');"))).toBe(0);
    expect(activeFounderCount()).toBe(0);
  });

  it("writes the executed ledger for the stage report", () => {
    expect(ledger.length).toBeGreaterThan(40);
    const categories = [...new Set(ledger.map((entry) => entry.category))].sort();
    expect(categories.length).toBeGreaterThan(8);
    observed("readiness-gate", "ledger categories covered", categories.join(","));
  });
});
