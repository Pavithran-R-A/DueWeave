import { execFileSync } from "node:child_process";

// Both Stage 8 browser journeys need the same two things the live suite needs: a
// payment-ready offer that is obviously synthetic, and a teardown that cannot leave
// it behind. A ready offer that survives a run is an open payment gate on a machine
// that also builds the production bundle, so the write and the purge live in one
// file rather than being re-typed per spec.
//
// Everything here talks to the local container as the database superuser through
// `docker exec`. No service-role key exists in this file, and nothing here can reach
// a hosted project: the container name only resolves to this repository's local stack.

const localDbContainer = "supabase_db_dueweave";

export const FIXTURE_VPA = "dueweave-test@upi";
export const FIXTURE_PAYEE = "DueWeave Test Fixture";
export const FIXTURE_SUPPORT = "founder-support+fixture@example.invalid";
export const FIXTURE_REFUND_TEXT =
  "Fixture refund terms for local Stage 8 verification only: a Founder purchase may be refunded on request within seven days of activation when paid features have not been materially used.";

// The browser accounts are namespaced apart from the live suite's accounts so the
// two cleanups can never delete each other's rows.
const fixtureEmail = "stage8e2e-%@dueweave.local";

export const UPI_PRICE_TEXT = "499.00";
export const PRICE_DISPLAY = "₹499";
export const UPI_NOTE = "DueWeave Founder Lifetime";

// The payment URI the stored fixture facts must produce, serialised the way a payment
// URI has to be serialised. Comparing the QR against the link using only the app's own
// string would prove just that the app agrees with itself, so the canonical form is
// written down here from the fixture values and both channels are checked against it.
export const CANONICAL_UPI_URI = `upi://pay?${new URLSearchParams({
  pa: FIXTURE_VPA,
  pn: FIXTURE_PAYEE,
  am: UPI_PRICE_TEXT,
  cu: "INR",
  tn: UPI_NOTE,
}).toString()}`;

export type OfferSnapshot = {
  amountPaise: number;
  founderCap: number;
  payeeName: string;
  upiId: string | null;
  destinationStatus: string;
  supportContact: string;
  supportContactStatus: string;
  refundPolicyStatus: string;
  refundPolicyText: string | null;
  disclosuresStatus: string;
  enabled: boolean;
};

/**
 * `ON_ERROR_STOP=1` is load-bearing here, exactly as in the live suite: psql exits 0
 * even when its statement errors, so without the flag a write a check constraint
 * refused reads as a configuration change that worked.
 */
