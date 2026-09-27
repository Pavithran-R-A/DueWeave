import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabase } from "@/lib/supabase";
import { SupabaseClientRepository } from "@/data/supabase-client-repository";
import { SupabaseReceivableRepository } from "@/data/supabase-receivable-repository";
import { SupabasePromiseRepository } from "@/data/supabase-promise-repository";
import { SupabasePaymentRepository } from "@/data/supabase-payment-repository";
import { SupabaseActivityRepository } from "@/data/supabase-activity-repository";
import { SupabaseFounderRepository } from "@/data/supabase-founder-repository";
import { SupabaseDataExportRepository } from "@/data/supabase-data-export-repository";
import { buildExportBundle, csvFor, serializeExportBundle, type ExportKind, type ExportSnapshot } from "@/lib/data-export";
import { contactNote } from "@/lib/follow-up";
import { addIndiaBusinessDays } from "@/lib/finance";
import { todayInIndia } from "@/lib/business-clock";
import { newRequestId } from "@/lib/request-id";

// Stage 7's archive is the one file a person may keep when DueWeave is gone, so it
// is judged here against the database rather than against a screen: every row the
// owner can see has to be in it, nothing that is not theirs may be, and the act of
// reading it must leave the ledger exactly as it was. Everything goes through the
// repository classes the SPA imports, with real sessions. No service-role key
// appears in this file, and no SQL below writes anything the fixtures do not own.

const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const isLoopbackStack = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/i.test(url);
const describeLocalStack = isLoopbackStack && anonKey.length > 0 ? describe : describe.skip;

const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailFor = (label: string) => `stage7export-${label}-${runTag}@dueweave.local`;
const newPassword = () => `Stage7x!${Math.random().toString(36).slice(2, 12)}aA`;

const localDbContainer = process.env.STAGE7_LOCAL_DB_CONTAINER ?? "supabase_db_dueweave";

function localAdmin(sql: string) {
  return String(
    execFileSync("docker", ["exec", "-i", localDbContainer, "psql", "-U", "postgres", "-d", "postgres", "--set=ON_ERROR_STOP=1", "-A", "-t", "-f", "-"], {
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    })
  ).trim();
}

// Every owner id in this file comes from auth, but the SQL below is still built by
// string composition, so nothing can travel into it that is not a uuid.
function assertUuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error(`${label} is not a uuid`);
  return value;
}

const LEDGER_TABLES: Array<[table: string, ownerColumn: string]> = [
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

// A whole-row digest per table: a count alone would miss a rewritten note, and a
// single digest over every table would miss which one moved.
function ledgerFingerprint(ownerId: string) {
  assertUuid(ownerId, "owner id");
  return LEDGER_TABLES.map(([table, ownerColumn]) => {
    const value = localAdmin(`select count(*) || '@' || coalesce(md5(string_agg(digest, '|' order by digest)), '-') from (select md5(t::text) as digest from public.${table} t where t.${ownerColumn} = '${ownerId}') s;`);
    return `${table}=${value}`;
  }).join(";");
}

function ownerIdsOf(table: string, ownerColumn: string, ownerId: string) {
  assertUuid(ownerId, "owner id");
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(ownerColumn)) throw new Error("unexpected table identifier");
  const value = localAdmin(`select coalesce(string_agg(id::text, '|' order by id), '-') from public.${table} where ${ownerColumn} = '${ownerId}';`);
  return value === "-" ? [] : value.split("|");
}

const HISTORY_GUARDS = ["activities_immutable", "payments_immutable", "promise_events_immutable", "promises_guard_history"];

function historyGuardState() {
  return localAdmin(`select count(*) filter (where tgenabled = 'O') || '/' || count(*) from pg_trigger where tgname in (${HISTORY_GUARDS.map((name) => `'${name}'`).join(",")});`);
}

