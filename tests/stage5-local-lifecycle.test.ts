import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabase } from "@/lib/supabase";
import { addIndiaBusinessDays, getLastContacted, getQueue, getReliability, priorityReasons } from "@/lib/finance";
import { toIndiaBusinessDate, todayInIndia, type BusinessClock } from "@/lib/business-clock";
import { SupabaseClientRepository } from "@/data/supabase-client-repository";
import { SupabaseReceivableRepository } from "@/data/supabase-receivable-repository";
import { SupabasePromiseRepository } from "@/data/supabase-promise-repository";
import { SupabasePaymentRepository } from "@/data/supabase-payment-repository";
import { SupabaseActivityRepository } from "@/data/supabase-activity-repository";
import type { LedgerState, PaymentMethod, PromiseRecord, PromiseSource, Receivable } from "@/types/domain";

// Stage 5 opens by proving what the executed database does to a promise when
// money arrives. Every case below asserts the outcome the ledger OUGHT to be
// able to state, so the ones that describe a real defect fail first — that
// failure is the evidence, and no SQL is edited until it has been captured.
//
// Everything goes through the same repository classes the SPA imports, against
// the same signed-in client the SPA uses. No React state is inspected, and no
// service-role key appears anywhere in this file.

const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const isLoopbackStack = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/i.test(url);
const describeLocalStack = isLoopbackStack && anonKey.length > 0 ? describe : describe.skip;

const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailFor = (label: string) => `stage5life-${label}-${runTag}@dueweave.local`;
const newPassword = () => `Stage5l!${Math.random().toString(36).slice(2, 12)}aA`;

const localDbContainer = process.env.STAGE5_LOCAL_DB_CONTAINER ?? "supabase_db_dueweave";

function localAdmin(sql: string) {
  return String(
    execFileSync("docker", ["exec", "-i", localDbContainer, "psql", "-U", "postgres", "-d", "postgres", "--set=ON_ERROR_STOP=1", "-A", "-t", "-f", "-"], {
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    })
  ).trim();
}

// The history guards refuse DELETE even to the table owner, so a purge has to
// step around them. Doing it with `alter table … disable trigger` was tried
// first and is wrong: that asks for ACCESS EXCLUSIVE on each history table while
// the ledger RPCs are mid-write, and a money insert waiting for `activities`
// behind a purge that is itself waiting for `payments` is a cycle. Postgres
// broke it by killing the innocent money write, which is exactly the failure
// this suite exists to make impossible. One superuser-local, transaction-scoped
// setting skips the triggers instead, holds no DDL lock at all, and cannot
// outlive the transaction that set it.
const PROTECTED_HISTORY_TRIGGERS: Array<[table: string, trigger: string]> = [
  ["public.activities", "activities_immutable"],
  ["public.payments", "payments_immutable"],
  ["public.promise_events", "promise_events_immutable"],
  ["public.promises", "promises_guard_history"],
];

function historyGuardState() {
  return localAdmin(`select count(*) filter (where tgenabled = 'O') || '/' || count(*) from pg_trigger where tgname in (${PROTECTED_HISTORY_TRIGGERS.map(([, trigger]) => `'${trigger}'`).join(",")});`);
}

function purgeLocalFixtures(emailPattern: string) {
  const tables: Array<[string, string]> = [
    ["public.activities", "owner_id"],
    ["public.promise_events", "owner_id"],
    ["public.payments", "owner_id"],
    ["public.promises", "owner_id"],
    ["public.receivables", "owner_id"],
    ["public.clients", "owner_id"],
    ["public.analytics_events", "owner_id"],
    ["public.entitlements", "user_id"],
    ["public.profiles", "id"],
  ];
  const owned = tables.map(([table, column]) => `  delete from ${table} where ${column} in (select id from auth.users where email like '${emailPattern}');`).join("\n");
  const residue = localAdmin(`begin;
set local session_replication_role = replica;
${owned}
  delete from auth.users where email like '${emailPattern}';
commit;
select 'residue=' || count(*) from auth.users where email like '${emailPattern}';`);
  // Teardown reports the guards alongside the residue so that every purge in
  // this file proves it left them enabled rather than trusting one block to.
  return `${residue} guards=${historyGuardState()}`;
}

const passwords = new Map<string, string>();

async function signInAs(label: string) {
  await supabase.auth.signOut();
  passwords.set(label, passwords.get(label) ?? newPassword());
  const password = passwords.get(label)!;
  const signed = await supabase.auth.signUp({ email: emailFor(label), password, options: { data: { display_name: `Stage 5 lifecycle ${label}` } } });
  if (signed.error) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: emailFor(label), password });
    expect(error ?? null, `local sign-in failed for ${label}`).toBeNull();
    expect(data.session, `local sign-in returned no session for ${label}`).toBeTruthy();
    return;
  }
  expect(signed.data.session, `local signup returned no session for ${label}`).toBeTruthy();
}

const rupees = (amount: number) => amount * 100;

const clients = new SupabaseClientRepository();
const receivables = new SupabaseReceivableRepository();
const promises = new SupabasePromiseRepository();
const payments = new SupabasePaymentRepository();

/** The stored truth, read back through a repository nobody else has touched. */
async function storedPromise(receivableId: string) {
  const rows = await new SupabasePromiseRepository().list();
  return rows.filter((row) => row.receivableId === receivableId).sort((a, b) => a.sequenceNo - b.sequenceNo);
}

async function storedReceivable(receivableId: string) {
  const rows = await new SupabaseReceivableRepository().list();
  return rows.find((row) => row.id === receivableId);
}

async function seedInvoice(invoiceRef: string, amountDuePaise: number, dueDate: string) {
  const client = await clients.create({ name: `Stage 5 ${invoiceRef}`, company: "", phone: "919876500001", email: "", notes: "" });
  const receivable = await receivables.createForClient({ clientId: client.id, label: `Invoice ${invoiceRef}`, invoiceRef, amountPaise: amountDuePaise, dueDate, notes: "" });
  return { clientId: client.id, receivableId: receivable.id };
}

// Money writes now carry a request id of their own, so the database can replay
// a retry instead of writing twice. Each line below is a genuinely distinct
// request, so each gets a fresh id — the idempotency cases in Phase 16 hand the
// same id over on purpose.
//
// The promise-origin date a fixture states is a fact about the customer, so the
// cases that need a particular window pass `madeOn` explicitly. The default is
// the same conservative choice the legacy backfill makes: a promise whose day
// has already gone by gets its origin on that day (the fixture is not claiming
// to know an earlier one), and a promise still ahead of us was made today. This
// is a test-fixture convention, not product behaviour — the product form makes
// the user state the date.
const defaultMadeOn = (promisedDate: string) => (promisedDate < todayInIndia() ? promisedDate : todayInIndia());
const promiseFor = (receivableId: string, amountPaise: number, promisedDate: string, source: PromiseSource, note: string, madeOn = defaultMadeOn(promisedDate)) =>
  promises.create({ receivableId, amountPaise, madeOn, promisedDate, source, note, requestId: crypto.randomUUID() });
const paymentFor = (receivableId: string, amountPaise: number, paidOn: string, method: PaymentMethod, reference: string) =>
  payments.record({ receivableId, amountPaise, paidOn, method, reference, requestId: crypto.randomUUID() });

// The phases below are about what the DATABASE refuses, so some of them drive an
// RPC directly instead of going through a repository: a check that only existed
// in TypeScript would still "pass" through the repository, and the brief's whole
// point is that the ledger's rules hold even for a browser that skips its own
// form validation. Still the signed-in user's own client — never a service-role
// key.
async function rpcRaw(functionName: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(functionName, args as never);
  return { data, message: error?.message ?? "", code: (error as { code?: string } | null)?.code ?? "" };
}

const paymentRpc = (receivableId: string, amountPaise: number | null, paidOn: string | null, method: string, reference: string, requestId: string | null, note = "") =>
  rpcRaw("record_payment", { p_receivable_id: receivableId, p_amount_paise: amountPaise, p_paid_on: paidOn, p_method: method, p_reference: reference, p_request_id: requestId, p_note: note });

const promiseRpc = (receivableId: string, amountPaise: number | null, promisedDate: string | null, source: string, note: string, requestId: string | null, madeOn: string | null = defaultMadeOn(promisedDate ?? todayInIndia())) =>
  rpcRaw("create_promise", { p_receivable_id: receivableId, p_promised_amount_paise: amountPaise, p_made_on: madeOn, p_promised_date: promisedDate, p_source: source, p_note: note, p_request_id: requestId });

async function currentOwnerId() {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id ?? "";
  // Interpolated into an administrative query below, so it must be a uuid and
  // nothing else.
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id;
}

/** The outcome trail exactly as the ledger stored it, read by its owner. The
 *  SPA has no reader for this table, so the raw column values are asserted —
 *  a normalised view would hide the very history this phase proves. */
async function promiseEvents(promiseId: string) {
  const { data, error } = await supabase
    .from("promise_events")
    .select("id, from_status, to_status, reason, actor_type, created_at, metadata")
    .eq("promise_id", promiseId)
    .order("created_at", { ascending: true });
  expect(error ?? null, `an owner must be able to read their own promise history (${promiseId})`).toBeNull();
  return data ?? [];
}

async function historyKinds(receivableId: string) {
  const { data, error } = await supabase.from("activities").select("type").eq("receivable_id", receivableId).order("occurred_at", { ascending: true });
  expect(error ?? null, `the timeline read failed for ${receivableId}`).toBeNull();
  return (data ?? []).map((row) => String(row.type));
}

async function storedPayments(receivableId: string) {
  const rows = await new SupabasePaymentRepository().list();
  return rows.filter((row) => row.receivableId === receivableId);
}

/** A second client carrying the same session, so two writes can genuinely be in
 *  flight at once instead of being queued by one client's token refresh. Same
 *  authenticated role, same user — the race this attacks is server-side. */
function clientWithSession(accessToken: string) {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function accessTokenOfCurrentUser() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  expect(token.length, "no session to race against").toBeGreaterThan(0);
  return token;
}

/** The reconciliation the brief insists be executed rather than described: every
 *  stored balance must equal its own payment history, and no receivable may
 *  carry a status its balance contradicts. A CANCELLED row is the one exception
 *  to "due minus paid" — closing an invoice preserves the amount and zeroes the
 *  balance — and it must have no receipts behind it. Any non-zero count is a
 *  live defect, which is why the callers assert on it instead of printing it.
 *  The same predicate is pinned in supabase/tests/stage5_01_lifecycle.sql. */
function ledgerAuditSql(owner: string) {
  return `select count(*) from public.receivables r
    left join (select receivable_id, sum(amount_paise) as paid from public.payments group by receivable_id) py on py.receivable_id = r.id
    where r.owner_id = '${owner}'
      and (
        r.outstanding_paise < 0
        or (r.status <> 'CANCELLED' and r.outstanding_paise <> r.amount_due_paise - coalesce(py.paid, 0))
        or (r.status = 'CANCELLED' and (r.outstanding_paise <> 0 or coalesce(py.paid, 0) <> 0))
        or (r.status = 'OPEN' and r.outstanding_paise <> r.amount_due_paise)
        or (r.status = 'PARTIALLY_PAID' and (r.outstanding_paise <= 0 or r.outstanding_paise >= r.amount_due_paise))
        or (r.status = 'PAID' and r.outstanding_paise <> 0)
      );`;
}

function balanceVsHistorySql(receivableId: string) {
  return `select coalesce((select outstanding_paise from public.receivables where id = '${receivableId}'), -1) - (
    select r.amount_due_paise - coalesce((select sum(p.amount_paise) from public.payments p where p.receivable_id = r.id), 0)
      from public.receivables r where r.id = '${receivableId}');`;
}

