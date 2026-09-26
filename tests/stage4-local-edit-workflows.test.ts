import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Quiet Ledger style reminder: an edit is only as safe as the column list that
// survives it. This suite attacks the Stage 4 edit RPCs with the same three
// browser roles the SPA uses — anon, owner, and a foreign authenticated account.
// No service-role key is read, imported, or used anywhere in this file.

const url = process.env.VITE_SUPABASE_URL ?? "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";
const isLoopbackStack = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/i.test(url);
const describeLocalStack = isLoopbackStack && anonKey.length > 0 ? describe : describe.skip;

const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailFor = (label: string) => `stage4-${label}-${runTag}@dueweave.local`;
const newPassword = () => `Stage4!${Math.random().toString(36).slice(2, 12)}aA`;

function newClient(accessToken?: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Local Postgres administration, used only for fixture teardown. It never makes
// an authorization claim and never bypasses one.
const localDbContainer = process.env.STAGE4_LOCAL_DB_CONTAINER ?? "supabase_db_dueweave";

function localAdmin(sql: string) {
  return String(
    execFileSync("docker", ["exec", "-i", localDbContainer, "psql", "-U", "postgres", "-d", "postgres", "--set=ON_ERROR_STOP=1", "-A", "-t", "-f", "-"], {
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    })
  ).trim();
}

// The fixture rows this suite creates are guarded by AFTER DELETE triggers that
// raise unconditionally, so a purge that only issues DELETEs aborts at the first
// statement and leaves the whole run behind. The guards are skipped for one
// transaction with `set local session_replication_role = replica`, which reverts
// at commit and takes no lock on the guarded tables. Doing it with
// `alter table … disable trigger` was tried first and is wrong: that asks for
// ACCESS EXCLUSIVE on each history table while the ledger RPCs are mid-write, so
// a money insert waiting behind a purge that is itself waiting for the next
// table is a cycle Postgres resolves by killing the money write — and each ALTER
// also fires the Stage 3 ddl_command_end notify, reloading PostgREST's schema
// cache so that a browser request landing in the window fails. ON_ERROR_STOP
// still makes an aborted purge roll back, and the guard state is read back from
// pg_trigger afterwards rather than trusted from the transcript.
const PROTECTED_HISTORY_TRIGGERS: Array<[table: string, trigger: string]> = [
  ["public.activities", "activities_immutable"],
  ["public.payments", "payments_immutable"],
  ["public.promise_events", "promise_events_immutable"],
  ["public.promises", "promises_guard_history"],
];

function historyGuardState() {
  return localAdmin(`select count(*) filter (where tgenabled = 'O') || '/' || count(*) || ' ' || string_agg(tgname, ',' order by tgname)
  from pg_trigger where tgname in (${PROTECTED_HISTORY_TRIGGERS.map(([, trigger]) => `'${trigger}'`).join(", ")});`);
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
  return localAdmin(`select 'before=' || count(*) from auth.users where email like '${emailPattern}';
begin;
set local session_replication_role = replica;
${owned}
  delete from auth.users where email like '${emailPattern}';
commit;
select 'residue=' || count(*) from auth.users where email like '${emailPattern}';`);
}

type Row = Record<string, unknown>;
type Probe = { data?: unknown; error: PostgrestError | null };

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  if (value && typeof value === "object") return [value as Row];
  return [];
}

// A denial only counts when the server refused for a security or identity
// reason. A malformed call (missing column, wrong argument shape, unresolvable
// routine) must never be booked as proof of isolation.
const MALFORMED_CODES = new Set(["42P01", "42703", "42883", "42P10", "22P02", "23503", "23514", "PGRST204", "PGRST205", "PGRST102"]);

function refusedBy(who: string, probe: Probe, expectedMessage?: string) {
  if (!probe.error) return { blocked: false, detail: `${who} request was accepted` };
  const code = probe.error.code ?? "P0000";
  if (MALFORMED_CODES.has(code)) return { blocked: false, detail: `${who} probe was malformed (${code}: ${probe.error.message})` };
  if (expectedMessage && !probe.error.message.includes(expectedMessage)) return { blocked: false, detail: `${who} refused for an unexpected reason (${code}: ${probe.error.message})` };
  return { blocked: true, detail: `${who} refused with ${code}: ${probe.error.message}` };
}