// Fixture cleanup only, for the accounts this file signed up. The history guards
// refuse a cascading delete by design — that is Stage 5's immutability, and it is
// why deleting an auth user is not a supported operation in this build — so the
// purge holds those guards off for one transaction and reports that they came back.
function purgeStage7Fixtures(emailPattern: string) {
  const tables: Array<[string, string]> = [
    ["public.activities", "owner_id"],
    ["public.promise_events", "owner_id"],
    ["public.payments", "owner_id"],
    ["public.promises", "owner_id"],
    ["public.receivables", "owner_id"],
    ["public.clients", "owner_id"],
    ["public.analytics_events", "owner_id"],
    ["public.purchase_claims", "owner_id"],
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
  return `${residue} guards=${historyGuardState()}`;
}

const passwords = new Map<string, string>();

async function signInAs(label: string) {
  await supabase.auth.signOut();
  passwords.set(label, passwords.get(label) ?? newPassword());
  const password = passwords.get(label)!;
  const signed = await supabase.auth.signUp({ email: emailFor(label), password, options: { data: { display_name: `Stage 7 export ${label}` } } });
  if (signed.error) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: emailFor(label), password });
    expect(error ?? null, `local sign-in failed for ${label}`).toBeNull();
    expect(data.session, `local sign-in returned no session for ${label}`).toBeTruthy();
    return data.user!.id;
  }
  expect(signed.data.session, `local signup returned no session for ${label}`).toBeTruthy();
  return signed.data.user!.id;
}

// Synthetic fixtures only. These are deliberately hostile: a comma and double quotes
// inside a company name, a newline, curly quotes and Tamil inside a note, and a note
// whose first character is one a spreadsheet would execute instead of display.
const hostile = {
  name: `Nalini "N" Ramesh ${runTag.slice(-5)}`,
  company: `Nalini Films, Chennai ${runTag.slice(-5)}`,
  notes: `Said “will pay next week”\nமோகன், Alpha crew\n=HYPERLINK("https://example.invalid","x")`,
  formulaNote: `=HYPERLINK("https://example.invalid","x")`,
};

const marker = {
  alpha: `Alpha Studio ${runTag.slice(-5)}`,
  beta: `Beta Studio ${runTag.slice(-5)}`,
};

async function seedLedger(businessName: string) {
  const clients = new SupabaseClientRepository();
  const receivables = new SupabaseReceivableRepository();
  const promises = new SupabasePromiseRepository();
  const payments = new SupabasePaymentRepository();
  const activities = new SupabaseActivityRepository();
  const today = todayInIndia();
  // A commitment whose deadline has already gone by, so the archive must carry the
  // whole history of it rather than a single snapshot row.
  const madeOn = addIndiaBusinessDays(today, -6);
  const promisedDate = addIndiaBusinessDays(today, -3);

  const noisy = await clients.create({ name: hostile.name, company: hostile.company, phone: "+91 98765 43210", email: `nalini-${runTag.slice(-5)}@example.invalid`, notes: hostile.notes });
  const quiet = await clients.create({ name: `Devan ${runTag.slice(-5)}`, company: businessName, phone: "9876543210", email: "", notes: hostile.formulaNote });
  const open = await receivables.createForClient({ clientId: noisy.id, label: `Weddy teaser ${runTag.slice(-5)}`, invoiceRef: `INV-${runTag.slice(-6, -2)}`, amountPaise: 2800000, dueDate: addIndiaBusinessDays(today, -6), notes: "" });
  const second = await receivables.createForClient({ clientId: quiet.id, label: `Album track ${runTag.slice(-5)}`, invoiceRef: "", amountPaise: 1500000, dueDate: addIndiaBusinessDays(today, 9), notes: "" });
  await activities.recordContacted(open.id, contactNote({ channel: "whatsapp", template: "overdue" }));
  const promise = await promises.create({ receivableId: open.id, amountPaise: 1300000, madeOn, promisedDate, source: "WhatsApp", note: `Said Friday ${runTag.slice(-5)}`, requestId: newRequestId() });
  // Money dated after the promised day is real money and false evidence; it must not
  // be what corrects the record below.
  await payments.record({ receivableId: open.id, amountPaise: 1500000, paidOn: today, method: "UPI", reference: `9F3A${runTag.slice(-5)}`, requestId: newRequestId() });
  await promises.markDuePromisesBroken();
  const evidence = await payments.record({ receivableId: open.id, amountPaise: 500000, paidOn: promisedDate, method: "Cash", reference: "", requestId: newRequestId() });
  await payments.record({ receivableId: second.id, amountPaise: 500000, paidOn: addIndiaBusinessDays(today, -1), method: "Cash", reference: "", requestId: newRequestId() });
  await activities.snooze(second.id, addIndiaBusinessDays(today, 2));
  return { noisy, quiet, open, second, promise, evidence, madeOn, promisedDate };
}