// One owner per case: the pre-existing Free-plan invariant caps an owner at
// three OPEN/PARTIALLY_PAID receivables, and this suite is about promise
// settlement, not that cap. Separate ledgers also keep each case's queue,
// reliability and history reads unpolluted by its neighbours.
describeLocalStack("Stage 5 promise settlement as the database must decide it", () => {
  const today = todayInIndia();
  const inThreeDays = addIndiaBusinessDays(today, 3);
  const yesterday = addIndiaBusinessDays(today, -1);
  const dueInMonth = addIndiaBusinessDays(today, 30);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    expect(historyGuardState()).toBe("4/4");
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 lifecycle fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("case A: leaves a partially funded promise ACTIVE while its promised date is still ahead", async () => {
    await signInAs("case-a");
    const { receivableId } = await seedInvoice("S5A", rupees(10_000), dueInMonth);
    await promiseFor(receivableId, rupees(5_000), inThreeDays, "WhatsApp", "Client promised half by the 3rd.");
    await paymentFor(receivableId, rupees(2_000), today, "UPI", "");
    const [promise] = await storedPromise(receivableId);
    // A promise is not failed, kept or partial while the day it names has not
    // arrived: the customer still has time to honour it.
    expect(promise.status, "a part-paid in-date promise must still be ACTIVE").toBe("ACTIVE");
  }, 60_000);

  it("case B: records a promise as KEPT once payments totalling the promised sum arrive in time", async () => {
    await signInAs("case-b");
    const { receivableId } = await seedInvoice("S5B", rupees(10_000), dueInMonth);
    await promiseFor(receivableId, rupees(5_000), inThreeDays, "Call", "Two instalments promised.");
    await paymentFor(receivableId, rupees(2_000), today, "UPI", "");
    await paymentFor(receivableId, rupees(3_000), today, "UPI", "");
    const [promise] = await storedPromise(receivableId);
    expect(promise.status, "₹2,000 + ₹3,000 against a ₹5,000 promise is the whole promise").toBe("KEPT");
    expect((await storedReceivable(receivableId))!.status, "the invoice itself is still not settled").toBe("PARTIALLY_PAID");
  }, 60_000);

  it("case E: keeps a fully honoured promise on an invoice that is still only partially paid", async () => {
    await signInAs("case-e");
    const { receivableId } = await seedInvoice("S5E", rupees(10_000), dueInMonth);
    await promiseFor(receivableId, rupees(5_000), inThreeDays, "WhatsApp", "Headline scenario from the Stage 5 brief.");
    await paymentFor(receivableId, rupees(5_000), today, "Bank transfer", "");
    const [promise] = await storedPromise(receivableId);
    const receivable = await storedReceivable(receivableId);
    // Promise fulfilled and invoice cleared are separate facts.
    expect(promise.status, "the customer paid everything they promised").toBe("KEPT");
    expect(receivable!.status).toBe("PARTIALLY_PAID");
  }, 60_000);

  it("case C: grades a part-funded promise PARTIALLY_KEPT once its date has passed", async () => {
    await signInAs("case-c");
    const { receivableId } = await seedInvoice("S5C", rupees(10_000), dueInMonth);
    await promiseFor(receivableId, rupees(5_000), yesterday, "Call", "Only ₹2,000 of ₹5,000 arrived by the date.");
    await paymentFor(receivableId, rupees(2_000), yesterday, "UPI", "");
    await promises.markDuePromisesBroken();
    const [promise] = await storedPromise(receivableId);
    expect(promise.status).toBe("PARTIALLY_KEPT");
  }, 60_000);

  it("case G2: does not restyle a missed promise as kept merely because the invoice was later paid in full", async () => {
    await signInAs("case-g2");
    const { receivableId } = await seedInvoice("S5G2", rupees(10_000), dueInMonth);
    // A commitment whose date has already gone by, with nothing paid toward it.
    await promiseFor(receivableId, rupees(5_000), yesterday, "Email", "Deadline already past when recorded.");
    await paymentFor(receivableId, rupees(10_000), today, "UPI", "");
    const [promise] = await storedPromise(receivableId);
    const receivable = await storedReceivable(receivableId);
    expect(receivable!.status).toBe("PAID");
    expect(promise.status, "money that arrived after the promised date did not keep that promise").toBe("BROKEN");
  }, 60_000);

  it("settles the whole invoice and the promise together when both are honoured in time (case F)", async () => {
    await signInAs("case-f");
    const { receivableId } = await seedInvoice("S5F", rupees(10_000), dueInMonth);
    await promiseFor(receivableId, rupees(10_000), inThreeDays, "Meeting", "Full invoice promised.");
    await paymentFor(receivableId, rupees(10_000), today, "UPI", "");
    const [promise] = await storedPromise(receivableId);
    expect(promise.status).toBe("KEPT");
    expect((await storedReceivable(receivableId))!.status).toBe("PAID");
  }, 60_000);

  it("breaks an unfunded promise once its business date has passed (case D)", async () => {
    await signInAs("case-d");
    const { receivableId } = await seedInvoice("S5D", rupees(10_000), dueInMonth);
    await promiseFor(receivableId, rupees(5_000), yesterday, "Other", "Nothing was ever paid.");
    await promises.markDuePromisesBroken();
    const [promise] = await storedPromise(receivableId);
    expect(promise.status).toBe("BROKEN");
  }, 60_000);

  it("keeps a broken promise broken when the invoice is settled late (case G1)", async () => {
    await signInAs("case-g1");
    const { receivableId } = await seedInvoice("S5G1", rupees(10_000), dueInMonth);
    await promiseFor(receivableId, rupees(5_000), yesterday, "WhatsApp", "Broken first, paid later.");
    await promises.markDuePromisesBroken();
    expect((await storedPromise(receivableId))[0].status).toBe("BROKEN");
    await paymentFor(receivableId, rupees(10_000), today, "UPI", "");
    const [promise] = await storedPromise(receivableId);
    expect(promise.status).toBe("BROKEN");
    expect((await storedReceivable(receivableId))!.status).toBe("PAID");
  }, 60_000);
});

describeLocalStack("Stage 5 corrections: the record gets better, the history never disappears", () => {
  const today = todayInIndia();
  const inThreeDays = addIndiaBusinessDays(today, 3);
  const yesterday = addIndiaBusinessDays(today, -1);
  const dueInMonth = addIndiaBusinessDays(today, 30);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 correction fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("turns a BROKEN promise into KEPT on backdated evidence while keeping the original event (phase 7)", async () => {
    await signInAs("correct-kept");
    const { receivableId } = await seedInvoice("S5K1", rupees(10_000), dueInMonth);
    const created = await promiseFor(receivableId, rupees(5_000), yesterday, "WhatsApp", "Deadline passed with nothing received.");
    await promises.markDuePromisesBroken();
    expect((await storedPromise(receivableId))[0].status).toBe("BROKEN");
    const beforeCorrection = await promiseEvents(created.id);
    expect(beforeCorrection.some((event) => event.to_status === "BROKEN"), "the missed deadline must have been recorded").toBe(true);

    // The customer's UPI receipt surfaces the next morning, dated the day it
    // actually arrived. That is new information, not a rewrite.
    await paymentFor(receivableId, rupees(5_000), yesterday, "UPI", "UTI-LATE-EVIDENCE");

    const [promise] = await storedPromise(receivableId);
    expect(promise.status, "money dated on or before the promised day does honour the promise").toBe("KEPT");
    const after = await promiseEvents(created.id);
    expect(after.some((event) => event.to_status === "BROKEN"), "the original BROKEN event must survive the correction").toBe(true);
    expect(after.some((event) => event.from_status === "BROKEN" && event.to_status === "KEPT"), "the correction must be its own event").toBe(true);
    expect(after.length, "one event for the promise, one for the miss, one for the correction").toBe(3);
    const kinds = await historyKinds(receivableId);
    expect(kinds.filter((kind) => kind === "PROMISE_CORRECTED")).toHaveLength(1);
    expect((await storedReceivable(receivableId))!.status, "the invoice is still only half paid").toBe("PARTIALLY_PAID");
  }, 60_000);

  it("partially keeps a BROKEN promise when late evidence covers only part of it (phase 7)", async () => {
    await signInAs("correct-partial");
    const { receivableId } = await seedInvoice("S5K2", rupees(10_000), dueInMonth);
    const created = await promiseFor(receivableId, rupees(5_000), yesterday, "Call", "Only part arrived, and late.");
    await promises.markDuePromisesBroken();
    await paymentFor(receivableId, rupees(2_000), yesterday, "Cash", "");
    const [promise] = await storedPromise(receivableId);
    expect(promise.status).toBe("PARTIALLY_KEPT");
    const events = await promiseEvents(created.id);
    expect(events.some((event) => event.from_status === "BROKEN" && event.to_status === "PARTIALLY_KEPT")).toBe(true);
    expect(events.some((event) => event.to_status === "KEPT"), "₹2,000 of a ₹5,000 promise is not a kept promise").toBe(false);
  }, 60_000);

  it("leaves a KEPT promise alone when more money arrives afterwards (phase 7)", async () => {
    await signInAs("keep-stays-kept");
    const { receivableId } = await seedInvoice("S5K3", rupees(10_000), dueInMonth);
    const created = await promiseFor(receivableId, rupees(5_000), inThreeDays, "Meeting", "Honoured early, then overpaid.");
    await paymentFor(receivableId, rupees(5_000), today, "UPI", "");
    expect((await storedPromise(receivableId))[0].status).toBe("KEPT");
    await paymentFor(receivableId, rupees(3_000), today, "UPI", "");
    const [promise] = await storedPromise(receivableId);
    expect(promise.status, "a kept promise never becomes less than it was recorded").toBe("KEPT");
    const events = await promiseEvents(created.id);
    expect(events.some((event) => event.to_status === "PARTIALLY_KEPT" || event.to_status === "BROKEN")).toBe(false);
  }, 60_000);

  it("refuses to un-resolve a promise that has reached CANCELLED or RENEGOTIATED (phase 7)", async () => {
    await signInAs("final-states");
    const { receivableId } = await seedInvoice("S5K4", rupees(10_000), dueInMonth);
    const created = await promiseFor(receivableId, rupees(4_000), inThreeDays, "Other", "Withdrawn, then money arrived.");
    await promises.cancel(created.id, "Customer withdrew the commitment.");
    expect((await storedPromise(receivableId))[0].status).toBe("CANCELLED");
    const paid = await paymentRpc(receivableId, rupees(4_000), today, "UPI", "", crypto.randomUUID());
    expect(paid.data, "the payment itself is a legitimate act").toBeTruthy();
    const [after] = await storedPromise(receivableId);
    expect(after.status, "money does not resurrect a withdrawn promise").toBe("CANCELLED");
  }, 60_000);
});

describeLocalStack("Stage 5 keeps exactly one business calendar", () => {
  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 calendar fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("answers with the same date the client calendar shows (phase 9)", () => {
    expect(localAdmin("select to_char(public.current_business_date(), 'YYYY-MM-DD');"), "the database's today and the browser's today must be one value").toBe(todayInIndia());
  });

  it("keeps the internal calendar helper out of the browser's reach (phase 9)", async () => {
    await signInAs("calendar-hidden");
    const denied = await rpcRaw("current_business_date", {});
    expect(denied.data, "the lifecycle must not expose a date the client can aim at").toBeNull();
    expect(denied.message).toMatch(/does not exist|permission denied|not found|could not find/i);
  });

  it("refuses a customer-edited timezone, currency or plan, and keeps the ledger date honest (phase 9)", async () => {
    await signInAs("calendar-pinned");
    const owner = await currentOwnerId();
    const { receivableId } = await seedInvoice("S5TZ", rupees(10_000), addIndiaBusinessDays(todayInIndia(), 30));
    const movedDay = await supabase.from("profiles").update({ timezone: "America/New_York" } as never).eq("id", owner);
    expect(movedDay.error?.message ?? "", "moving the working day must not be a preference").toContain("one business calendar");
    const movedCurrency = await supabase.from("profiles").update({ currency: "USD" } as never).eq("id", owner);
    expect(movedCurrency.error?.message ?? "").toContain("INR");

    const { data: profile } = await supabase.from("profiles").select("timezone, currency").eq("id", owner).single();
    expect(profile?.timezone).toBe("Asia/Kolkata");
    expect(profile?.currency).toBe("INR");

    // The promise the same calendar decides: an in-date commitment stays open
    // even when the browser's clock is on the other side of midnight.
    await promiseFor(receivableId, rupees(5_000), todayInIndia(), "WhatsApp", "Promised for today itself.");
    await promises.markDuePromisesBroken();
    expect((await storedPromise(receivableId))[0].status, "today is not yet past").toBe("ACTIVE");
  }, 60_000);
});