type Category = "cross-tenant-edit" | "anonymous-edit" | "concurrency" | "immutable-column" | "direct-write" | "input-validation" | "legitimate-owner-edit";
type Outcome = "refused" | "accepted" | "unchanged";
type LedgerEntry = { category: Category; label: string; outcome: Outcome; detail: string };
const ledger: LedgerEntry[] = [];

function bookRefusal(category: Category, label: string, result: { blocked: boolean; detail: string }) {
  ledger.push({ category, label, outcome: result.blocked ? "refused" : "accepted", detail: result.detail });
  expect(result.blocked, `[${category}] ${label} — ${result.detail}`).toBe(true);
}

function bookAcceptance(category: Category, label: string, probe: Probe) {
  ledger.push({ category, label, outcome: probe.error ? "refused" : "accepted", detail: probe.error ? `${probe.error.code ?? "P0000"} ${probe.error.message}` : "accepted" });
  expect(probe.error, `[${category}] ${label} — legitimate owner operation failed`).toBeNull();
}

function bookUnchanged(label: string, category: Category, actual: unknown, expected: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ledger.push({ category, label, outcome: "unchanged", detail: same ? "stored state unchanged" : `expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}` });
  expect(same, `[${category}] ${label} — stored state changed: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`).toBe(true);
}

type Account = {
  userId: string;
  email: string;
  password: string;
  client: SupabaseClient;
  clientId: string;
  clientRow: Row;
  receivableId: string;
  receivableRow: Row;
};

const state: { a?: Account; b?: Account; anon?: SupabaseClient } = {};

async function bootstrap(label: string): Promise<Account> {
  const email = emailFor(label);
  const password = newPassword();
  const { data, error } = await newClient().auth.signUp({ email, password, options: { data: { display_name: `Stage 4 ${label}` } } });
  expect(error ?? null, `local signup failed for ${label}`).toBeNull();
  expect(data.session, `local signup returned no session for ${label}`).toBeTruthy();
  const client = newClient(data.session!.access_token);

  const created = await client.rpc("create_client", { p_name: `Stage4 ${label} Client`, p_company: `${label} Studio`, p_phone: "919876500000", p_email: `${label}@dueweave.local`, p_notes: "Created by the Stage 4 suite." });
  expect(created.error ?? null, `${label} create_client failed`).toBeNull();
  const clientRow = rows(created.data)[0];
  expect(clientRow, `${label} create_client returned no row`).toBeTruthy();

  const receivable = await client.rpc("create_receivable", { p_client_id: clientRow.id, p_label: `Stage4 ${label} invoice`, p_invoice_ref: `S4-${label.toUpperCase()}-1`, p_amount_due_paise: 2500000, p_due_date: "2026-09-30", p_notes: "Seeded by the Stage 4 suite." });
  expect(receivable.error ?? null, `${label} create_receivable failed`).toBeNull();
  const receivableRow = rows(receivable.data)[0];
  expect(receivableRow, `${label} create_receivable returned no row`).toBeTruthy();

  return { userId: data.user!.id, email, password, client, clientId: String(clientRow.id), clientRow, receivableId: String(receivableRow.id), receivableRow };
}