describeLocalStack("Stage 7 data export against the live local database", () => {
  const exporter = new SupabaseDataExportRepository();
  const founder = new SupabaseFounderRepository();
  let ownerIdA = "";
  let ownerIdB = "";
  let seeded: Awaited<ReturnType<typeof seedLedger>>;
  let betaSeeded: Awaited<ReturnType<typeof seedLedger>>;
  // A Founder claim is the one dataset the local stack will not let an owner write:
  // Stage 4's payment-readiness gate refuses it until an offer is configured. Held as
  // a tripwire rather than a caveat — if that ever changes, the empty archive below
  // stops being a proof and says so.
  let claimAttempt = "";

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = purgeStage7Fixtures(`stage7export-%-${runTag}@dueweave.local`);
    if (!/residue=0/.test(purge) || !/guards=4\/4/.test(purge)) console.warn(`Stage 7 export fixtures were not fully purged: ${purge}`);
  });

  beforeAll(async () => {
    ownerIdA = await signInAs("alpha");
    seeded = await seedLedger(marker.alpha);
    await founder.recordUpgradeView();
    claimAttempt = await founder.createClaim().then(() => "created", (error) => (error instanceof Error ? error.message : String(error)));

    ownerIdB = await signInAs("beta");
    betaSeeded = await seedLedger(marker.beta);
  });

  async function readAs(ownerLabel: string) {
    await signInAs(ownerLabel);
    return exporter.read();
  }

  it("hands back every owner-visible row, id for id, with nothing invented", async () => {
    const snapshot = await readAs("alpha");
    expect(snapshot.profile?.id).toBe(ownerIdA);
    // Every dataset the archive is supposed to carry, against the table it came from.
    type RowDataset = "clients" | "receivables" | "promises" | "payments" | "activities" | "promiseEvents" | "purchaseClaims" | "analyticsEvents";
    const cases: Array<[RowDataset, string, string]> = [
      ["clients", "clients", "owner_id"],
      ["receivables", "receivables", "owner_id"],
      ["promises", "promises", "owner_id"],
      ["payments", "payments", "owner_id"],
      ["activities", "activities", "owner_id"],
      ["promiseEvents", "promise_events", "owner_id"],
      ["purchaseClaims", "purchase_claims", "owner_id"],
      ["analyticsEvents", "analytics_events", "owner_id"],
    ];
    const idsOf = (rows: { id: string }[]) => rows.map((row) => row.id).sort();
    for (const [dataset, table, ownerColumn] of cases) {
      const exported = idsOf(snapshot[dataset]);
      expect(exported, `the ${table} archive did not match owner-visible database state`).toEqual(ownerIdsOf(table, ownerColumn, ownerIdA).sort());
    }
    // A dataset the owner really has must not be silently empty: the ledger the
    // fixture above wrote is the point of the assertion.
    expect(snapshot.clients.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.payments.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.activities.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.promiseEvents.length, "a promise that changed state must arrive with its history").toBeGreaterThanOrEqual(3);
    expect(snapshot.analyticsEvents.length, "the Founder view an owner actually performed must be in the archive").toBeGreaterThanOrEqual(1);
    expect(claimAttempt, "purchase_claims became writable locally, so this archive needs a non-empty live proof").not.toBe("created");
    expect(snapshot.entitlement?.user_id).toBe(ownerIdA);
    expect(snapshot.entitlement?.id).toBe(ownerIdsOf("entitlements", "user_id", ownerIdA)[0]);
  });

  it("keeps the exact instant, the integer paise and the Stage 5 provenance", async () => {
    const snapshot = await readAs("alpha");
    const promise = snapshot.promises.find((row) => row.id === seeded.promise.id)!;
    expect(promise.made_on).toBe(seeded.madeOn);
    expect(promise.promised_date).toBe(seeded.promisedDate);
    expect(Number.isInteger(promise.promised_amount_paise)).toBe(true);
    expect(promise.promised_amount_paise).toBe(1300000);
    for (const payment of snapshot.payments) expect(Number.isInteger(payment.amount_paise)).toBe(true);
    // The full life of the commitment, in order, with the timestamps unrounded:
    // made, broken by the date passing, then corrected by evidence from inside
    // its own window. A summary row would have lost all three facts.
    const events = snapshot.promiseEvents.filter((row) => row.promise_id === promise.id);
    // Who moved the state is part of the record: the owner made the commitment, the
    // schedule broke it, and evidence corrected it. A summary would carry none of that.
    expect(events.map((row) => `${row.actor_type}:${row.from_status ?? "∅"}->${row.to_status}`)).toEqual([
      "USER:∅->ACTIVE",
      "SYSTEM:ACTIVE->BROKEN",
      "SYSTEM:BROKEN->PARTIALLY_KEPT",
    ]);
    for (const event of events) expect(event.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}\+00:00$/);
    // Provenance is only worth carrying if the ids it cites are in the same file.
    const correction = events[2]!;
    const evidence = correction.metadata as { reason_type: string; payment_ids: string[]; payments: Array<{ id: string; paid_on: string }> };
    expect(evidence.reason_type).toBe("historical_payment_evidence");
    expect(evidence.payment_ids).toEqual([seeded.evidence.id]);
    expect(evidence.payments).toEqual([{ id: seeded.evidence.id, paid_on: seeded.promisedDate }]);
    const cited = snapshot.payments.find((row) => row.id === evidence.payment_ids[0]);
    expect(cited?.paid_on, "the archive cited a payment it does not contain").toBe(seeded.promisedDate);
    expect(cited?.amount_paise).toBe(500000);
    const contact = snapshot.activities.find((row) => row.type === "FOLLOW_UP_RECORDED")!;
    expect(contact.note).toBe(contactNote({ channel: "whatsapp", template: "overdue" }));
    expect(contact.occurred_at.length).toBeGreaterThan(10);
  });

  it("changes nothing at all in the ledger while producing every file", async () => {
    await signInAs("alpha");
    const before = ledgerFingerprint(ownerIdA);
    const snapshot = await exporter.read();
    const bundle = buildExportBundle(snapshot, new Date().toISOString());
    const kinds: ExportKind[] = ["data", "clients", "receivables", "payments", "promises", "activities"];
    for (const kind of kinds) {
      const contents = kind === "data" ? serializeExportBundle(bundle) : csvFor(kind, snapshot);
      expect(contents.length).toBeGreaterThan(0);
      await exporter.read();
    }
    expect(ledgerFingerprint(ownerIdA), "an export wrote to the ledger it was only supposed to read").toBe(before);
  });

  it("reads each CSV sheet back out of the live rows without losing a character", async () => {
    const snapshot = await readAs("alpha");
    const quoted = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const clientsCsv = csvFor("clients", snapshot);
    expect(clientsCsv.split("\r\n")[0]).toBe("client_id,name,company,phone,email,notes,archived_at,created_at,updated_at");
    expect(clientsCsv).toContain(quoted(hostile.name));
    expect(clientsCsv).toContain(quoted(hostile.company));
    // A note carrying a newline, curly quotes, Tamil and a formula marker has to
    // arrive as one quoted cell, neutralised but otherwise untouched.
    expect(clientsCsv).toContain(quoted(hostile.notes));
    // A cell that starts with a marker Excel executes is prefixed before quoting, so
    // the file reads it as the text the owner typed.
    expect(clientsCsv).toContain(quoted(`'${hostile.formulaNote}`));
    const receivablesCsv = csvFor("receivables", snapshot);
    expect(receivablesCsv).toContain("2800000");
    expect(receivablesCsv).not.toMatch(/28000\.0|₹28,000/);
    const activitiesCsv = csvFor("activities", snapshot);
    const snoozed = snapshot.activities.find((row) => row.type === "SNOOZED")!;
    expect(activitiesCsv).toContain(snoozed.id);
    expect(activitiesCsv, "the private snooze date has to travel with the row").toContain(addIndiaBusinessDays(todayInIndia(), 2));
  });

  it("keeps one owner's archive out of another owner's file, in both directions", async () => {
    const alpha = await readAs("alpha");
    const beta = await readAs("beta");
    const alphaBundle = serializeExportBundle(buildExportBundle(alpha, new Date().toISOString()));
    const betaBundle = serializeExportBundle(buildExportBundle(beta, new Date().toISOString()));
    const alphaText = [alphaBundle, ...(["clients", "receivables", "payments", "promises", "activities"] as const).map((kind) => csvFor(kind, alpha))].join("\n");
    const betaText = [betaBundle, ...(["clients", "receivables", "payments", "promises", "activities"] as const).map((kind) => csvFor(kind, beta))].join("\n");

    expect(alphaText).toContain(marker.alpha);
    expect(alphaText).not.toContain(marker.beta);
    expect(betaText).toContain(marker.beta);
    expect(betaText).not.toContain(marker.alpha);
    for (const id of alpha.clients.map((row) => row.id)) expect(betaText, `a client id leaked into the other owner's archive: ${id}`).not.toContain(id);
    for (const id of beta.clients.map((row) => row.id)) expect(alphaText, `a client id leaked into the other owner's archive: ${id}`).not.toContain(id);
    expect(alphaText).not.toMatch(/service_role|eyJ[A-Za-z0-9_-]{8,}\.eyJ|access_token|refresh_token/);
    expect(alpha.profile?.id).toBe(ownerIdA);
    expect(beta.profile?.id).toBe(ownerIdB);
  });

  it("refuses a contact record across owners and refuses the browser any direct write to history", async () => {
    await signInAs("beta");
    const foreign = seeded.open.id;
    const { error } = await supabase.rpc("record_contacted", { p_receivable_id: foreign, p_note: "cross-tenant probe" });
    expect(error, "record_contacted accepted a write against someone else's ledger").not.toBeNull();
    expect(localAdmin(`select count(*) from public.activities where note = 'cross-tenant probe';`)).toBe("0");

    // Phase 52's other half: the refusal above must be about ownership, not about
    // the browser having a history table it can write into. `authenticated` holds no
    // INSERT on activities at all, so there is no grant for a policy to leak through.
    const own = await supabase.from("activities").insert({ owner_id: ownerIdB, receivable_id: betaSeeded.second.id, type: "NOTE_ADDED", occurred_at: new Date().toISOString(), note: "same-owner probe" });
    expect(own.error, `a direct activity insert reached the ledger: ${JSON.stringify(own.data)}`).not.toBeNull();
    expect(own.error?.code, "a direct insert was refused for a reason other than privileges").toBe("42501");
    expect(localAdmin("select has_table_privilege('authenticated', 'public.activities', 'INSERT');")).toBe("f");
    // The protected path still works for its own owner, or the two refusals above
    // would only prove that nothing can be recorded at all.
    const mine = await supabase.rpc("record_contacted", { p_receivable_id: betaSeeded.second.id, p_note: "own-ledger control" });
    expect(mine.error ?? null, `an owner could not record their own contact: ${JSON.stringify(mine.error)}`).toBeNull();
  });

  it("leaves a confirmed contact as history no session may edit or delete", async () => {
    await signInAs("alpha");
    const snapshot = await exporter.read();
    const contact = snapshot.activities.find((row) => row.type === "FOLLOW_UP_RECORDED")!;
    const before = ledgerFingerprint(ownerIdA);
    const update = await supabase.from("activities").update({ note: "rewritten" }).eq("id", contact.id);
    expect(update.error, "an activity row was editable by its own owner").not.toBeNull();
    const removal = await supabase.from("activities").delete().eq("id", contact.id);
    expect(removal.error, "an activity row was deletable by its own owner").not.toBeNull();
    const money = await supabase.from("payments").delete().eq("id", snapshot.payments[0]!.id);
    expect(money.error, "a payment row was deletable by its own owner").not.toBeNull();
    expect(ledgerFingerprint(ownerIdA)).toBe(before);
  });

  it("returns the same persisted facts after the session is signed out and back in", async () => {
    const first = await readAs("alpha");
    await signInAs("beta");
    const second = await readAs("alpha");
    const stripAt = (snapshot: ExportSnapshot) => serializeExportBundle(buildExportBundle(snapshot, "fixed"));
    expect(stripAt(second)).toBe(stripAt(first));
    expect(second.email).toBe(emailFor("alpha"));
    expect(second.clients.map((row) => row.id).sort()).toEqual(first.clients.map((row) => row.id).sort());
  });

  it("exports a workspace nobody has used yet as a valid archive of empty sets", async () => {
    const lonelyId = await signInAs("lonely");
    const snapshot = await exporter.read();
    const bundle = buildExportBundle(snapshot, new Date().toISOString());
    expect(bundle.account.displayName).toBe("Stage 7 export lonely");
    expect(bundle.account.businessName ?? "").toBe("");
    expect(bundle.account.email).toBe(emailFor("lonely"));
    expect(snapshot.profile?.id).toBe(lonelyId);
    for (const dataset of ["clients", "receivables", "promises", "payments", "activities", "promiseEvents", "purchaseClaims", "analyticsEvents"] as const) {
      expect(bundle[dataset], `${dataset} was not empty in a workspace with no ledger`).toEqual([]);
    }
    expect(JSON.parse(serializeExportBundle(bundle)).version).toBe(1);
    for (const kind of ["clients", "receivables", "payments", "promises", "activities"] as const) {
      const csv = csvFor(kind, snapshot);
      expect(csv.endsWith("\r\n")).toBe(true);
      expect(csv.split("\r\n").filter((line) => line.length)).toHaveLength(1);
    }
  });

  it("asks for a live session before it reads a single row", async () => {
    await supabase.auth.signOut();
    await expect(exporter.read()).rejects.toThrow(/session/i);
  });
});