describeLocalStack("Stage 5 payment validation is the database's job, not the form's", () => {
  const today = todayInIndia();
  const tomorrow = addIndiaBusinessDays(today, 1);
  const dueInMonth = addIndiaBusinessDays(today, 30);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 payment-matrix fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("refuses every invalid payment payload and writes nothing (phase 10)", async () => {
    await signInAs("payment-matrix");
    const { receivableId } = await seedInvoice("S5P10", rupees(10_000), dueInMonth);
    const id = () => crypto.randomUUID();
    const cases: Array<{ label: string; input: Record<string, unknown>; want: string; wantCode?: string }> = [
      { label: "zero amount", input: { receivableId, amountPaise: 0, paidOn: today, method: "UPI", reference: "", request: id() }, want: "Enter a payment amount greater than zero" },
      { label: "negative amount", input: { receivableId, amountPaise: -5_000, paidOn: today, method: "UPI", reference: "", request: id() }, want: "Enter a payment amount greater than zero" },
      { label: "no amount", input: { receivableId, amountPaise: null, paidOn: today, method: "UPI", reference: "", request: id() }, want: "Enter a payment amount greater than zero" },
      { label: "amount beyond the ledger ceiling", input: { receivableId, amountPaise: 900_000_000_000_001, paidOn: today, method: "UPI", reference: "", request: id() }, want: "That amount is larger than DueWeave can record" },
      { label: "unknown payment channel", input: { receivableId, amountPaise: rupees(100), paidOn: today, method: "CARD", reference: "", request: id() }, want: "Choose how the money arrived" },
      { label: "no channel at all", input: { receivableId, amountPaise: rupees(100), paidOn: today, method: "", reference: "", request: id() }, want: "Choose how the money arrived" },
      { label: "payment dated in the future", input: { receivableId, amountPaise: rupees(100), paidOn: tomorrow, method: "UPI", reference: "", request: id() }, want: "A payment cannot be dated in the future" },
      { label: "no payment date", input: { receivableId, amountPaise: rupees(100), paidOn: null, method: "UPI", reference: "", request: id() }, want: "Choose the date the money arrived" },
      { label: "more than the remaining balance", input: { receivableId, amountPaise: rupees(10_001), paidOn: today, method: "UPI", reference: "", request: id() }, want: "Payment must be within the remaining balance" },
      { label: "reference over 160 characters", input: { receivableId, amountPaise: rupees(100), paidOn: today, method: "UPI", reference: "x".repeat(161), request: id() }, want: "Reference can be up to 160 characters" },
      { label: "note over 2,000 characters", input: { receivableId, amountPaise: rupees(100), paidOn: today, method: "UPI", reference: "", note: "n".repeat(2001), request: id() }, want: "Notes can be up to 2,000 characters" },
      { label: "a receivable that is not this account's", input: { receivableId: "00000000-0000-4000-8000-000000000000", amountPaise: rupees(100), paidOn: today, method: "UPI", reference: "", request: id() }, want: "Receivable is not available for this account" },
    ];

    for (const testCase of cases) {
      const refused = await paymentRpc(testCase.input.receivableId as string, testCase.input.amountPaise as number | null, testCase.input.paidOn as string | null, testCase.input.method as string, testCase.input.reference as string, testCase.input.request as string, (testCase.input.note as string | undefined) ?? "");
      expect(refused.message, `${testCase.label} — input ${JSON.stringify({ ...testCase.input, note: undefined })} was not refused as expected`).toContain(testCase.want);
      expect(refused.data, `${testCase.label} must write no payment`).toBeNull();
    }

    const missingId = await paymentRpc(receivableId, rupees(100), today, "UPI", "", null);
    expect(missingId.code, `a payment with no request id (receivable ${receivableId}) must be refused`).toBe("P0001");
    expect(missingId.message).toContain("needs a request id");

    expect(await storedPayments(receivableId), "not one rejection may have written money").toHaveLength(0);
    const stored = await storedReceivable(receivableId);
    expect(stored!.outstandingPaise).toBe(rupees(10_000));
    expect(stored!.status).toBe("OPEN");
    expect(Number(localAdmin(balanceVsHistorySql(receivableId)))).toBe(0);
  }, 90_000);

  it("keeps money in whole paise and records the smallest possible amount (phase 10)", async () => {
    await signInAs("paise-granule");
    const { receivableId } = await seedInvoice("S5P11", rupees(10_000), dueInMonth);
    const onePaise = await paymentRpc(receivableId, 1, today, "CASH", "", crypto.randomUUID());
    expect(onePaise.data, "₹0.01 is a real receipt and the ledger must be able to hold it").toBeTruthy();
    expect((await storedReceivable(receivableId))!.outstandingPaise).toBe(999_999);
    const fractional = await paymentRpc(receivableId, 1.5, today, "CASH", "", crypto.randomUUID());
    expect(fractional.data, "there is no half-paise in this ledger").toBeNull();
    expect(fractional.message.length, "a fractional amount must be refused outright").toBeGreaterThan(0);
    expect((await storedPayments(receivableId)).length).toBe(1);
  }, 60_000);

  it("settles an invoice exactly and then refuses further money (phase 10, phase 12)", async () => {
    await signInAs("exact-settle");
    const { receivableId } = await seedInvoice("S5P12", rupees(10_000), dueInMonth);
    await paymentFor(receivableId, rupees(4_000), today, "UPI", "");
    expect((await storedReceivable(receivableId))!.status).toBe("PARTIALLY_PAID");
    await paymentFor(receivableId, rupees(6_000), today, "Bank transfer", "");
    const settled = await storedReceivable(receivableId);
    expect(settled!.status).toBe("PAID");
    expect(settled!.outstandingPaise).toBe(0);
    const extra = await paymentRpc(receivableId, rupees(100), today, "UPI", "", crypto.randomUUID());
    expect(extra.message).toContain("This receivable is already settled");
  }, 60_000);
});

describeLocalStack("Stage 5 keeps the balance owned by the database and derived from history", () => {
  const today = todayInIndia();
  const dueInMonth = addIndiaBusinessDays(today, 30);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 balance fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("refuses a browser that tries to write the balance or the status itself (phase 11)", async () => {
    await signInAs("forged-balance");
    const { receivableId } = await seedInvoice("S5B1", rupees(10_000), dueInMonth);
    await paymentFor(receivableId, rupees(4_000), today, "UPI", "");
    // The first wall the browser meets is table privileges (Stage 3 took UPDATE
    // away from authenticated entirely); the financial-field guard behind it is
    // proven at the database layer in supabase/tests/stage5_01_lifecycle.sql,
    // because a SECURITY DEFINER body is the only thing that reaches it.
    const forged = await supabase.from("receivables").update({ outstanding_paise: 0, status: "PAID" } as never).eq("id", receivableId);
    expect(forged.error?.message ?? "", "the amount owed is not a customer-editable field").toMatch(/permission denied|protected workflow/);
    const stored = await storedReceivable(receivableId);
    expect(stored!.status).toBe("PARTIALLY_PAID");
    expect(stored!.outstandingPaise).toBe(rupees(6_000));

    const relabelled = await supabase.from("receivables").update({ notes: "rewritten by the browser" } as never).eq("id", receivableId);
    expect(relabelled.error?.message ?? "", "and no other column is writable either").toMatch(/permission denied/);
    expect((await storedReceivable(receivableId))!.notes ?? "", "nothing moved").not.toBe("rewritten by the browser");
  }, 60_000);

  it("keeps money out of the tables the browser has no business writing (phase 11)", async () => {
    await signInAs("history-immutable");
    const { receivableId } = await seedInvoice("S5B2", rupees(10_000), dueInMonth);
    const owner = await currentOwnerId();
    const recorded = await payments.record({ receivableId, amountPaise: rupees(2_000), paidOn: today, method: "UPI", reference: "UTR-KEEP", requestId: crypto.randomUUID() });

    const sneaked = await supabase.from("payments").insert({ owner_id: owner, receivable_id: receivableId, amount_paise: rupees(8_000), paid_on: today, method: "CASH" } as never);
    expect(sneaked.error?.message ?? "", "money may only arrive through record_payment").toMatch(/permission denied|row-level security|policy/i);

    const rewritten = await supabase.from("payments").update({ amount_paise: rupees(9_999) } as never).eq("id", recorded.id);
    expect(rewritten.error?.message ?? "").toMatch(/permission denied/);

    const deleted = await supabase.from("payments").delete().eq("id", recorded.id);
    expect(deleted.error?.message ?? "").toMatch(/permission denied/);

    expect((await storedPayments(receivableId)).map((payment) => payment.amountPaise), "the receipt the browser tried to change is exactly as it was recorded").toEqual([rupees(2_000)]);
    expect((await storedReceivable(receivableId))!.outstandingPaise).toBe(rupees(8_000));
  }, 60_000);

  it("derives the outstanding amount from the whole history, not from a nudge (phase 11)", async () => {
    await signInAs("derived-balance");
    const { receivableId } = await seedInvoice("S5B3", rupees(10_000), dueInMonth);
    await paymentFor(receivableId, rupees(1_500), today, "UPI", "");
    await paymentFor(receivableId, rupees(2_250), today, "Cash", "");
    await paymentFor(receivableId, rupees(3_750), addIndiaBusinessDays(today, -2), "Bank transfer", "");
    const stored = await storedReceivable(receivableId);
    expect(stored!.outstandingPaise, "10,000 - (1,500 + 2,250 + 3,750)").toBe(rupees(2_500));
    expect(Number(localAdmin(balanceVsHistorySql(receivableId))), "the stored balance must equal the stored history to the paise").toBe(0);
    expect(await historyKinds(receivableId)).toEqual(expect.arrayContaining(["PAYMENT_RECORDED"]));
  }, 60_000);
});