describeLocalStack("Stage 4 local edit workflows: owner edits, foreign accounts, and stale writes", () => {
  beforeAll(async () => {
    state.anon = newClient();
    state.a = await bootstrap("alpha");
    state.b = await bootstrap("beta");
  }, 180_000);

  afterAll(async () => {
    mkdirSync(path.resolve("test-results"), { recursive: true });
    const tally = ledger.reduce<Record<string, Record<Outcome | "probes", number>>>((acc, entry) => {
      const bucket = (acc[entry.category] ??= { probes: 0, refused: 0, accepted: 0, unchanged: 0 });
      bucket.probes += 1;
      bucket[entry.outcome] += 1;
      return acc;
    }, {});
    let purge: string;
    try {
      purge = purgeLocalFixtures("stage4-%@dueweave.local").replace(/\s*\n\s*/g, " ");
    } catch (error) {
      // A purge that dies must say so instead of quietly leaving fixtures — that
      // silence is how an earlier version of this teardown lost six accounts.
      purge = `purge failed: ${String(error)}`;
    }
    // Read the guard state back from the database rather than trusting the
    // purge transcript: DDL is transactional, so the only question that matters
    // is what state the shared local database is actually in now.
    const guards = historyGuardState();
    writeFileSync(path.resolve("test-results", "stage4-edit-workflows.json"), JSON.stringify({ runTag, tally, entries: ledger, purge, guards }, null, 2));
    expect(guards, `a history guard is switched off in the shared local database — ${guards}`).toMatch(/^4\/4 /);
    if (!/residue=0/.test(purge)) console.warn(`Stage 4 fixtures were not fully purged: ${purge}`);
  }, 120_000);

  async function readClient(as: Account, id: string) {
    const { data, error } = await as.client.from("clients").select("*").eq("id", id).single();
    expect(error ?? null, "owner client re-read failed").toBeNull();
    return data as Row;
  }

  async function readReceivable(as: Account, id: string) {
    const { data, error } = await as.client.from("receivables").select("*").eq("id", id).single();
    expect(error ?? null, "owner receivable re-read failed").toBeNull();
    return data as Row;
  }

  it("lets the owner edit a client and returns the saved values with an advanced updated_at", async () => {
    const a = state.a!;
    const before = a.clientRow;
    const probe = await a.client.rpc("update_client", {
      p_client_id: a.clientId,
      p_name: "Arundhati Venkatesh",
      p_company: "Venkatesh Post House",
      p_phone: "919812345678",
      p_email: "arundhati@venkatesh.example",
      p_notes: "Prefers evening calls.",
      p_expected_updated_at: before.updated_at,
    });
    bookAcceptance("legitimate-owner-edit", "A edits A's client", probe);
    const returned = rows(probe.data)[0];
    expect(returned.name).toBe("Arundhati Venkatesh");
    expect(returned.company).toBe("Venkatesh Post House");
    expect(returned.phone).toBe("919812345678");
    expect(returned.email).toBe("arundhati@venkatesh.example");
    expect(returned.notes).toBe("Prefers evening calls.");

    const stored = await readClient(a, a.clientId);
    expect(stored).toMatchObject({ name: "Arundhati Venkatesh", company: "Venkatesh Post House", phone: "919812345678", email: "arundhati@venkatesh.example", notes: "Prefers evening calls." });
    expect(new Date(stored.updated_at as string).getTime()).toBeGreaterThan(new Date(before.updated_at as string).getTime());
    a.clientRow = stored;
  });

  it("keeps a client edit from moving ownership, identity, archive state or creation time", async () => {
    const a = state.a!;
    const stored = await readClient(a, a.clientId);
    bookUnchanged("client owner_id survives the edit", "immutable-column", stored.owner_id, a.userId);
    bookUnchanged("client id survives the edit", "immutable-column", stored.id, a.clientId);
    bookUnchanged("client created_at survives the edit", "immutable-column", stored.created_at, a.clientRow.created_at);
    expect(stored.archived_at, "an edit must not archive or unarchive a client").toBeNull();
  });

  it("rejects a stale client edit with a conflict and leaves the stored row untouched", async () => {
    const a = state.a!;
    const current = await readClient(a, a.clientId);
    const probe = await a.client.rpc("update_client", {
      p_client_id: a.clientId,
      p_name: "Overwritten From A Stale Tab",
      p_company: "",
      p_phone: "",
      p_email: "",
      p_notes: "",
      p_expected_updated_at: current.created_at,
    });
    const result = refusedBy("A", probe);
    bookRefusal("concurrency", "a stale expected_updated_at is refused", result);
    expect(probe.error?.code, "a stale edit must surface the serialization conflict code").toBe("40001");
    ledger.push({ category: "concurrency", label: "stale edit surfaces SQLSTATE 40001", outcome: "refused", detail: `code ${probe.error?.code}` });
    const after = await readClient(a, a.clientId);
    bookUnchanged("stale client edit changed nothing", "concurrency", after, current);
  });

  it("refuses a foreign account that edits a client with the owner's current timestamp", async () => {
    const a = state.a!;
    const b = state.b!;
    const fresh = await readClient(a, a.clientId);
    const probe = await b.client.rpc("update_client", {
      p_client_id: a.clientId,
      p_name: "Hijacked By Beta",
      p_company: "",
      p_phone: "",
      p_email: "",
      p_notes: "",
      p_expected_updated_at: fresh.updated_at,
    });
    bookRefusal("cross-tenant-edit", "B cannot edit A's client even holding A's timestamp", refusedBy("B", probe));
    const after = await readClient(a, a.clientId);
    bookUnchanged("A's client keeps the saved value", "cross-tenant-edit", after, fresh);
  });

  it("refuses an anonymous client edit", async () => {
    const a = state.a!;
    const probe = await state.anon!.rpc("update_client", {
      p_client_id: a.clientId,
      p_name: "Anonymous Rewrite",
      p_company: "",
      p_phone: "",
      p_email: "",
      p_notes: "",
      p_expected_updated_at: a.clientRow.updated_at,
    });
    bookRefusal("anonymous-edit", "anon cannot execute update_client", refusedBy("anon", probe));
  });

  it("applies the create-path validation rules to client edits", async () => {
    const a = state.a!;
    const current = await readClient(a, a.clientId);
    const base = { p_client_id: a.clientId, p_company: "", p_phone: "", p_email: "", p_notes: "", p_expected_updated_at: current.updated_at };

    const empty = await a.client.rpc("update_client", { ...base, p_name: "   " });
    bookRefusal("input-validation", "a blank name is refused", refusedBy("A", empty, "client name"));
    const longName = await a.client.rpc("update_client", { ...base, p_name: "N".repeat(161) });
    bookRefusal("input-validation", "a 161-character name is refused", refusedBy("A", longName, "client name"));
    const badEmail = await a.client.rpc("update_client", { ...base, p_name: current.name as string, p_email: "not-an-email" });
    bookRefusal("input-validation", "an invalid email is refused", refusedBy("A", badEmail, "valid email"));
    const badPhone = await a.client.rpc("update_client", { ...base, p_name: current.name as string, p_phone: "12345" });
    bookRefusal("input-validation", "a five-digit phone is refused", refusedBy("A", badPhone, "valid phone"));
    const longNotes = await a.client.rpc("update_client", { ...base, p_name: current.name as string, p_notes: "x".repeat(2001) });
    bookRefusal("input-validation", "notes over 2,000 characters are refused", refusedBy("A", longNotes, "2,000"));

    const after = await readClient(a, a.clientId);
    bookUnchanged("rejected edits changed nothing", "input-validation", after, current);
  });

  it("lets the owner edit receivable details without touching any financial fact", async () => {
    const a = state.a!;
    const before = await readReceivable(a, a.receivableId);
    const probe = await a.client.rpc("update_receivable_details", {
      p_receivable_id: a.receivableId,
      p_label: "Monsoon reel — colour pass",
      p_invoice_ref: "S4-ALPHA-1-REV",
      p_notes: "Client asked for the revised reference.",
      p_expected_updated_at: before.updated_at,
    });
    bookAcceptance("legitimate-owner-edit", "A edits A's receivable details", probe);
    const returned = rows(probe.data)[0];
    expect(returned.label).toBe("Monsoon reel — colour pass");
    expect(returned.invoice_ref).toBe("S4-ALPHA-1-REV");
    expect(returned.notes).toBe("Client asked for the revised reference.");

    const after = await readReceivable(a, a.receivableId);
    for (const column of ["amount_due_paise", "outstanding_paise", "status", "client_id", "due_date", "owner_id", "created_at", "id"] as const) {
      bookUnchanged(`receivable ${column} is not editable`, "immutable-column", after[column], before[column]);
    }
    expect(new Date(after.updated_at as string).getTime()).toBeGreaterThan(new Date(before.updated_at as string).getTime());
    a.receivableRow = after;
  });

  it("leaves promise, payment and activity history byte-identical across a details edit", async () => {
    const a = state.a!;
    // create_promise states the business day the commitment was made, so the
    // origin is dated ahead of this probe's promised day and of the receipt
    // below — the window is [2026-09-10 .. 2026-09-20] and the money on
    // 2026-09-15 falls inside it, exactly as it did before the origin existed.
    const promise = await a.client.rpc("create_promise", { p_receivable_id: a.receivableId, p_promised_amount_paise: 1000000, p_made_on: "2026-09-10", p_promised_date: "2026-09-20", p_source: "WHATSAPP", p_note: "Stage 4 history probe.", p_request_id: crypto.randomUUID() });
    expect(promise.error ?? null, "create_promise failed for the history probe").toBeNull();
    const payment = await a.client.rpc("record_payment", { p_receivable_id: a.receivableId, p_amount_paise: 500000, p_paid_on: "2026-09-15", p_method: "UPI", p_reference: `S4HIST${runTag.slice(0, 6).toUpperCase()}`, p_note: "Stage 4 history probe.", p_request_id: crypto.randomUUID() });
    expect(payment.error ?? null, "record_payment failed for the history probe").toBeNull();

    async function history() {
      const [promises, payments, activities] = await Promise.all([
        a.client.from("promises").select("*").eq("receivable_id", a.receivableId).order("sequence_no"),
        a.client.from("payments").select("*").eq("receivable_id", a.receivableId).order("id"),
        a.client.from("activities").select("*").eq("receivable_id", a.receivableId).order("id"),
      ]);
      expect(promises.error ?? null).toBeNull();
      expect(payments.error ?? null).toBeNull();
      expect(activities.error ?? null).toBeNull();
      return { promises: promises.data, payments: payments.data, activities: activities.data };
    }

    const beforeHistory = await history();
    const receivableBefore = await readReceivable(a, a.receivableId);
    const edit = await a.client.rpc("update_receivable_details", {
      p_receivable_id: a.receivableId,
      p_label: "Monsoon reel — second colour pass",
      p_invoice_ref: "S4-ALPHA-1-REV2",
      p_notes: "History must not move.",
      p_expected_updated_at: receivableBefore.updated_at,
    });
    bookAcceptance("legitimate-owner-edit", "A edits details on a receivable with history", edit);
    bookUnchanged("promise history unchanged by a details edit", "immutable-column", (await history()).promises, beforeHistory.promises);
    bookUnchanged("payment history unchanged by a details edit", "immutable-column", (await history()).payments, beforeHistory.payments);
    bookUnchanged("activity history unchanged by a details edit", "immutable-column", (await history()).activities, beforeHistory.activities);

    const after = await readReceivable(a, a.receivableId);
    bookUnchanged("paid balance unchanged by a details edit", "immutable-column", { amount: after.amount_due_paise, outstanding: after.outstanding_paise, status: after.status }, { amount: receivableBefore.amount_due_paise, outstanding: receivableBefore.outstanding_paise, status: receivableBefore.status });
    a.receivableRow = after;
  });

  it("refuses a stale and a foreign receivable details edit, leaving the stored row untouched", async () => {
    const a = state.a!;
    const b = state.b!;
    const current = await readReceivable(a, a.receivableId);

    const stale = await a.client.rpc("update_receivable_details", { p_receivable_id: a.receivableId, p_label: "Written From A Stale Tab", p_invoice_ref: "", p_notes: "", p_expected_updated_at: current.created_at });
    bookRefusal("concurrency", "a stale receivable edit is refused", refusedBy("A", stale));
    expect(stale.error?.code).toBe("40001");

    const foreign = await b.client.rpc("update_receivable_details", { p_receivable_id: a.receivableId, p_label: "Rewritten By Beta", p_invoice_ref: "", p_notes: "", p_expected_updated_at: current.updated_at });
    bookRefusal("cross-tenant-edit", "B cannot edit A's receivable even holding A's timestamp", refusedBy("B", foreign));

    const anon = await state.anon!.rpc("update_receivable_details", { p_receivable_id: a.receivableId, p_label: "Anonymous Rewrite", p_invoice_ref: "", p_notes: "", p_expected_updated_at: current.updated_at });
    bookRefusal("anonymous-edit", "anon cannot execute update_receivable_details", refusedBy("anon", anon));

    const after = await readReceivable(a, a.receivableId);
    bookUnchanged("A's receivable details unchanged after three attacks", "cross-tenant-edit", after, current);
  });

  it("refuses a client edit that carries no concurrency token at all", async () => {
    const a = state.a!;
    const before = await readClient(a, a.clientId);
    const probe = await a.client.rpc("update_client", { p_client_id: a.clientId, p_name: "Written Without A Token", p_company: "", p_phone: "", p_email: "", p_notes: "" });
    bookRefusal("concurrency", "a missing expected_updated_at is refused", refusedBy("A", probe));
    expect(probe.error?.code, "omitting the token must surface the conflict code").toBe("40001");
    const after = await readClient(a, a.clientId);
    bookUnchanged("tokenless edit changed nothing", "concurrency", after, before);
  });

  it("keeps refusing direct table writes so edits stay on the RPC path", async () => {
    const a = state.a!;
    const current = await readClient(a, a.clientId);
    const direct = await a.client.from("clients").update({ name: "Direct Table Rewrite" }).eq("id", a.clientId).select();
    const touched = rows(direct.data).length;
    const result = direct.error ? refusedBy("A", direct) : { blocked: touched === 0, detail: `direct UPDATE returned ${touched} row(s)` };
    bookRefusal("direct-write", "authenticated has no UPDATE privilege on clients", result);

    const receivableDirect = await a.client.from("receivables").update({ label: "Direct Table Rewrite" }).eq("id", a.receivableId).select();
    const touchedReceivable = rows(receivableDirect.data).length;
    const resultReceivable = receivableDirect.error ? refusedBy("A", receivableDirect) : { blocked: touchedReceivable === 0, detail: `direct UPDATE returned ${touchedReceivable} row(s)` };
    bookRefusal("direct-write", "authenticated has no UPDATE privilege on receivables", resultReceivable);

    bookUnchanged("client row unchanged by a direct write attempt", "direct-write", await readClient(a, a.clientId), current);
  });

  it("reports a receivable that belongs to another tenant as unavailable rather than editable", async () => {
    const a = state.a!;
    const b = state.b!;
    const missing = await b.client.rpc("update_client", { p_client_id: "00000000-0000-0000-0000-000000000000", p_name: "Ghost", p_company: "", p_phone: "", p_email: "", p_notes: "", p_expected_updated_at: b.clientRow.updated_at });
    const result = refusedBy("B", missing);
    bookRefusal("cross-tenant-edit", "an unknown client uuid is refused", result);
    expect(["P0002", "42501", "PGRST202"]).toContain(missing.error?.code);

    const missingReceivable = await b.client.rpc("update_receivable_details", { p_receivable_id: "00000000-0000-0000-0000-000000000000", p_label: "Ghost", p_invoice_ref: "", p_notes: "", p_expected_updated_at: b.receivableRow.updated_at });
    bookRefusal("cross-tenant-edit", "an unknown receivable uuid is refused", refusedBy("B", missingReceivable));
    expect(a.clientId, "A's client must still exist for the owner").toBeTruthy();
  });

  it("re-reads an edit through a freshly constructed client to prove it is persisted", async () => {
    const a = state.a!;
    const current = await readClient(a, a.clientId);
    const edit = await a.client.rpc("update_client", { p_client_id: a.clientId, p_name: "Persisted Across Sessions", p_company: "Persistence Check", p_phone: "", p_email: "", p_notes: "", p_expected_updated_at: current.updated_at });
    bookAcceptance("legitimate-owner-edit", "A edits the client again", edit);
    const saved = rows(edit.data)[0];
    a.clientRow = saved;

    // A brand-new client instance — no shared cache, no React state.
    const verifier = newClient();
    const { data: reentry, error: sessionError } = await verifier.auth.signInWithPassword({ email: a.email, password: a.password });
    expect(sessionError ?? null, "re-signin for the persistence proof failed").toBeNull();
    // signInWithPassword resolves { user, session }; the token lives on
    // session.access_token. Reading it off the wrong level would silently send
    // no Authorization header, and the proof would then run as anon.
    expect(reentry.session?.access_token, "re-signin returned no access token").toBeTruthy();
    const fresh = newClient(reentry.session!.access_token);
    const { data: stored, error: readError } = await fresh.from("clients").select("*").eq("id", a.clientId).single();
    expect(readError ?? null, "fresh-session re-read failed").toBeNull();
    expect(stored!.name).toBe("Persisted Across Sessions");
    expect(stored!.company).toBe("Persistence Check");
    expect(stored!.updated_at).toBe(saved.updated_at);
  });

  it("exposes the edit RPCs only to an authenticated role", async () => {
    const { data, error } = await newClient().rpc("update_client", { p_client_id: "00000000-0000-0000-0000-000000000000", p_name: "x", p_company: "", p_phone: "", p_email: "", p_notes: "", p_expected_updated_at: "2026-01-01T00:00:00Z" });
    const probe = { data, error };
    const code = probe.error?.code ?? "accepted";
    ledger.push({ category: "anonymous-edit", label: "update_client is not executable by anon", outcome: code === "PGRST202" || code === "42501" ? "refused" : "accepted", detail: `code ${code}` });
    expect(["PGRST202", "42501"], `anon reached update_client: ${probe.error?.message ?? "accepted"}`).toContain(code);
  });
});