function localAdmin(sql: string) {
  execFileSync("docker", ["exec", "-i", localDbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], {
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function localValue(sql: string): string {
  return execFileSync("docker", ["exec", "-i", localDbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

function literal(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${value.replace(/'/g, "''")}'`;
}

export function readOffer(): OfferSnapshot {
  const parts = localValue(
    "select concat_ws('|', amount_paise::text, founder_cap::text, coalesce(payee_name,''), coalesce(upi_id,''), payment_destination_status, coalesce(support_contact,''), support_contact_status, refund_policy_status, coalesce(refund_policy_text,''), disclosures_status, enabled::text) from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
  ).split("|");
  return {
    amountPaise: Number(parts[0]),
    founderCap: Number(parts[1]),
    payeeName: parts[2],
    upiId: parts[3] === "" ? null : parts[3],
    destinationStatus: parts[4],
    supportContact: parts[5],
    supportContactStatus: parts[6],
    refundPolicyStatus: parts[7],
    refundPolicyText: parts[8] === "" ? null : parts[8],
    disclosuresStatus: parts[9],
    enabled: parts[10] === "true",
  };
}

export function restoreOffer(snapshot: OfferSnapshot) {
  localAdmin(`update public.founder_offer_config set
    amount_paise = ${literal(snapshot.amountPaise)},
    founder_cap = ${literal(snapshot.founderCap)},
    payee_name = ${literal(snapshot.payeeName)},
    upi_id = ${literal(snapshot.upiId)},
    payment_destination_status = ${literal(snapshot.destinationStatus)},
    support_contact = ${literal(snapshot.supportContact)},
    support_contact_status = ${literal(snapshot.supportContactStatus)},
    refund_policy_status = ${literal(snapshot.refundPolicyStatus)},
    refund_policy_text = ${literal(snapshot.refundPolicyText)},
    disclosures_status = ${literal(snapshot.disclosuresStatus)},
    enabled = ${literal(snapshot.enabled)}
    where offer_key = 'FOUNDER_V1';`);
}

/**
 * The trusted-operator configuration the readiness conjunction describes, reached
 * only inside a running browser journey and always restored. The destination is
 * marked LIVE because that is the one state the customer claim RPCs accept — a
 * TEST destination must never open the workflow — and the VPA behind it is the
 * fixture address above, not a real one.
 */
export function applyReadyOffer() {
  localAdmin(`update public.founder_offer_config set
    payment_destination_status = 'LIVE',
    upi_id = ${literal(FIXTURE_VPA)},
    payee_name = ${literal(FIXTURE_PAYEE)},
    support_contact = ${literal(FIXTURE_SUPPORT)},
    support_contact_status = 'CONFIGURED',
    refund_policy_status = 'APPROVED',
    refund_policy_text = ${literal(FIXTURE_REFUND_TEXT)},
    disclosures_status = 'APPROVED',
    enabled = true
    where offer_key = 'FOUNDER_V1';`);
}

/** Move the seat cap for one journey. `restoreOffer` puts it back with everything else. */
export function setFounderCap(cap: number) {
  localAdmin(`update public.founder_offer_config set founder_cap = ${literal(cap)} where offer_key = 'FOUNDER_V1';`);
}/**
 * A reviewer is an ordinary authenticated account plus one row in a server-controlled
 * allowlist. No browser request can add that row — which is the point the reviewer
 * journey asserts from the other side — so the fixture writes it directly.
 */
export function markReviewer(email: string) {
  localAdmin(`insert into public.founder_admins (user_id) select id from auth.users where email = ${literal(email)};`);
}

/** The account's own id, for the one reviewer RPC that takes a user rather than a claim. */
export function userIdFor(email: string): string {
  return localValue(`select id from auth.users where email = ${literal(email)};`);
}

/**
 * The funnel the reviewer screen renders is a count over `analytics_events`, not over
 * this run's accounts, so a journey that checks a number has to check it against the
 * same unscoped count the RPC makes.
 */
export function analyticsEventCount(event: string): number {
  return Number(localValue(`select count(*) from public.analytics_events where event_name = ${literal(event)};`) || "0");
}

export type ClaimRow = { status: string; utr: string; payer: string; amount: number };

export function claimFor(email: string): ClaimRow | null {
  const line = localValue(
    `select concat_ws('|', c.status, coalesce(c.utr_reference,''), coalesce(c.payer_name,''), c.amount_paise::text)
       from public.purchase_claims c join auth.users u on u.id = c.owner_id
      where u.email = ${literal(email)} order by c.created_at desc limit 1;`
  );
  if (!line) return null;
  const [status, utr, payer, amount] = line.split("|");
  return { status, utr, payer, amount: Number(amount) };
}

export function claimIdFor(email: string): string {
  return localValue(
    `select c.claim_id from public.purchase_claims c join auth.users u on u.id = c.owner_id
      where u.email = ${literal(email)} order by c.created_at desc limit 1;`
  );
}

export function claimCountFor(email: string): number {
  return Number(
    localValue(
      `select count(*) from public.purchase_claims c join auth.users u on u.id = c.owner_id
        where u.email = ${literal(email)};`
    ) || "0"
  );
}

// Read apart from `claimFor` because a review note is free text and cannot travel the
// delimiter that function packs its columns with.
export function reviewNoteFor(email: string): string {
  return localValue(
    `select coalesce(c.review_note, '')
       from public.purchase_claims c join auth.users u on u.id = c.owner_id
      where u.email = ${literal(email)} order by c.created_at desc limit 1;`
  );
}

export function planFor(email: string): string {
  return localValue(
    `select string_agg(e.plan || ':' || e.status, ',' order by e.plan)
       from public.entitlements e join auth.users u on u.id = e.user_id
      where u.email = ${literal(email)};`
  );
}

export function auditEventsFor(email: string): string[] {
  const value = localValue(
    `select string_agg(e.event_type, ',' order by e.event_type)
       from public.founder_audit_events e join auth.users u on u.id = e.target_user_id
      where u.email = ${literal(email)};`
  );
  return value ? value.split(",") : [];
}

export function activeFounderCount(): number {
  return Number(localValue("select count(*) from public.entitlements where plan = 'FOUNDER' and status = 'ACTIVE';") || "0");
}

// The same set of statuses the Free-plan trigger counts, so a journey that says
// "the limit still applies" is measuring the rule the database enforces.
export function activeReceivableCount(email: string): number {
  return Number(
    localValue(
      `select count(*) from public.receivables r join auth.users u on u.id = r.owner_id
        where u.email = ${literal(email)} and r.status in ('OPEN', 'PARTIALLY_PAID');`
    ) || "0"
  );
}

/**
 * Triggers are suspended for one transaction only, and `session_replication_role`
 * reverts at commit, so no guard is left disabled for the next run. Disabling the
 * triggers by name instead was measured to deadlock against the running API and to
 * force a schema-cache reload from the DDL event trigger.
 */
export function purgeBrowserFixtures() {
  localAdmin(`begin;
    set local session_replication_role = replica;
    delete from public.founder_audit_events where target_user_id in (select id from auth.users where email like '${fixtureEmail}') or actor_user_id in (select id from auth.users where email like '${fixtureEmail}');
    delete from public.founder_admins where user_id in (select id from auth.users where email like '${fixtureEmail}');
    delete from public.purchase_claims where owner_id in (select id from auth.users where email like '${fixtureEmail}');
    delete from public.analytics_events where owner_id in (select id from auth.users where email like '${fixtureEmail}');
    delete from public.activities where owner_id in (select id from auth.users where email like '${fixtureEmail}');
    delete from public.promise_events where owner_id in (select id from auth.users where email like '${fixtureEmail}');
    delete from public.payments where owner_id in (select id from auth.users where email like '${fixtureEmail}');
    delete from public.promises where owner_id in (select id from auth.users where email like '${fixtureEmail}');
    delete from public.receivables where owner_id in (select id from auth.users where email like '${fixtureEmail}');
    delete from public.clients where owner_id in (select id from auth.users where email like '${fixtureEmail}');
    delete from public.entitlements where user_id in (select id from auth.users where email like '${fixtureEmail}');
    delete from public.profiles where id in (select id from auth.users where email like '${fixtureEmail}');
    delete from auth.users where email like '${fixtureEmail}';
    commit;`);
}