describeLocalStack("Stage 5 cancellation and renegotiation stay inside what is true", () => {
  const today = todayInIndia();
  const inThreeDays = addIndiaBusinessDays(today, 3);
  const inFiveDays = addIndiaBusinessDays(today, 5);
  const yesterday = addIndiaBusinessDays(today, -1);
  const dueInMonth = addIndiaBusinessDays(today, 30);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 cancellation fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("closes an untouched receivable with a reason and records it, without deleting anything (phase 13)", async () => {
    await signInAs("close-clean");
    const { receivableId } = await seedInvoice("S5C1", rupees(10_000), dueInMonth);
    const created = await promiseFor(receivableId, rupees(5_000), inThreeDays, "WhatsApp", "Invoice turned out to be a duplicate booking.");
    const closed = await rpcRaw("cancel_receivable", { p_receivable_id: receivableId, p_reason: "Issued against the wrong quotation." });
    expect(closed.data, "closing an unpaid invoice is a legitimate act").toBeTruthy();
    const stored = await storedReceivable(receivableId);
    expect(stored!.status).toBe("CANCELLED");
    expect(stored!.outstandingPaise, "nothing is owed any more").toBe(0);
    expect(stored!.amountDuePaise, "the original amount stays on the record — cancelling is not deleting").toBe(rupees(10_000));
    expect((await storedPromise(receivableId))[0].status, "the open commitment goes with it").toBe("CANCELLED");
    const events = await promiseEvents(created.id);
    expect(events.some((event) => event.from_status === "ACTIVE" && event.to_status === "CANCELLED" && event.actor_type === "USER")).toBe(true);
    expect(await historyKinds(receivableId)).toEqual(expect.arrayContaining(["RECEIVABLE_CANCELLED", "PROMISE_CANCELLED"]));
  }, 60_000);

  it("refuses to close a receivable that has money against it, and refuses to close a paid one (phase 13)", async () => {
    await signInAs("close-money");
    const { receivableId } = await seedInvoice("S5C2", rupees(10_000), dueInMonth);
    await paymentFor(receivableId, rupees(1_000), today, "UPI", "");
    const partial = await rpcRaw("cancel_receivable", { p_receivable_id: receivableId, p_reason: "There is money here." });
    expect(partial.message).toContain("A receivable with recorded payments cannot be cancelled");
    expect((await storedReceivable(receivableId))!.status).toBe("PARTIALLY_PAID");

    await paymentFor(receivableId, rupees(9_000), today, "Cash", "");
    const paid = await rpcRaw("cancel_receivable", { p_receivable_id: receivableId, p_reason: "It is settled." });
    expect(paid.message).toContain("A settled receivable cannot be cancelled");
    expect((await storedReceivable(receivableId))!.status).toBe("PAID");

    const noReason = await rpcRaw("cancel_receivable", { p_receivable_id: receivableId, p_reason: "   " });
    expect(noReason.message).toContain("Add a short reason");
  }, 60_000);

  it("shuts the lifecycle on a closed receivable rather than reopening it (phase 13)", async () => {
    await signInAs("close-then-write");
    const { receivableId } = await seedInvoice("S5C3", rupees(10_000), dueInMonth);
    await rpcRaw("cancel_receivable", { p_receivable_id: receivableId, p_reason: "Withdrawn before work began." });
    const latePayment = await paymentRpc(receivableId, rupees(500), today, "UPI", "", crypto.randomUUID());
    expect(latePayment.message).toContain("A cancelled receivable does not accept payments");
    const latePromise = await promiseRpc(receivableId, rupees(500), inThreeDays, "CALL", "", crypto.randomUUID());
    expect(latePromise.message).toContain("A promise cannot be added to a closed receivable");
    const twice = await rpcRaw("cancel_receivable", { p_receivable_id: receivableId, p_reason: "Closed again." });
    expect(twice.message).toContain("This receivable is already cancelled");
    expect(await storedPayments(receivableId)).toHaveLength(0);
  }, 60_000);

  it("withdraws only a promise that has no outcome, and never deletes it (phase 14)", async () => {
    await signInAs("withdraw-promise");
    const { receivableId } = await seedInvoice("S5C4", rupees(10_000), dueInMonth);
    const active = await promiseFor(receivableId, rupees(3_000), inThreeDays, "Call", "Withdrawn on the phone.");
    const withdrawn = await rpcRaw("cancel_promise", { p_promise_id: active.id, p_reason: "Customer rang it off." });
    expect(withdrawn.data).toBeTruthy();
    const stillThere = await storedPromise(receivableId);
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].status).toBe("CANCELLED");
    expect(stillThere[0].resolvedAt, "the withdrawal is dated like every other outcome").toBeTruthy();
    const events = await promiseEvents(active.id);
    expect(events.some((event) => event.to_status === "ACTIVE"), "the original commitment stays in the trail").toBe(true);
    expect(events.some((event) => event.from_status === "ACTIVE" && event.to_status === "CANCELLED" && event.actor_type === "USER")).toBe(true);

    const twice = await rpcRaw("cancel_promise", { p_promise_id: active.id, p_reason: "Withdrawn again." });
    expect(twice.message).toContain("This promise is already cancelled");
    const noReason = await rpcRaw("cancel_promise", { p_promise_id: active.id, p_reason: "" });
    expect(noReason.message).toContain("Add a short reason");
  }, 60_000);

  it("refuses to withdraw a promise that already reached an outcome (phase 14)", async () => {
    await signInAs("withdraw-resolved");
    const { receivableId } = await seedInvoice("S5C5", rupees(10_000), dueInMonth);
    const kept = await promiseFor(receivableId, rupees(2_000), inThreeDays, "Meeting", "Paid in full, then 'withdrawn'.");
    await paymentFor(receivableId, rupees(2_000), today, "UPI", "");
    expect((await storedPromise(receivableId))[0].status).toBe("KEPT");
    const afterKept = await rpcRaw("cancel_promise", { p_promise_id: kept.id, p_reason: "Pretend it never happened." });
    expect(afterKept.message).toContain("Only a promise that has not reached its outcome can be withdrawn");

    const missed = await promiseFor(receivableId, rupees(3_000), yesterday, "Email", "Missed, then 'withdrawn'.");
    await promises.markDuePromisesBroken();
    expect((await storedPromise(receivableId)).find((row) => row.id === missed.id)!.status).toBe("BROKEN");
    const afterBroken = await rpcRaw("cancel_promise", { p_promise_id: missed.id, p_reason: "Not happening after all." });
    expect(afterBroken.message).toContain("Only a promise that has not reached its outcome can be withdrawn");

    const rows = await storedPromise(receivableId);
    expect(rows.map((row) => row.status)).toEqual(["KEPT", "BROKEN"]);
    expect((await storedPayments(receivableId)).length, "a refused withdrawal must not disturb the money either").toBe(1);
  }, 60_000);

  it("marks a superseded-but-still-open promise RENEGOTIATED, and nothing else (phase 15)", async () => {
    await signInAs("renegotiate-honest");
    const { receivableId } = await seedInvoice("S5C6", rupees(10_000), dueInMonth);
    const first = await promiseFor(receivableId, rupees(4_000), inThreeDays, "WhatsApp", "Date moved before it arrived.");
    await promiseFor(receivableId, rupees(5_000), inFiveDays, "Call", "A new date instead.");
    const rows = await storedPromise(receivableId);
    expect(rows).toHaveLength(2);
    expect(rows[0].status, "the earlier promise was still open when it was replaced").toBe("RENEGOTIATED");
    expect(rows[1].status).toBe("ACTIVE");
    const events = await promiseEvents(first.id);
    const replaced = events.find((event) => event.to_status === "RENEGOTIATED");
    expect(replaced?.reason).toBe("Replaced by a new promise before its date arrived");
    expect(replaced?.actor_type, "a renegotiation is a human act, not a system verdict").toBe("USER");
  }, 60_000);

  it("grades an overdue promise BROKEN instead of laundering it into RENEGOTIATED (phase 15)", async () => {
    await signInAs("renegotiate-launder");
    const { receivableId } = await seedInvoice("S5C7", rupees(10_000), dueInMonth);
    const late = await promiseFor(receivableId, rupees(4_000), yesterday, "WhatsApp", "Deadline already gone by.");
    await promiseFor(receivableId, rupees(5_000), inFiveDays, "Call", "A fresh date typed afterwards.");
    const rows = await storedPromise(receivableId);
    expect(rows[0].status, "the day had passed with nothing received: that is a broken promise, whatever was typed later").toBe("BROKEN");
    expect(rows[1].status).toBe("ACTIVE");
    const events = await promiseEvents(late.id);
    expect(events.some((event) => event.to_status === "RENEGOTIATED"), "no renegotiation may be recorded over a missed deadline").toBe(false);
    expect(events.some((event) => event.from_status === "ACTIVE" && event.to_status === "BROKEN")).toBe(true);
  }, 60_000);

  it("grades a part-funded overdue promise PARTIALLY_KEPT rather than RENEGOTIATED (phase 15)", async () => {
    await signInAs("renegotiate-partial");
    const { receivableId } = await seedInvoice("S5C8", rupees(10_000), dueInMonth);
    const partial = await promiseFor(receivableId, rupees(4_000), yesterday, "Call", "₹1,000 of ₹4,000 by the date.");
    await paymentFor(receivableId, rupees(1_000), yesterday, "UPI", "");
    await promiseFor(receivableId, rupees(5_000), inFiveDays, "Meeting", "New date after the old one passed.");
    const rows = await storedPromise(receivableId);
    expect(rows[0].status).toBe("PARTIALLY_KEPT");
    const events = await promiseEvents(partial.id);
    expect(events.some((event) => event.to_status === "RENEGOTIATED")).toBe(false);
  }, 60_000);
});

describeLocalStack("Stage 5 replays a retried money write instead of writing it twice", () => {
  const today = todayInIndia();
  const yesterday = addIndiaBusinessDays(today, -1);
  const inThreeDays = addIndiaBusinessDays(today, 3);
  const dueInMonth = addIndiaBusinessDays(today, 30);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 idempotency fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("returns the original payment for a retry and refuses that id for a different one (phase 16)", async () => {
    await signInAs("replay-payment");
    const { receivableId } = await seedInvoice("S5I1", rupees(10_000), dueInMonth);
    const requestId = crypto.randomUUID();
    const first = await paymentRpc(receivableId, rupees(2_500), today, "UPI", "UTR-REPLAY", requestId);
    expect(first.data).toBeTruthy();
    const retry = await paymentRpc(receivableId, rupees(2_500), today, "UPI", "UTR-REPLAY", requestId);
    expect(retry.data, "a retry must hand back the recorded payment").toBeTruthy();
    expect((retry.data as { id: string }).id, "the retry returns the same row, not a second one").toBe((first.data as { id: string }).id);
    expect(await storedPayments(receivableId), "two submissions of one act are one payment").toHaveLength(1);
    expect((await storedReceivable(receivableId))!.outstandingPaise).toBe(rupees(7_500));
    expect((await historyKinds(receivableId)).filter((kind) => kind === "PAYMENT_RECORDED")).toHaveLength(1);

    const hijack = await paymentRpc(receivableId, rupees(9_000), today, "UPI", "UTR-REPLAY", requestId);
    expect(hijack.code, `a different payload on a used request id (payment ${rupees(9_000)}) must be refused`).toBe("40901");
    expect(hijack.message).toContain("That request id already recorded a different payment");
    expect(hijack.data).toBeNull();
    expect((await storedPayments(receivableId))).toHaveLength(1);

    const fresh = await paymentRpc(receivableId, rupees(1_500), today, "Cash", "", crypto.randomUUID());
    expect(fresh.data, "a genuinely new submission must still be accepted").toBeTruthy();
    expect(await storedPayments(receivableId)).toHaveLength(2);
  }, 90_000);

  it("returns the original promise for a retry and refuses that id for a different one (phase 16)", async () => {
    await signInAs("replay-promise");
    const { receivableId } = await seedInvoice("S5I2", rupees(10_000), dueInMonth);
    const requestId = crypto.randomUUID();
    const first = await promiseRpc(receivableId, rupees(3_000), inThreeDays, "WHATSAPP", "By Wednesday.", requestId);
    expect(first.data).toBeTruthy();
    const retry = await promiseRpc(receivableId, rupees(3_000), inThreeDays, "WHATSAPP", "By Wednesday.", requestId);
    expect((retry.data as { id: string }).id).toBe((first.data as { id: string }).id);
    const rows = await storedPromise(receivableId);
    expect(rows, "one commitment, not two").toHaveLength(1);
    expect(await historyKinds(receivableId)).toEqual(expect.arrayContaining(["PROMISE_CREATED"]));

    const changed = await promiseRpc(receivableId, rupees(3_000), inThreeDays, "CALL", "By Wednesday.", requestId);
    expect(changed.code).toBe("40901");
    expect(changed.message).toContain("That request id already recorded a different promise");
    expect(await storedPromise(receivableId)).toHaveLength(1);

    // The origin date is part of the payload a replay is compared against: a
    // retry that quietly moves when the promise was made would move the window
    // every payment is judged by, so it is a different act and is refused.
    const movedOrigin = await promiseRpc(receivableId, rupees(3_000), inThreeDays, "WHATSAPP", "By Wednesday.", requestId, yesterday);
    expect(movedOrigin.code, "a retry cannot re-date when the promise was made").toBe("40901");
    expect(movedOrigin.message).toContain("That request id already recorded a different promise");
    const stillOne = await storedPromise(receivableId);
    expect(stillOne).toHaveLength(1);
    expect((stillOne[0] as { madeOn: string }).madeOn, "and the stored origin must be the one first recorded").toBe(today);
  }, 90_000);

  it("carries the idempotency through the repository the browser actually uses (phase 16)", async () => {
    await signInAs("replay-through-repo");
    const { receivableId } = await seedInvoice("S5I3", rupees(10_000), dueInMonth);
    const requestId = crypto.randomUUID();
    const input = { receivableId, amountPaise: rupees(2_000), paidOn: today, method: "UPI" as const, reference: "", requestId };
    const first = await new SupabasePaymentRepository().record(input);
    const retry = await new SupabasePaymentRepository().record(input);
    expect(retry.id, "the double-click path the SPA takes must replay too").toBe(first.id);
    expect(await storedPayments(receivableId)).toHaveLength(1);
    const promiseId = crypto.randomUUID();
    const promiseInput = { receivableId, amountPaise: rupees(1_000), madeOn: today, promisedDate: inThreeDays, source: "Call" as const, note: "", requestId: promiseId };
    const promiseFirst = await new SupabasePromiseRepository().create(promiseInput);
    const promiseRetry = await new SupabasePromiseRepository().create(promiseInput);
    expect(promiseRetry.id).toBe(promiseFirst.id);
    expect(await storedPromise(receivableId)).toHaveLength(1);
  }, 90_000);
});

describeLocalStack("Stage 5 holds under two money writes at the same time", () => {
  const today = todayInIndia();
  const inThreeDays = addIndiaBusinessDays(today, 3);
  const dueInMonth = addIndiaBusinessDays(today, 30);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 concurrency fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("over-subscribes an invoice with two parallel payments and ends exactly right either way (phases 17-19)", async () => {
    await signInAs("race-payment");
    const { receivableId } = await seedInvoice("S5R1", rupees(10_000), dueInMonth);
    const token = await accessTokenOfCurrentUser();
    const clientA = clientWithSession(token);
    const clientB = clientWithSession(token);
    const call = (client: ReturnType<typeof clientWithSession>, amountPaise: number) =>
      client.rpc("record_payment" as never, {
        p_receivable_id: receivableId,
        p_amount_paise: amountPaise,
        p_paid_on: today,
        p_method: "UPI",
        p_reference: "",
        p_request_id: crypto.randomUUID(),
        p_note: "",
      } as never);

    const [a, b] = await Promise.all([call(clientA, rupees(8_000)), call(clientB, rupees(5_000))]);
    const accepted = [a, b].filter((result) => result.data && !result.error);
    const refused = [a, b].filter((result) => result.error);
    for (const result of refused) {
      expect(String((result.error as { message?: string }).message), "a lost race must be a clean refusal, never a deadlock").not.toMatch(/deadlock/i);
    }
    expect(accepted, "exactly one payment may land on a ₹10,000 invoice carrying ₹13,000 of demands").toHaveLength(1);
    expect(refused).toHaveLength(1);

    const stored = await storedReceivable(receivableId);
    const winner = (accepted[0].data as { amount_paise: number | string }).amount_paise;
    expect(Number(winner) + Number(stored!.outstandingPaise), "money in plus money owed must be the invoice").toBe(rupees(10_000));
    expect(await storedPayments(receivableId)).toHaveLength(1);
    expect(Number(localAdmin(balanceVsHistorySql(receivableId)))).toBe(0);
    expect(stored!.status).toBe("PARTIALLY_PAID");
  }, 120_000);

  it("accepts two parallel payments that both fit and settles the promise once (phases 17-19)", async () => {
    await signInAs("race-payment-both-fit");
    const { receivableId } = await seedInvoice("S5R2", rupees(10_000), dueInMonth);
    await promiseFor(receivableId, rupees(5_000), inThreeDays, "Call", "Two halves promised together.");
    const token = await accessTokenOfCurrentUser();
    const clientA = clientWithSession(token);
    const clientB = clientWithSession(token);
    const call = (client: ReturnType<typeof clientWithSession>, amountPaise: number) =>
      client.rpc("record_payment" as never, {
        p_receivable_id: receivableId,
        p_amount_paise: amountPaise,
        p_paid_on: today,
        p_method: "UPI",
        p_reference: "",
        p_request_id: crypto.randomUUID(),
        p_note: "",
      } as never);
    const results = await Promise.all([call(clientA, rupees(3_000)), call(clientB, rupees(2_000)), call(clientA, rupees(1_000))]);
    const errors = results.filter((result) => result.error);
    expect(errors.map((result) => String((result.error as { message?: string }).message))).toEqual([]);
    const stored = await storedReceivable(receivableId);
    expect(stored!.outstandingPaise).toBe(rupees(4_000));
    expect(await storedPayments(receivableId)).toHaveLength(3);
    const [promise] = await storedPromise(receivableId);
    expect(promise.status, "₹3,000 + ₹2,000 both dated in time honour the ₹5,000 promise exactly once").toBe("KEPT");
    const events = await promiseEvents(promise.id);
    expect(events.filter((event) => event.to_status === "KEPT")).toHaveLength(1);
    expect(Number(localAdmin(balanceVsHistorySql(receivableId)))).toBe(0);
  }, 120_000);

  it("replays one request id submitted twice at the same time into a single payment (phases 17-19)", async () => {
    await signInAs("race-same-request");
    const { receivableId } = await seedInvoice("S5R3", rupees(10_000), dueInMonth);
    const requestId = crypto.randomUUID();
    const token = await accessTokenOfCurrentUser();
    const twin = (client: ReturnType<typeof clientWithSession>) =>
      client.rpc("record_payment" as never, {
        p_receivable_id: receivableId,
        p_amount_paise: rupees(4_000),
        p_paid_on: today,
        p_method: "UPI",
        p_reference: "UTR-TWIN",
        p_request_id: requestId,
        p_note: "",
      } as never);
    const clientA = clientWithSession(token);
    const clientB = clientWithSession(token);
    const results = await Promise.all([twin(clientA), twin(clientB), twin(clientA)]);
    const errors = results.filter((result) => result.error);
    expect(errors.map((result) => String((result.error as { message?: string }).message))).toEqual([]);
    const ids = new Set(results.map((result) => String((result.data as { id: string }).id)));
    expect(ids.size, "three submissions of one request id produced more than one row").toBe(1);
    expect(await storedPayments(receivableId)).toHaveLength(1);
    expect((await storedReceivable(receivableId))!.outstandingPaise).toBe(rupees(6_000));
  }, 120_000);

  it("keeps promise sequence numbers unique under parallel writes (phases 17-19)", async () => {
    await signInAs("race-promise");
    const { receivableId } = await seedInvoice("S5R4", rupees(10_000), dueInMonth);
    const token = await accessTokenOfCurrentUser();
    const clientA = clientWithSession(token);
    const call = (amountPaise: number) =>
      clientA.rpc("create_promise" as never, {
        p_receivable_id: receivableId,
        p_promised_amount_paise: amountPaise,
        p_made_on: today,
        p_promised_date: inThreeDays,
        p_source: "CALL",
        p_note: "",
        p_request_id: crypto.randomUUID(),
      } as never);
    const results = await Promise.all([call(rupees(2_000)), call(rupees(3_000))]);
    expect(results.filter((result) => result.error).map((result) => String((result.error as { message?: string }).message))).toEqual([]);
    const rows = await storedPromise(receivableId);
    expect(rows.map((row) => row.sequenceNo).sort()).toEqual([1, 2]);
    expect(rows.filter((row) => row.status === "ACTIVE")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "RENEGOTIATED")).toHaveLength(1);
  }, 120_000);
});

describeLocalStack("Stage 5 leaves the ledger reconcilable, and proves it", () => {
  const today = todayInIndia();
  const inThreeDays = addIndiaBusinessDays(today, 3);
  const yesterday = addIndiaBusinessDays(today, -1);
  const dueInMonth = addIndiaBusinessDays(today, 30);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 audit fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("writes one durable history row per transition across a full journey (phase 24)", async () => {
    await signInAs("journey-history");
    const { receivableId } = await seedInvoice("S5H1", rupees(10_000), dueInMonth);
    const created = await promiseFor(receivableId, rupees(5_000), yesterday, "WhatsApp", "The whole lifecycle, in one ledger.");
    await promises.markDuePromisesBroken();
    await paymentFor(receivableId, rupees(5_000), yesterday, "UPI", "");
    await paymentFor(receivableId, rupees(5_000), today, "Cash", "");

    const events = await promiseEvents(created.id);
    // Nothing in that journey was skipped and nothing was overwritten: creation,
    // the miss, and the correction that followed the backdated receipt.
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.to_status).sort()).toEqual(["ACTIVE", "BROKEN", "KEPT"]);
    const kinds = await historyKinds(receivableId);
    expect(kinds.filter((kind) => kind === "PROMISE_CREATED")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "PROMISE_STATUS_CHANGED")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "PROMISE_CORRECTED")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "PAYMENT_RECORDED")).toHaveLength(2);
    expect((await storedReceivable(receivableId))!.status).toBe("PAID");
    expect((await storedPromise(receivableId))[0].status).toBe("KEPT");
  }, 90_000);

  it("passes an executed reconciliation audit over everything this suite wrote (phase 25)", async () => {
    await signInAs("audit-owner");
    const { receivableId } = await seedInvoice("S5H2", rupees(10_000), dueInMonth);
    await promiseFor(receivableId, rupees(4_000), inThreeDays, "Call", "A ledger that must add up.");
    await paymentFor(receivableId, rupees(1_500), today, "UPI", "");
    // A cancelled invoice is the one state where the balance is not "due minus
    // paid", so an audit that never sees one proves nothing about it.
    const { receivableId: closedId } = await seedInvoice("S5H3", rupees(7_000), dueInMonth);
    await rpcRaw("cancel_receivable", { p_receivable_id: closedId, p_reason: "Quotation never became work." });
    const owner = await currentOwnerId();
    const mismatches = Number(localAdmin(ledgerAuditSql(owner)));
    expect(mismatches, "every stored balance must equal its own history and every status its balance").toBe(0);
    // The audit is only worth running if it can fail. These are the same
    // contradictory pairs the pgTAP file plants, judged by the same expression —
    // no ledger row is written to prove the detector bites.
    const detector = (rows: string) => localAdmin(`select count(*) from (values ${rows}) v(amount_due, outstanding, paid, status)
      where v.outstanding < 0
         or (v.status <> 'CANCELLED' and v.outstanding <> v.amount_due - v.paid)
         or (v.status = 'CANCELLED' and (v.outstanding <> 0 or v.paid <> 0))
         or (v.status = 'OPEN' and v.outstanding <> v.amount_due)
         or (v.status = 'PARTIALLY_PAID' and (v.outstanding <= 0 or v.outstanding >= v.amount_due))
         or (v.status = 'PAID' and v.outstanding <> 0);`);
    expect(detector("(100, 70, 30, 'PARTIALLY_PAID'), (100, 100, 0, 'OPEN'), (100, 0, 100, 'PAID'), (100, 0, 0, 'CANCELLED')"), "the audit must not cry wolf on a healthy ledger").toBe("0");
    expect(detector("(100, 60, 30, 'PARTIALLY_PAID'), (100, 0, 40, 'CANCELLED'), (100, 100, 100, 'PAID'), (100, 70, 30, 'OPEN'), (100, -5, 105, 'PAID'), (100, 40, 0, 'CANCELLED')"), "and must report every fault planted in it").toBe("6");
    expect(Number(localAdmin(balanceVsHistorySql(receivableId)))).toBe(0);
  }, 90_000);
});

// The settlement rule is a boundary, so the matrix walks it: the promise is the
// same ₹5,000 every time and only the shape of the money changes. Every case
// runs on one invoice under one owner, in the order written, because money
// recorded earlier is never attributable to a promise made later — that is part
// of the rule being tested, not an accident of the fixture.
describeLocalStack("Stage 5 honours a promise to the last paisa", () => {
  const today = todayInIndia();
  const inThreeDays = addIndiaBusinessDays(today, 3);
  const yesterday = addIndiaBusinessDays(today, -1);
  const twoDaysAgo = addIndiaBusinessDays(today, -2);
  const dueInMonth = addIndiaBusinessDays(today, 30);

  let receivableId = "";

  beforeAll(async () => {
    await signInAs("boundary");
    receivableId = (await seedInvoice("S5B", rupees(100_000), dueInMonth)).receivableId;
  }, 90_000);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 boundary fixtures were not fully purged: ${purge}`);
  }, 120_000);

  const cases: Array<{ label: string; promisedDate: string; money: number[]; expected: string }> = [
    { label: "a single payment for the whole promise", promisedDate: inThreeDays, money: [rupees(5_000)], expected: "KEPT" },
    { label: "two payments that add up to it", promisedDate: inThreeDays, money: [rupees(2_500), rupees(2_500)], expected: "KEPT" },
    { label: "one paisa and then the rest", promisedDate: inThreeDays, money: [1, rupees(4_999) + 99], expected: "KEPT" },
    { label: "more money than was promised", promisedDate: inThreeDays, money: [rupees(6_000)], expected: "KEPT" },
    { label: "one paisa short, once its day has gone by", promisedDate: twoDaysAgo, money: [rupees(4_999) + 99], expected: "PARTIALLY_KEPT" },
    { label: "one paisa toward it, once its day has gone by", promisedDate: yesterday, money: [1], expected: "PARTIALLY_KEPT" },
  ];

  it.each(cases)("$expected for $label", async (testCase) => {
    const promisedPaise = rupees(5_000);
    const input = `promised ₹${(promisedPaise / 100).toFixed(2)} by ${testCase.promisedDate}, received ${testCase.money.map((paise) => `${(paise / 100).toFixed(2)}p`).join(" + ")}`;
    const created = await promiseFor(receivableId, promisedPaise, testCase.promisedDate, "Call", "Settlement boundary matrix.");
    // The money arrives on the day the promise itself names, which is inside its
    // window; only the promise's date moves, which is what decides whether the
    // arrival counted as on time.
    const paidOn = testCase.promisedDate < today ? testCase.promisedDate : today;
    for (const amountPaise of testCase.money) {
      await paymentFor(receivableId, amountPaise, paidOn, "UPI", "");
    }
    // A commitment whose day has already gone by needs the same end-of-day
    // grading the app runs; one still ahead of its date settles the moment the
    // money lands.
    if (testCase.promisedDate < today) await promises.markDuePromisesBroken();
    const graded = (await storedPromise(receivableId)).find((row) => row.id === created.id)!;
    expect(graded.status, `${input} — the promise settled as ${graded.status}`).toBe(testCase.expected);
  }, 60_000);

  it("leaves the invoice itself only partly settled after all of that money", async () => {
    const invoice = await storedReceivable(receivableId);
    const paidPaise = cases.reduce((sum, testCase) => sum + testCase.money.reduce((total, amount) => total + amount, 0), 0);
    // ₹26,000 of ₹1,00,000 has been paid, so the promise verdicts above cannot
    // have come from a settled invoice — the two facts stay separate.
    expect(paidPaise).toBe(rupees(26_000));
    expect(invoice!.status).toBe("PARTIALLY_PAID");
    expect(invoice!.outstandingPaise).toBe(rupees(100_000) - paidPaise);
  });
});

// The queue, the priority reasons and the reliability score are the only place
// where Stage 5's stored facts reach the customer-facing screen. Up to here the
// database has been proven; this case proves the reading side cannot invent
// anything — it is handed rows the database wrote, with no TypeScript fixture
// describing a promise outcome, and one frozen instant so no answer depends on
// when the suite happened to run.
describeLocalStack("Stage 5 shows the customer only what the ledger actually holds", () => {
  const today = todayInIndia();
  const inThreeDays = addIndiaBusinessDays(today, 3);
  const inFiveDays = addIndiaBusinessDays(today, 5);
  const yesterday = addIndiaBusinessDays(today, -1);
  const dueInMonth = addIndiaBusinessDays(today, 30);
  const clock: BusinessClock = { now: () => new Date(`${today}T12:00:00+05:30`) };

  let ledger: LedgerState & { clientId: string };

  // One ledger walked through the same RPCs the SPA calls, holding one of every
  // outcome the reliability rule has to distinguish — read back afterwards
  // rather than assembled here, so what the selectors see is what is stored.
  beforeAll(async () => {
    await signInAs("queue-truth");
    const { clientId, receivableId } = await seedInvoice("S5T", rupees(10_000), dueInMonth);
    await promiseFor(receivableId, rupees(1_000), inThreeDays, "WhatsApp", "A small instalment, promised and paid.");
    await paymentFor(receivableId, rupees(1_000), today, "UPI", "");
    await promiseFor(receivableId, rupees(500), yesterday, "Call", "Missed outright.");
    await promiseFor(receivableId, rupees(500), yesterday, "Call", "Missed again.");
    await promiseFor(receivableId, rupees(2_000), inFiveDays, "Email", "Replaced before its day arrived.");
    const withdrawn = await promiseFor(receivableId, rupees(2_500), inFiveDays, "Meeting", "Withdrawn at the client's request.");
    await promises.cancel(withdrawn.id, "Withdrawn at the client's request.");
    await promises.markDuePromisesBroken();
    // A second, untouched invoice so the queue order is a comparison and not a
    // single-row tautology.
    await seedInvoice("S5U", rupees(20_000), dueInMonth);

    const [storedReceivables, storedPromises, storedPayments, storedActivities, allClients] = await Promise.all([
      new SupabaseReceivableRepository().list(),
      new SupabasePromiseRepository().list(),
      new SupabasePaymentRepository().list(),
      new SupabaseActivityRepository().list(),
      clients.list(),
    ]);
    ledger = { clientId, receivables: storedReceivables, promises: storedPromises, payments: storedPayments, activities: storedActivities, clients: allClients };
  }, 150_000);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 queue fixtures were not fully purged: ${purge}`);
  }, 120_000);

  const outcomeOf = (rows: PromiseRecord[]) => rows.map((row) => `${row.sequenceNo}:${row.status}`).join(" ");

  it("counts a customer's reliability only on promises they actually answered", async () => {
    const onLedger = ledger.promises.filter((row) => row.receivableId === ledger.receivables.find((item) => item.invoiceRef === "S5T")!.id);
    // The exclusions have to exist for this test to mean anything: a score that
    // silently left them out would pass with nothing to leave out.
    expect(outcomeOf(onLedger), "the ledger must hold one promise of every outcome the rule distinguishes").toBe("1:KEPT 2:BROKEN 3:BROKEN 4:RENEGOTIATED 5:CANCELLED");
    expect(getReliability(ledger.clientId, ledger), `a replaced or withdrawn promise is neither kept nor broken (stored: ${outcomeOf(onLedger)})`)
      .toEqual({ enoughHistory: true, total: 3, kept: 1, broken: 2, partial: 0, averageDelay: 0.7 });
  });

  it("gives a reason the invoice can stand behind, anchored on its real recorded instant", async () => {
    const invoice = ledger.receivables.find((row) => row.invoiceRef === "S5T")!;
    // The premise, stated in the database's own words: this row was recorded
    // today. Its stored timestamp is a raw UTC instant, so this is the conversion
    // that decides whether the ledger claims a silence that never happened.
    expect(toIndiaBusinessDate(invoice.createdAt), "the invoice really was recorded on today's business date").toBe(today);
    expect(getLastContacted(invoice.id, ledger.activities), "no message was ever sent on this invoice").toBeUndefined();
    const labels = priorityReasons(invoice, ledger, clock).map((reason) => reason.label);
    expect(labels, "every reason shown must be a fact on this row — never a counted-down silence it never had").toEqual(["2 promises broken", "Recent partial payment"]);
  });

  it("orders the queue from the ledger's facts, not the order the rows arrived in", async () => {
    const asRow = (entry: { receivable: Receivable; score: number }) => `${entry.receivable.invoiceRef}:${entry.score}`;
    const forwards = getQueue(ledger, clock).map(asRow);
    const backwards = getQueue({ ...ledger, receivables: [...ledger.receivables].reverse(), promises: [...ledger.promises].reverse(), payments: [...ledger.payments].reverse() }, clock).map(asRow);
    // Two broken promises on ₹9,000 outranks a larger untouched ₹20,000 invoice,
    // and neither answer moves when the input is shuffled.
    expect(backwards, "the same ledger must queue identically however it is handed in").toEqual(forwards);
    expect(forwards).toEqual(["S5T:24", "S5U:20"]);
    expect(getQueue(ledger, clock).map(asRow), "and the answer must not drift between runs at one instant").toEqual(forwards);
  });
});

// ---------------------------------------------------------------------------
// D-S5-16. Attribution has to follow the customer's chronology, not the order
// in which DueWeave happened to store rows. These cases are written against
// what the ledger ought to be able to say, run against the SQL exactly as it
// stands today, and the failure they record is the defect evidence.
// ---------------------------------------------------------------------------

/** What the database's own attribution helper says one promise was paid, read
 *  as administrative inspection rather than through a repository: the assertion
 *  must be about the rule, not about a client's interpretation of it. */
function settledCreditOf(promiseId: string) {
  expect(promiseId).toMatch(/^[0-9a-f-]{36}$/);
  return Number(localAdmin(`select coalesce(public.promise_settled_amount(p), 0) from public.promises p where p.id = '${promiseId}';`));
}

describeLocalStack("Stage 5 attributes money by business chronology, not by recording order (D-S5-16)", () => {
  const today = todayInIndia();
  const dueInMonth = addIndiaBusinessDays(today, 30);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 chronology fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("D-S5-16: money that arrived before the newer promise was made gives that promise no credit", async () => {
    await signInAs("chrono-cross");
    const { receivableId } = await seedInvoice("S5C1", rupees(10_000), dueInMonth);

    // Promise A names a day that has already gone by, so on its own facts it is
    // broken.
    const promiseADue = addIndiaBusinessDays(today, -10);
    const a = await promiseFor(receivableId, rupees(5_000), promiseADue, "WhatsApp", "Promised ten days ago, nothing received.");
    await promises.markDuePromisesBroken();
    expect((await storedPromise(receivableId))[0].status, "the older promise must begin broken").toBe("BROKEN");

    // Promise B is a new commitment made after it, for a day that has not come.
    const b = await promiseFor(receivableId, rupees(5_000), addIndiaBusinessDays(today, 5), "WhatsApp", "Promises the same sum again, next week.");

    // Only now does the owner enter the money that actually arrived on A's day.
    await paymentFor(receivableId, rupees(5_000), promiseADue, "UPI", "S5C1-ON-AS-DAY");

    const rows = await storedPromise(receivableId);
    const storedA = rows.find((row) => row.id === a.id)!;
    const storedB = rows.find((row) => row.id === b.id)!;

    // A may be corrected: the money is dated inside A's own promise period.
    expect(storedA.status, "evidence dated on A's promised day may correct A").toBe("KEPT");

    // B may not. That money physically existed before B was made, so B has
    // received nothing at all.
    expect(settledCreditOf(b.id), "money paid before B was made cannot be credited to B").toBe(0);
    expect(storedB.status, "a promise that has received nothing is still an open commitment").toBe("ACTIVE");
    expect(rows.filter((row) => row.status === "KEPT"), "one payment must satisfy at most one promise").toHaveLength(1);
  }, 60_000);

  it("D-S5-16: a payment dated before today's promise cannot satisfy that promise", async () => {
    await signInAs("chrono-yesterday");
    const { receivableId } = await seedInvoice("S5C2", rupees(10_000), dueInMonth);
    const b = await promiseFor(receivableId, rupees(5_000), addIndiaBusinessDays(today, 3), "WhatsApp", "Promised today, payable this week.");

    await paymentFor(receivableId, rupees(5_000), addIndiaBusinessDays(today, -1), "UPI", "S5C2-YESTERDAY");

    const [stored] = await storedPromise(receivableId);
    expect(settledCreditOf(b.id), "money dated before the promise was made is not that promise's money").toBe(0);
    expect(stored.status, "a promise nobody has paid stays open").toBe("ACTIVE");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Phases 9-15. With made_on stored, the attribution rule stops being a theory
// about boundaries and becomes something a schedule can be checked against: two
// promises in sequence, the evidence a correction has to carry, the shapes one
// window can take, and the two moments where a cancellation and a receipt reach
// the same invoice at once.
// ---------------------------------------------------------------------------

/** The provenance a correction event must carry, exactly as stored. */
type CorrectionEvidence = { reason_type: string; payment_ids: string[]; payments: Array<{ id: string; paid_on: string }> };

describeLocalStack("Stage 5 keeps two sequential promises in business order (phases 9-10)", () => {
  const today = todayInIndia();
  const dueInMonth = addIndiaBusinessDays(today, 30);
  const inFiveDays = addIndiaBusinessDays(today, 5);
  const inEightDays = addIndiaBusinessDays(today, 8);
  // Promise A: made ten business days ago, for a day six business days ago.
  const aMadeOn = addIndiaBusinessDays(today, -10);
  const aDueOn = addIndiaBusinessDays(today, -6);
  // Promise B: the same sum, promised again five business days ago for yesterday.
  const bMadeOn = addIndiaBusinessDays(today, -5);
  const bDueOn = addIndiaBusinessDays(today, -1);
  // X is A's money, on the closing day of A's window. Y is B's, mid-window.
  const xPaidOn = aDueOn;
  const yPaidOn = addIndiaBusinessDays(bMadeOn, 1);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 sequence fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("phase 9: each window answers only to the money dated inside it, in any typing order", async () => {
    await signInAs("seq-chronology");
    const { receivableId } = await seedInvoice("S5S1", rupees(20_000), dueInMonth);
    const a = await promiseFor(receivableId, rupees(5_000), aDueOn, "WhatsApp", "The first commitment, now overdue.", aMadeOn);
    await promises.markDuePromisesBroken();
    const b = await promiseFor(receivableId, rupees(5_000), bDueOn, "WhatsApp", "The same sum, promised again.", bMadeOn);

    expect(a.madeOn, "the origin the form was given is the origin the ledger stores").toBe(aMadeOn);
    expect(b.madeOn).toBe(bMadeOn);
    // The premise, stated where it can fail: these windows must not overlap and
    // each receipt must sit in exactly one of them, or the test proves nothing.
    expect(xPaidOn < bMadeOn, "X predates B entirely").toBe(true);
    expect(yPaidOn > bMadeOn && yPaidOn < bDueOn, "Y sits inside B").toBe(true);
    expect(yPaidOn > aDueOn, "Y is after A's deadline").toBe(true);

    // B's money is entered FIRST. Crediting by recording order is the defect
    // being closed, so the later-dated receipt deliberately goes in first.
    await paymentFor(receivableId, rupees(5_000), yPaidOn, "UPI", "S5S1-IN-B");
    expect(settledCreditOf(b.id), "money dated inside B's own window is B's").toBe(rupees(5_000));
    expect(settledCreditOf(a.id), "and is not also A's money").toBe(0);

    await paymentFor(receivableId, rupees(5_000), xPaidOn, "UPI", "S5S1-IN-A");
    expect(settledCreditOf(a.id), "money dated on A's promised day is A's, although it was typed after B's receipt").toBe(rupees(5_000));
    expect(settledCreditOf(b.id), "and A's receipt does not move into B's window because it was entered later").toBe(rupees(5_000));

    const rows = await storedPromise(receivableId);
    expect(rows.map((row) => `${row.sequenceNo}:${row.status}`).join(" "), "each promise is graded against its own window").toBe("1:KEPT 2:KEPT");
    const paidPaise = (await storedPayments(receivableId)).reduce((sum, row) => sum + row.amountPaise, 0);
    expect(settledCreditOf(a.id) + settledCreditOf(b.id), "no rupee may be counted toward two promises").toBe(paidPaise);
    expect((await storedReceivable(receivableId))!.outstandingPaise, "₹10,000 of a ₹20,000 invoice is still owed").toBe(rupees(10_000));
  }, 90_000);

  it("phase 10: refuses a replacement promise dated before the promise it replaces", async () => {
    await signInAs("renegotiation-order");
    const { receivableId } = await seedInvoice("S5S2", rupees(10_000), dueInMonth);
    const a = await promiseFor(receivableId, rupees(4_000), inFiveDays, "Call", "An open commitment made today.");
    expect(a.madeOn).toBe(today);

    const tooEarly = await promiseRpc(receivableId, rupees(4_500), inEightDays, "WhatsApp", "Typed today, claiming to have been made last week.", crypto.randomUUID(), addIndiaBusinessDays(today, -1));
    expect(tooEarly.message, "the refusal has to say why, in the ledger's own words").toContain("A new promise cannot be dated as made before the promise it replaces");
    const untouched = await storedPromise(receivableId);
    expect(untouched, "a refused write leaves no half-recorded promise").toHaveLength(1);
    expect(untouched[0].status).toBe("ACTIVE");

    const replacement = await promiseRpc(receivableId, rupees(4_500), inEightDays, "WhatsApp", "Renegotiated today, for next week.", crypto.randomUUID(), today);
    expect(replacement.message).toBe("");
    const rows = await storedPromise(receivableId);
    expect(rows.map((row) => `${row.sequenceNo}:${row.status}`).join(" "), "a same-day replacement supersedes the open promise").toBe("1:RENEGOTIATED 2:ACTIVE");
    const events = await promiseEvents(a.id);
    expect(events.map((event) => event.to_status).join(" ")).toBe("ACTIVE RENEGOTIATED");
    expect(events.filter((event) => event.from_status === "ACTIVE" && event.to_status === "RENEGOTIATED"), "one event records the supersession").toHaveLength(1);
    expect(events.every((event) => event.metadata == null), "an ordinary transition is not a correction, so it cites no evidence").toBe(true);
  }, 90_000);

  it("phase 10: grades the open promise on its own facts before anything replaces it", async () => {
    await signInAs("reconcile-first");
    const { receivableId } = await seedInvoice("S5S3", rupees(10_000), dueInMonth);
    const a = await promiseFor(receivableId, rupees(4_000), inFiveDays, "Call", "Honoured in full, then a new date was typed.");
    await paymentFor(receivableId, rupees(4_000), today, "UPI", "S5S3-PAID");
    expect((await storedPromise(receivableId))[0].status, "the money settled the promise before any renegotiation").toBe("KEPT");

    await promiseFor(receivableId, rupees(2_000), inEightDays, "WhatsApp", "A further commitment beside a promise already kept.");
    const rows = await storedPromise(receivableId);
    expect(rows.map((row) => `${row.sequenceNo}:${row.status}`).join(" "), "a kept promise is never restyled as renegotiated").toBe("1:KEPT 2:ACTIVE");
    expect((await promiseEvents(a.id)).some((event) => event.to_status === "RENEGOTIATED"), "and no event claims it was replaced").toBe(false);
  }, 90_000);
});

describeLocalStack("Stage 5 says which payments a correction stands on (phases 11-12)", () => {
  const today = todayInIndia();
  const dueInMonth = addIndiaBusinessDays(today, 30);
  const madeOn = addIndiaBusinessDays(today, -5);
  const promisedDate = addIndiaBusinessDays(today, -2);
  const afterDeadline = addIndiaBusinessDays(promisedDate, 1);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 provenance fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("phase 11: a correction event names the in-window receipts and nothing outside the window", async () => {
    await signInAs("correction-provenance");
    const { receivableId } = await seedInvoice("S5P1", rupees(10_000), dueInMonth);
    const created = await promiseFor(receivableId, rupees(5_000), promisedDate, "WhatsApp", "Missed, then receipts surfaced days later.", madeOn);
    await promises.markDuePromisesBroken();

    // ₹2,000 dated after the promised day. Real money, but no evidence for this
    // promise, so it must neither correct the record nor appear beside it.
    const outside = await paymentRpc(receivableId, rupees(2_000), afterDeadline, "UPI", "S5P1-LATE", crypto.randomUUID());
    expect(outside.message).toBe("");
    const afterOutside = await promiseEvents(created.id);
    expect(afterOutside.map((event) => event.to_status).join(" "), "late money does not touch a broken promise").toBe("ACTIVE BROKEN");
    expect(afterOutside.every((event) => event.metadata == null), "a promise nothing corrected has nothing to cite").toBe(true);

    // ₹3,000 dated on the promised day: that is evidence, and the event has to
    // carry it durably.
    const requestId = crypto.randomUUID();
    const inside = await paymentRpc(receivableId, rupees(3_000), promisedDate, "UPI", "S5P1-ONTIME", requestId);
    const insideId = String((inside.data as { id?: string }).id ?? "");
    expect(insideId).toMatch(/^[0-9a-f-]{36}$/);
    const outsideId = String((outside.data as { id?: string }).id ?? "");

    const [promise] = await storedPromise(receivableId);
    expect(promise.status, "part of the sum was dated in time").toBe("PARTIALLY_KEPT");
    const events = await promiseEvents(created.id);
    expect(events.map((event) => `${event.from_status ?? "∅"}->${event.to_status}`).join(" ")).toBe("∅->ACTIVE ACTIVE->BROKEN BROKEN->PARTIALLY_KEPT");
    const evidence = events[2].metadata as unknown as CorrectionEvidence;
    expect(evidence, "the correction states its kind and its exact evidence").toEqual({
      reason_type: "historical_payment_evidence",
      payment_ids: [insideId],
      payments: [{ id: insideId, paid_on: promisedDate }],
    });

    // Cited ids must be real receipts on this same invoice, undated and
    // un-moved, sitting inside the window they are cited for.
    const receipts = await storedPayments(receivableId);
    for (const cited of evidence.payments) {
      const row = receipts.find((payment) => payment.id === cited.id);
      expect(row, "provenance may not invent a payment").toBeTruthy();
      expect(row!.receivableId, "and may not borrow one from another invoice").toBe(receivableId);
      expect(row!.paidDate, "or re-date one").toBe(cited.paid_on);
      expect(cited.paid_on >= madeOn && cited.paid_on <= promisedDate, "cited evidence must fall inside the window").toBe(true);
    }
    expect(evidence.payment_ids, "money dated outside the window is not evidence for it").not.toContain(outsideId);

    // The retry a flaky connection makes: same request id, same facts. The ledger
    // replays the act; it does not append a second correction.
    const replay = await paymentRpc(receivableId, rupees(3_000), promisedDate, "UPI", "S5P1-ONTIME", requestId);
    expect(String((replay.data as { id?: string }).id ?? ""), "the retry hands back the original receipt").toBe(insideId);
    const afterReplay = await promiseEvents(created.id);
    expect(afterReplay, "a retry must not append a duplicate correction event").toHaveLength(3);
    expect(afterReplay[2].metadata, "and must not restate the evidence differently").toEqual(evidence);
    expect(await storedPayments(receivableId), "still exactly two receipts").toHaveLength(2);
    expect((await storedPromise(receivableId))[0].status).toBe("PARTIALLY_KEPT");
  }, 90_000);

  it("phase 12: the original BROKEN event survives every later correction, unwritable", async () => {
    await signInAs("history-not-editable");
    const { receivableId } = await seedInvoice("S5P2", rupees(10_000), dueInMonth);
    const created = await promiseFor(receivableId, rupees(5_000), promisedDate, "Call", "A record that must not be editable.", madeOn);
    await promises.markDuePromisesBroken();
    const before = await promiseEvents(created.id);
    const broken = before.find((event) => event.to_status === "BROKEN")!;
    expect(broken, "the miss itself has to be on the record").toBeTruthy();

    const edited = await supabase.from("promise_events").update({ reason: "Rewritten by hand" } as never).eq("id", broken.id);
    expect(edited.error?.message ?? "", "an owner may read their history but not edit it").toMatch(/permission denied/);
    const erased = await supabase.from("promise_events").delete().eq("id", broken.id);
    expect(erased.error?.message ?? "", "and not delete it either").toMatch(/permission denied/);

    await paymentFor(receivableId, rupees(5_000), promisedDate, "UPI", "S5P2-EVIDENCE");
    const after = await promiseEvents(created.id);
    expect(after.filter((event) => event.to_status === "BROKEN"), "the miss stays on the record after the correction").toHaveLength(1);
    expect(after.find((event) => event.to_status === "BROKEN")!.reason, "with the words it was first written in").toBe(broken.reason);
    expect(after.some((event) => event.from_status === "BROKEN" && event.to_status === "KEPT"), "the correction is its own appended event").toBe(true);
    expect(after, "creation, the miss, the correction — appended, never replaced").toHaveLength(before.length + 1);
    expect((await storedPromise(receivableId))[0].status).toBe("KEPT");
  }, 90_000);
});

// Each case is the same ₹5,000 promise over the same window, and only the shape
// and the date of the money changes. Every case gets its own account and its own
// invoice: attribution is per receivable, so sharing an invoice would make each
// verdict depend on the previous case's receipts instead of on its own window.
describeLocalStack("Stage 5 decides every attribution case by the window, not the keyboard (phase 13)", () => {
  const today = todayInIndia();
  const dueInMonth = addIndiaBusinessDays(today, 30);
  const windowOpen = addIndiaBusinessDays(today, -6);
  const windowClose = addIndiaBusinessDays(today, -2);
  const beforeWindow = addIndiaBusinessDays(windowOpen, -1);
  const midWindow = addIndiaBusinessDays(windowOpen, 1);
  const afterWindow = addIndiaBusinessDays(windowClose, 1);
  const promisedPaise = rupees(5_000);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 attribution-matrix fixtures were not fully purged: ${purge}`);
  }, 120_000);

  const cases: Array<{ key: string; label: string; madeOn: string; promisedDate: string; money: Array<{ paise: number; paidOn: string }>; creditPaise: number; status: string }> = [
    { key: "opening-day", label: "arrives on the very day the promise was made", madeOn: windowOpen, promisedDate: windowClose, money: [{ paise: promisedPaise, paidOn: windowOpen }], creditPaise: promisedPaise, status: "KEPT" },
    { key: "before-window", label: "arrives the business day before the promise was made", madeOn: windowOpen, promisedDate: windowClose, money: [{ paise: promisedPaise, paidOn: beforeWindow }], creditPaise: 0, status: "BROKEN" },
    { key: "mid-window", label: "arrives in the middle of the window", madeOn: windowOpen, promisedDate: windowClose, money: [{ paise: promisedPaise, paidOn: midWindow }], creditPaise: promisedPaise, status: "KEPT" },
    { key: "closing-day", label: "arrives exactly on the promised day", madeOn: windowOpen, promisedDate: windowClose, money: [{ paise: promisedPaise, paidOn: windowClose }], creditPaise: promisedPaise, status: "KEPT" },
    { key: "after-window", label: "arrives the business day after the promised day", madeOn: windowOpen, promisedDate: windowClose, money: [{ paise: promisedPaise, paidOn: afterWindow }], creditPaise: 0, status: "BROKEN" },
    { key: "split-across-deadline", label: "is split between inside the window and past the deadline", madeOn: windowOpen, promisedDate: windowClose, money: [{ paise: rupees(2_000), paidOn: windowOpen }, { paise: rupees(3_000), paidOn: afterWindow }], creditPaise: rupees(2_000), status: "PARTIALLY_KEPT" },
    { key: "split-both-edges", label: "is split across both edges of the window", madeOn: windowOpen, promisedDate: windowClose, money: [{ paise: rupees(2_000), paidOn: windowOpen }, { paise: rupees(3_000), paidOn: windowClose }], creditPaise: promisedPaise, status: "KEPT" },
    { key: "one-paisa-inside", label: "contributes one paisa inside the window", madeOn: windowOpen, promisedDate: windowClose, money: [{ paise: 1, paidOn: midWindow }], creditPaise: 1, status: "PARTIALLY_KEPT" },
    { key: "single-day-hit", label: "lands on a promise whose window is one single day", madeOn: windowClose, promisedDate: windowClose, money: [{ paise: promisedPaise, paidOn: windowClose }], creditPaise: promisedPaise, status: "KEPT" },
    { key: "single-day-miss", label: "misses a promise whose window was one single day", madeOn: windowClose, promisedDate: windowClose, money: [{ paise: promisedPaise, paidOn: afterWindow }], creditPaise: 0, status: "BROKEN" },
  ];

  it.each(cases)("phase 13: $creditPaise paise of credit when the money $label", async (testCase) => {
    expect(testCase.money.every((receipt) => receipt.paidOn <= today), "a fixture may not date money in the future").toBe(true);
    await signInAs(`attr-${testCase.key}`);
    const { receivableId } = await seedInvoice(`S5M-${testCase.key}`, rupees(10_000), dueInMonth);
    const created = await promiseFor(receivableId, promisedPaise, testCase.promisedDate, "Call", "Attribution matrix.", testCase.madeOn);
    for (const receipt of testCase.money) {
      await paymentFor(receivableId, receipt.paise, receipt.paidOn, "UPI", `S5M-${testCase.key}`);
    }
    await promises.markDuePromisesBroken();
    expect(settledCreditOf(created.id), `window [${testCase.madeOn} .. ${testCase.promisedDate}], receipts ${testCase.money.map((receipt) => `${receipt.paise}@${receipt.paidOn}`).join(", ")}`)
      .toBe(testCase.creditPaise);
    const [stored] = await storedPromise(receivableId);
    expect(stored.status, "and the verdict the customer sees must match that credit").toBe(testCase.status);
  }, 90_000);
});

describeLocalStack("Stage 5 settles a closing hand and arriving money at once (phases 14-15)", () => {
  const today = todayInIndia();
  const inThreeDays = addIndiaBusinessDays(today, 3);
  const dueInMonth = addIndiaBusinessDays(today, 30);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage5life-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 5 race fixtures were not fully purged: ${purge}`);
  }, 120_000);

  type SecondClient = ReturnType<typeof clientWithSession>;
  const errorMessage = (result: { error: unknown }) => String((result.error as { message?: string } | null)?.message ?? "");
  const cancelInvoice = (client: SecondClient, receivableId: string, reason: string) =>
    client.rpc("cancel_receivable" as never, { p_receivable_id: receivableId, p_reason: reason } as never);
  const payInvoice = (client: SecondClient, receivableId: string, amountPaise: number) =>
    client.rpc("record_payment" as never, {
      p_receivable_id: receivableId,
      p_amount_paise: amountPaise,
      p_paid_on: today,
      p_method: "UPI",
      p_reference: "",
      p_request_id: crypto.randomUUID(),
      p_note: "",
    } as never);

  it("phase 14: a cancellation and a payment fire together and only one of them lands", async () => {
    await signInAs("race-cancel-vs-payment");
    const { receivableId } = await seedInvoice("S5R5", rupees(10_000), dueInMonth);
    const token = await accessTokenOfCurrentUser();
    // Two independent authenticated clients, one session each its own, both
    // writing through PostgREST rather than one shared connection pool.
    const [cancelled, paid] = await Promise.all([
      cancelInvoice(clientWithSession(token), receivableId, "Scope never confirmed."),
      payInvoice(clientWithSession(token), receivableId, rupees(3_000)),
    ]);
    for (const result of [cancelled, paid]) {
      expect(errorMessage(result), "a lost race is answered by the ledger's rules, never by the lock manager").not.toMatch(/deadlock|timeout|canceling statement|retry/i);
    }
    expect([!cancelled.error, !paid.error].filter(Boolean), "exactly one of the two writes may survive").toHaveLength(1);

    const stored = await storedReceivable(receivableId);
    const receipts = await storedPayments(receivableId);
    if (stored!.status === "CANCELLED") {
      expect(receipts, "a cancelled invoice must not end up holding money").toHaveLength(0);
      expect(stored!.outstandingPaise).toBe(0);
    } else {
      expect(receipts, "the surviving receipt is recorded once").toHaveLength(1);
      expect(cancelled.error?.message ?? "", "and the cancellation was refused because money exists").toMatch(/cannot be cancelled/);
      expect(stored!.outstandingPaise, "the balance stays derived, never negative").toBe(rupees(7_000));
    }
    expect(Number(localAdmin(ledgerAuditSql(await currentOwnerId()))), "the reconciliation audit must still be clean").toBe(0);
  }, 120_000);

  it("phase 14: money that arrives first closes the door on the cancellation", async () => {
    await signInAs("race-money-first");
    const { receivableId } = await seedInvoice("S5R6", rupees(10_000), dueInMonth);
    await paymentFor(receivableId, rupees(3_000), today, "UPI", "S5R6-FIRST");
    const refused = await rpcRaw("cancel_receivable", { p_receivable_id: receivableId, p_reason: "The money was already in." });
    expect(refused.message).toMatch(/cannot be cancelled/);
    const stored = await storedReceivable(receivableId);
    expect(stored!.status).toBe("PARTIALLY_PAID");
    expect(stored!.outstandingPaise).toBe(rupees(7_000));
    expect(await storedPayments(receivableId)).toHaveLength(1);
  }, 90_000);

  it("phase 14: a cancellation that lands first refuses the money rather than swallowing it", async () => {
    await signInAs("race-cancel-first");
    const { receivableId } = await seedInvoice("S5R7", rupees(10_000), dueInMonth);
    const closed = await rpcRaw("cancel_receivable", { p_receivable_id: receivableId, p_reason: "Quotation never became work." });
    expect(closed.message).toBe("");
    const refused = await paymentRpc(receivableId, rupees(3_000), today, "UPI", "S5R7-LATE", crypto.randomUUID());
    expect(refused.message).toMatch(/cancelled receivable does not accept payments/);
    expect(await storedPayments(receivableId), "no payment may sit behind a cancelled invoice").toHaveLength(0);
    const stored = await storedReceivable(receivableId);
    expect(stored!.status).toBe("CANCELLED");
    expect(stored!.outstandingPaise).toBe(0);
  }, 90_000);

  it("phase 15: withdrawing a promise and funding it at the same moment ends in one recorded outcome", async () => {
    await signInAs("race-cancel-promise-vs-payment");
    const { receivableId } = await seedInvoice("S5R8", rupees(10_000), dueInMonth);
    const created = await promiseFor(receivableId, rupees(5_000), inThreeDays, "Call", "Withdrawn, or paid — whichever the ledger sees first.");
    const token = await accessTokenOfCurrentUser();
    const [withdrawn, paid] = await Promise.all([
      clientWithSession(token).rpc("cancel_promise" as never, { p_promise_id: created.id, p_reason: "Customer withdrew the commitment." } as never),
      payInvoice(clientWithSession(token), receivableId, rupees(5_000)),
    ]);
    for (const result of [withdrawn, paid]) {
      expect(errorMessage(result), "neither side may lose to a lock").not.toMatch(/deadlock|timeout|canceling statement|retry/i);
    }

    const [stored] = await storedPromise(receivableId);
    if (withdrawn.error) {
      expect(errorMessage(paid), "the money is the legitimate act").toBe("");
      expect(stored.status, "a promise the money honoured cannot be withdrawn afterwards").toBe("KEPT");
      expect(errorMessage(withdrawn)).toMatch(/has not reached its outcome/);
    } else {
      expect(paid.error ?? null, "the receipt itself is never refused because a promise was withdrawn").toBeNull();
      expect(stored.status, "and money cannot resurrect a withdrawn promise").toBe("CANCELLED");
    }
    const events = await promiseEvents(created.id);
    expect(events.filter((event) => event.from_status === "ACTIVE").map((event) => event.to_status), "exactly one outcome, whichever write reached the row first")
      .toEqual([stored.status]);
    expect((await storedReceivable(receivableId))!.outstandingPaise).toBeGreaterThanOrEqual(0);
    expect(Number(localAdmin(ledgerAuditSql(await currentOwnerId()))), "the audit must be clean at either outcome").toBe(0);
  }, 120_000);
});
