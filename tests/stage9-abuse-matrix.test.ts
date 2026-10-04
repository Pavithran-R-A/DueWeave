import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addIndiaBusinessDays } from "@/lib/finance";
import { todayInIndia } from "@/lib/business-clock";

// Stage 9 PHASE 11, items 6 and 7: a malformed record id or idempotency key, and an
// impossible promise date window, on the public surface. Every other suite here treats
// the codes this file asserts as evidence of nothing — `MALFORMED_CODES` in the Stage 3
// and Stage 8 harnesses refuses to book 22P02 as a security win, because a malformed
// probe usually means the test file typed something wrong. That discipline is right, and
// it left a hole: no suite ever asserted the format path itself, and the promise window
// guard in the Stage 5 migration was only ever read, never reached over the wire.
//
// So the claim here is deliberately narrower than the other suites'. It does not test
// who may do what — Stage 3 and Stage 8 own that and their assertions stand. It tests
// three things only this battery can prove:
//
//   1. a literal that is not an id is refused on every ledger write the browser can
//      reach, instead of quietly reaching a row;
//   2. the refusal is worded without naming a table, column, policy, constraint,
//      grant or stack frame, so nothing internal survives the trip towards the user;
//   3. the refusal leaves the ledger exactly as it was, so a rejected request cannot
//      consume an idempotency key, move a balance, or speak for a follow-up.
//
// Because the claim rests on the refusals being about the *literal*, the suite opens
// with a control that the same account's own well-formed ids are accepted. A renamed
// function, a lost grant or a typo in this file then shows up as a failed control,
// not as a suite full of reassuring refusals.

const url = process.env.VITE_SUPABASE_URL ?? "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";
const isLoopbackStack = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/i.test(url);
const describeLocalStack = isLoopbackStack && anonKey.length > 0 ? describe : describe.skip;

const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailFor = (label: string) => `stage9abuse-${label}-${runTag}@dueweave.local`;
const newPassword = () => `Stage9a!${Math.random().toString(36).slice(2, 12)}aA`;

const localDbContainer = process.env.STAGE9_LOCAL_DB_CONTAINER ?? "supabase_db_dueweave";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function localAdmin(sql: string) {
  return String(
    execFileSync("docker", ["exec", "-i", localDbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-f", "-"], {
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    })
  ).trim();
}

// Fixture cleanup only: the two accounts this file signed up. The history guards
// refuse DELETE even to the table owner — which is the Stage 5 immutability claim,
// and this suite must not weaken it to tidy itself up — so the purge uses the same
// one-transaction, superuser-local `session_replication_role` step the Stage 4 and
// Stage 5 purges use, and reports the guard state afterwards instead of trusting it.
// No table is emptied and no other suite's rows are in range.
const PROTECTED_HISTORY_TRIGGERS = ["activities_immutable", "payments_immutable", "promise_events_immutable", "promises_guard_history"];

function purgeFixtures() {
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
  const owned = tables.map(([table, column]) => `  delete from ${table} where ${column} in (select id from auth.users where email like 'stage9abuse-%-${runTag}@dueweave.local');`).join("\n");
  const result = localAdmin(`begin;
set local session_replication_role = replica;
${owned}
  delete from auth.users where email like 'stage9abuse-%-${runTag}@dueweave.local';
commit;
select 'residue=' || count(*) from auth.users where email like 'stage9abuse-%-${runTag}@dueweave.local';
select 'guards=' || count(*) filter (where tgenabled = 'O') || '/' || count(*) from pg_trigger where tgname in (${PROTECTED_HISTORY_TRIGGERS.map((trigger) => `'${trigger}'`).join(",")});`);
  assert(result.includes("residue=0"), `the abuse fixtures were not fully purged: ${result}`);
  assert(result.includes(`guards=${PROTECTED_HISTORY_TRIGGERS.length}/${PROTECTED_HISTORY_TRIGGERS.length}`), `the purge left a history guard disabled: ${result}`);
}

function newClient(accessToken?: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Probe = { error: PostgrestError | null };

// The nouns a refusal must not reach a reader with. Measured against the real provider
// text for every probe in this file: a format refusal names the SQL type it could not
// parse and echoes the caller's own literal back, which is the caller's data rather
// than the database's. Details and hint are folded in, so a hint that turned into
// operator advice — "GRANT … TO authenticated" — would fail here instead of being
// admired for its helpfulness. `datestyle` is in the list because it is measured in a
// real hint (see the declared advice below), not because it is a hypothesis.
const INTERNAL_LANGUAGE = /receivables|payments|promises|clients|activities|profiles|founder_|owner_id|request_id|client_id|promise_id|row-level|policy|constraint|relation|GRANT|PGRST|SQLSTATE|schema cache|stack|traceback|at line|near line|datestyle/i;

// The one sentence this file measures where Postgres adds advice meant for an operator
// rather than for anyone in the product: an out-of-range date field draws a suggestion
// about the server's own datestyle setting. It is declared here instead of being
// quietly folded into the scan, and it stays out of the reader's reach for a reason
// that is proven elsewhere — the repositories build their error from `message` and
// `code` alone, which tests/stage6-error-copy.test.ts pins by feeding this very
// sentence-shaped text through the real repository code. A probe carrying advice that
// is not this sentence still fails this file.
const MEASURED_DATE_ADVICE = 'Perhaps you need a different "datestyle" setting.';

function providerText(error: PostgrestError) {
  return [error.message, error.details, error.hint].filter(Boolean).join(" / ");
}

type Entry = { probe: string; outcome: string; code: string; text: string };
const ledger: Entry[] = [];

function expectRefused(who: string, probe: Probe, allowedCodes: string[], echoedValue?: unknown, declaredAdvice?: string) {
  const error = probe.error;
  if (!error) {
    ledger.push({ probe: who, outcome: "accepted", code: "-", text: "expected a refusal" });
    throw new Error(`${who} — expected a refusal, got an accepted request`);
  }
  const code = error.code ?? "P0000";
  const text = providerText(error);
  assert(allowedCodes.includes(code), `${who} — expected one of ${allowedCodes.join(", ")}, got ${code}: ${text}`);
  // A parse error quotes the value it could not parse, so the caller's own literal is
  // in the reply. Removing it first is what makes this scan mean something: without
  // that step the suite would flag the attacker's words as the database's, and the one
  // payload worth testing ("'); DROP TABLE payments; --") would fail for the wrong
  // reason. What has to stay clean is everything the provider adds on its own.
  const withoutCallersInput = typeof echoedValue === "string" ? text.split(echoedValue).join("") : text;
  const withoutDeclaredAdvice = declaredAdvice ? withoutCallersInput.split(declaredAdvice).join("") : withoutCallersInput;
  assert(!declaredAdvice || withoutCallersInput !== withoutDeclaredAdvice, `${who} — declared provider advice that the reply does not contain: ${text}`);
  const leaked = withoutDeclaredAdvice.match(INTERNAL_LANGUAGE);
  assert(!leaked, `${who} — refusal named internal database language ("${leaked?.[0]}") in: ${text}`);
  ledger.push({ probe: who, outcome: "refused", code, text });
  return text;
}

function expectAccepted(who: string, probe: Probe) {
  const detail = probe.error ? `${probe.error.code}: ${providerText(probe.error)}` : "accepted";
  ledger.push({ probe: who, outcome: probe.error ? "refused" : "accepted", code: probe.error?.code ?? "-", text: detail });
  assert(!probe.error, `${who} — expected acceptance: ${detail}`);
}

// Shapes are driven into every id slot on the write surface rather than one token per
// case, because a shape problem is the same problem wherever it lands. The last entry
// is a missing value rather than a bad one: the functions are expected to notice it and
// answer with their own guard, whose code differs per function (P0001 or P0002), so its
// expectation is a pair of codes rather than a guess.
function malformedLiterals(realId: string): Array<{ label: string; value: unknown; codes: string[] }> {
  return [
    { label: "a bare word", value: "not-a-uuid", codes: ["22P02"] },
    { label: "a single digit", value: "1", codes: ["22P02"] },
    { label: "an empty string", value: "", codes: ["22P02"] },
    { label: "a single space", value: " ", codes: ["22P02"] },
    { label: "the SQL null keyword as text", value: "null", codes: ["22P02"] },
    { label: "the JavaScript undefined keyword as text", value: "undefined", codes: ["22P02"] },
    { label: "a percentage sign", value: "%", codes: ["22P02"] },
    { label: "PostgREST filter syntax", value: "or(id.gt.0)", codes: ["22P02"] },
    { label: "a SQL comment payload", value: "'); DROP TABLE payments; --", codes: ["22P02"] },
    { label: "hex-shaped but not base-16", value: "0x01010101-0101-0101-0101-010101010101", codes: ["22P02"] },
    { label: "ten thousand characters", value: "x".repeat(10_000), codes: ["22P02"] },
    { label: "a real id with its tail cut off", value: realId.slice(0, 20), codes: ["22P02"] },
    { label: "a real id wrapped in spaces", value: ` ${realId} `, codes: ["22P02"] },
    { label: "no value at all", value: null, codes: ["P0001", "P0002"] },
  ];
}

type Ids = { receivableId: string; clientId: string; promiseId: string };

// The write surface the browser can actually reach, named by the slot under attack.
// `slot` is which argument is fed the bad value, `foreign` is the id this suite attacks
// when it wants a real row that simply is not the caller's, and `null` marks a slot
// where a genuine foreign row is not something the product claims to distinguish.
// The Founder reviewer RPCs are absent on purpose: their arguments are checked against
// a reviewer's authority, which is Stage 8's claim, and a refusal there would be
// indistinguishable from a format refusal here.
function writeSurface(): Array<{ slot: string; rpc: string; foreign: keyof Ids | null; args: (ids: Ids, value: unknown) => Record<string, unknown> }> {
  return [
    { slot: "record_payment's receivable id", rpc: "record_payment", foreign: "receivableId", args: (ids, value) => ({ p_receivable_id: value, p_amount_paise: 1000, p_paid_on: "2026-09-20", p_method: "UPI", p_reference: "abuse probe", p_request_id: crypto.randomUUID() }) },
    { slot: "record_payment's request id", rpc: "record_payment", foreign: null, args: (ids, value) => ({ p_receivable_id: ids.receivableId, p_amount_paise: 1000, p_paid_on: "2026-09-20", p_method: "UPI", p_reference: "abuse probe", p_request_id: value }) },
    { slot: "create_promise's receivable id", rpc: "create_promise", foreign: "receivableId", args: (ids, value) => ({ p_receivable_id: value, p_promised_amount_paise: 1000, p_made_on: "2026-09-20", p_promised_date: "2026-10-01", p_source: "CALL", p_note: "", p_request_id: crypto.randomUUID() }) },
    { slot: "create_promise's request id", rpc: "create_promise", foreign: null, args: (ids, value) => ({ p_receivable_id: ids.receivableId, p_promised_amount_paise: 1000, p_made_on: "2026-09-20", p_promised_date: "2026-10-01", p_source: "CALL", p_note: "", p_request_id: value }) },
    { slot: "create_receivable's client id", rpc: "create_receivable", foreign: "clientId", args: (ids, value) => ({ p_client_id: value, p_label: "abuse probe", p_invoice_ref: "ABUSE-1", p_amount_due_paise: 1000, p_due_date: "2026-10-01" }) },
    { slot: "update_receivable_details's receivable id", rpc: "update_receivable_details", foreign: "receivableId", args: (ids, value) => ({ p_receivable_id: value, p_label: "hijacked label" }) },
    { slot: "update_client's client id", rpc: "update_client", foreign: "clientId", args: (ids, value) => ({ p_client_id: value, p_name: "hijacked name" }) },
    { slot: "cancel_receivable's receivable id", rpc: "cancel_receivable", foreign: "receivableId", args: (ids, value) => ({ p_receivable_id: value, p_reason: "abuse probe" }) },
    { slot: "cancel_promise's promise id", rpc: "cancel_promise", foreign: "promiseId", args: (ids, value) => ({ p_promise_id: value, p_reason: "abuse probe" }) },
    { slot: "record_contacted's receivable id", rpc: "record_contacted", foreign: "receivableId", args: (ids, value) => ({ p_receivable_id: value, p_note: "abuse probe" }) },
    { slot: "snooze_receivable's receivable id", rpc: "snooze_receivable", foreign: "receivableId", args: (ids, value) => ({ p_receivable_id: value, p_until: addIndiaBusinessDays(todayInIndia(), 30) }) },
  ];
}

type Snapshot = { receivables: unknown[]; payments: unknown[]; promises: unknown[]; clients: unknown[]; activities: unknown[] };

async function snapshot(client: SupabaseClient): Promise<Snapshot> {
  const read = async (table: keyof Snapshot) => {
    const { data, error } = await client.from(table).select("*");
    assert(!error, `the owner could not read back their own ${table}: ${error?.message}`);
    return data ?? [];
  };
  return { receivables: await read("receivables"), payments: await read("payments"), promises: await read("promises"), clients: await read("clients"), activities: await read("activities") };
}

// Row identity, not row content: a battery that wrote nothing leaves the set of primary
// keys exactly as it found it, and that is the whole claim. Money arithmetic is re-read
// separately where it matters.
function identity(of: Snapshot) {
  const ids = (rows: unknown[]) => rows.map((row) => (row as { id: string }).id).sort().join(",");
  return [`receivables=${ids(of.receivables)}`, `payments=${ids(of.payments)}`, `promises=${ids(of.promises)}`, `clients=${ids(of.clients)}`, `activities=${ids(of.activities)}`].join("|");
}

type Account = { client: SupabaseClient; accessToken: string; ids: Ids; label: string };

async function bootstrapLedger(label: string): Promise<Account> {
  const signUp = await newClient().auth.signUp({ email: emailFor(label), password: newPassword(), options: { data: { display_name: `Stage 9 ${label}` } } });
  assert(!!signUp.data.session && !!signUp.data.user, `${label} signup failed: ${signUp.error?.message ?? "no session returned"}`);
  const accessToken = signUp.data.session!.access_token;
  const client = newClient(accessToken);
  // The product's own workspace-setup write, scoped to the owner's single row.
  const profile = await client.from("profiles").update({ display_name: `Stage 9 ${label}`, business_name: `DueWeave Abuse Probe ${label}` }).eq("id", signUp.data.user!.id);
  assert(!profile.error, `${label} workspace setup failed: ${profile.error?.message}`);
  const createdClient = await client.rpc("create_client", { p_name: `Probe Client ${label}`, p_company: "", p_phone: "", p_email: "", p_notes: "" });
  assert(!createdClient.error && !!createdClient.data, `${label} client fixture failed: ${createdClient.error?.message}`);
  const clientId = (createdClient.data as { id: string }).id;
  const createdReceivable = await client.rpc("create_receivable", { p_client_id: clientId, p_label: `Probe Invoice ${label}`, p_invoice_ref: "PB-1", p_amount_due_paise: 500_000, p_due_date: "2026-10-01", p_notes: "" });
  assert(!createdReceivable.error && !!createdReceivable.data, `${label} receivable fixture failed: ${createdReceivable.error?.message}`);
  const receivableId = (createdReceivable.data as { id: string }).id;
  // The victim's promise has to be one the product still grades ACTIVE: the assertion
  // below reads its stored status after the attack was refused, and a promise whose date
  // has passed is graded BROKEN by any sweep that reaches it. Frozen here, the fixture
  // quietly changed meaning the day its date went past.
  const createdPromise = await client.rpc("create_promise", { p_receivable_id: receivableId, p_promised_amount_paise: 100_000, p_made_on: "2026-09-20", p_promised_date: addIndiaBusinessDays(todayInIndia(), 3), p_source: "CALL", p_note: "", p_request_id: crypto.randomUUID() });
  assert(!createdPromise.error && !!createdPromise.data, `${label} promise fixture failed: ${createdPromise.error?.message}`);
  return { client, accessToken, label, ids: { clientId, receivableId, promiseId: (createdPromise.data as { id: string }).id } };
}

async function rest(account: Account, path: string, init: RequestInit = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: anonKey, Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers },
  });
  return { status: response.status, body: (await response.json()) as PostgrestError };
}

describeLocalStack("Stage 9 malformed id and request-id abuse", () => {
  let owner: Account;
  let other: Account;

  beforeAll(async () => {
    owner = await bootstrapLedger("owner");
    other = await bootstrapLedger("neighbour");
  }, 90_000);

  afterAll(() => {
    mkdirSync(path.resolve("test-results"), { recursive: true });
    writeFileSync(path.resolve("test-results", "stage9-abuse-matrix.json"), `${JSON.stringify({ runTag, probes: ledger.length, ledger }, null, 2)}\n`);
    purgeFixtures();
  });

  it("accepts the account's own well-formed ids before claiming anything about refusals", async () => {
    expectAccepted("control: record_payment against the account's own receivable", await owner.client.rpc("record_payment", { p_receivable_id: owner.ids.receivableId, p_amount_paise: 250_000, p_paid_on: "2026-09-20", p_method: "UPI", p_reference: "control", p_request_id: crypto.randomUUID() }));
    expectAccepted("control: record_contacted against the account's own receivable", await owner.client.rpc("record_contacted", { p_receivable_id: owner.ids.receivableId, p_note: "control" }));
    // Measured: an edit without the stored token is refused with 40001, which is Stage
    // 4's honest-edit contract and not a malformed-id path. The control therefore reads
    // the token back and passes it, so this suite never mistakes a concurrency refusal
    // for the refusals it is trying to prove.
    const stored = await owner.client.from("clients").select("updated_at").eq("id", owner.ids.clientId).maybeSingle();
    assert(!stored.error, `the account could not read their own client back: ${stored.error?.message}`);
    expectAccepted("control: update_client against the account's own client", await owner.client.rpc("update_client", { p_client_id: owner.ids.clientId, p_name: "Probe Client owner renamed", p_expected_updated_at: (stored.data as { updated_at: string }).updated_at }));
  }, 60_000);

  it("refuses every malformed id on the ledger's write surface, without naming internals", async () => {
    const before = await snapshot(owner.client);
    for (const target of writeSurface()) {
      for (const literal of malformedLiterals(owner.ids.receivableId)) {
        expectRefused(`${target.slot} = ${literal.label}`, await owner.client.rpc(target.rpc, target.args(owner.ids, literal.value) as never), literal.codes, literal.value);
      }
    }
    const after = await snapshot(owner.client);
    ledger.push({ probe: "state after the whole battery", outcome: identity(before) === identity(after) ? "unchanged" : "changed", code: "-", text: "" });
    expect(identity(after), "a malformed id wrote a row somewhere in this account's ledger").toBe(identity(before));
    // 154 provider round-trips on one shared Postgres. Measured at 4.6s on a quiet
    // machine and above Vitest's 5s default on a busy one, so the budget is stated
    // rather than left to a retry.
  }, 120_000);

  it("answers a neighbour's real id with the same words as an id that exists nowhere", async () => {
    // Measured, then asserted: both shapes refuse with "… is not available for this
    // account", so a refusal cannot be used to ask whether another account's row
    // exists. That is the property that makes this surface safe to expose at all.
    const neverUsed = crypto.randomUUID();
    for (const target of writeSurface()) {
      if (target.foreign === null) continue;
      const nowhereText = expectRefused(`${target.slot} with an id that exists nowhere`, await owner.client.rpc(target.rpc, target.args(owner.ids, neverUsed) as never), ["P0001", "P0002"]);
      const foreignProbe = await owner.client.rpc(target.rpc, target.args(owner.ids, other.ids[target.foreign]) as never);
      const foreignText = expectRefused(`${target.slot} with another account's real id`, foreignProbe, ["P0001", "P0002"]);
      assert(nowhereText === foreignText, `${target.slot} distinguishes a neighbour's id from one that exists nowhere, so the refusal leaks which rows are there: "${nowhereText}" vs "${foreignText}"`);
      ledger.push({ probe: `${target.slot} wording`, outcome: "observed", code: "identical", text: nowhereText });
    }
    const neighbour = await snapshot(other.client);
    expect(neighbour.promises.length, "an attempt on a neighbour's promise reached the neighbour's ledger").toBe(1);
    const stillOpen = await other.client.from("promises").select("status").eq("id", other.ids.promiseId).maybeSingle();
    assert(!stillOpen.error, `the neighbour could not read their own promise: ${stillOpen.error?.message}`);
    expect((stillOpen.data as { status: string }).status, "the neighbour's promise no longer holds its own status").toBe("ACTIVE");
  }, 60_000);

  it("keeps a rejected payment from consuming the account's next legitimate request id", async () => {
    const before = await snapshot(owner.client);
    expectRefused("record_payment with a malformed request id", await owner.client.rpc("record_payment", { p_receivable_id: owner.ids.receivableId, p_amount_paise: 5_000, p_paid_on: "2026-09-21", p_method: "UPI", p_reference: "rejected", p_request_id: "not-a-uuid" }), ["22P02"]);
    // The same legitimate request, with a real key, must still work afterwards: a
    // rejected attempt had to leave no half-written idempotency row behind.
    expectAccepted("record_payment retried with a well-formed request id", await owner.client.rpc("record_payment", { p_receivable_id: owner.ids.receivableId, p_amount_paise: 5_000, p_paid_on: "2026-09-21", p_method: "UPI", p_reference: "retried", p_request_id: crypto.randomUUID() }));
    const after = await snapshot(owner.client);
    const added = (after.payments as unknown[]).length - (before.payments as unknown[]).length;
    ledger.push({ probe: "payments after reject-then-retry", outcome: "observed", code: String(added), text: "" });
    expect(added, "the rejected attempt also wrote a payment, when only the retry should have").toBe(1);
  }, 60_000);

  it("refuses a malformed id inside a REST filter instead of answering with rows", async () => {
    for (const [filter, value, codes, status] of [
      ["id=eq.not-a-uuid", "not-a-uuid", ["22P02"], 400],
      ["id=neq.not-a-uuid", "not-a-uuid", ["22P02"], 400],
      ["id=gt.not-a-uuid", "not-a-uuid", ["22P02"], 400],
      ["id=not.in.(not-a-uuid)", "not-a-uuid", ["22P02"], 400],
      ["id=in.(not-a-uuid)", "not-a-uuid", ["22P02"], 400],
      ["id=eq.0x01010101-0101-0101-0101-010101010101", "0x01010101-0101-0101-0101-010101010101", ["22P02"], 400],
      // `like` is the one shape a uuid column cannot answer with a cast error: PostgREST
      // cannot resolve the operator at all, and reports that as a 404 carrying SQLSTATE
      // 42883. Measured through the browser role, and the product never sends it (no
      // screen filters an id with a pattern) — so it is refused here as a refusal, with
      // its own status and code stated rather than quietly folded into the others.
      ["id=like.not-a-uuid", "not-a-uuid", ["42883"], 404],
    ] as const) {
      const response = await rest(owner, `receivables?select=*&${filter}`);
      assert(response.status === status, `GET receivables?${filter} answered ${response.status}, expected ${status}`);
      expectRefused(`GET receivables filtered by ${filter}`, { error: response.body }, codes, value);
    }
    // The dangerous shape is a write filtered by a malformed id: it has to refuse, not
    // match nothing and report success.
    //
    // The wording guard here was falsified rather than trusted. Measured by temporarily
    // feeding it the direct-write refusal this suite does not otherwise send: `POST
    // receivables` answers 403 with "permission denied for table receivables" and a
    // "GRANT INSERT ON public.receivables TO authenticated" hint, and the guard failed
    // the run on it. That path stays Stage 3's claim — the product reaches no table
    // directly — which is why it is not asserted permanently here.
    for (const method of ["PATCH", "DELETE"] as const) {
      const response = await rest(owner, "receivables?id=eq.not-a-uuid", { method, body: JSON.stringify({ label: "hijacked" }) });
      assert(response.status === 400, `${method} receivables?id=eq.not-a-uuid answered ${response.status} instead of refusing`);
      expectRefused(`${method} receivables filtered by a malformed id`, { error: response.body }, ["22P02"], "not-a-uuid");
    }
    const mine = await owner.client.from("receivables").select("label, status").eq("id", owner.ids.receivableId).maybeSingle();
    assert(!mine.error, `the account could not read their own receivable back: ${mine.error?.message}`);
    expect((mine.data as { label: string }).label, "the REST abuse renamed this account's receivable").toBe("Probe Invoice owner");
    ledger.push({ probe: "own receivable after REST abuse", outcome: "unchanged", code: "-", text: JSON.stringify(mine.data) });
  }, 60_000);

  it("records an idempotency key as the owner-scoped token it is, not an id to validate", async () => {
    // Measured, and deliberately recorded instead of assumed: `00000000-…` parses as an
    // id, so it is accepted in the request-id slot. That is not a hole in this suite's
    // claim, because the key is only ever matched inside (owner, request_id) — a
    // hand-made key can address one row of the caller's own ledger and nothing else.
    // Asserting a refusal here would assert something the design never promised.
    const nilKey = "00000000-0000-0000-0000-000000000000";
    const before = await snapshot(owner.client);
    expectAccepted("record_payment keyed by the all-zero request id", await owner.client.rpc("record_payment", { p_receivable_id: owner.ids.receivableId, p_amount_paise: 10_000, p_paid_on: "2026-09-22", p_method: "UPI", p_reference: "nil key", p_request_id: nilKey }));
    expectAccepted("the same request id replayed", await owner.client.rpc("record_payment", { p_receivable_id: owner.ids.receivableId, p_amount_paise: 10_000, p_paid_on: "2026-09-22", p_method: "UPI", p_reference: "nil key", p_request_id: nilKey }));
    const after = await snapshot(owner.client);
    const written = (after.payments as Array<{ request_id: string }>).filter((payment) => payment.request_id === nilKey);
    expect(written.length, "a replayed request id wrote a second payment").toBe(1);
    expect((after.payments as unknown[]).length - (before.payments as unknown[]).length, "the nil key reached beyond one row of this ledger").toBe(1);
    const neighbour = await other.client.from("payments").select("id").eq("request_id", nilKey);
    assert(!neighbour.error, `the neighbour could not read their own payments: ${neighbour.error?.message}`);
    expect(neighbour.data, "the nil key was visible in another account's ledger").toEqual([]);
    ledger.push({ probe: "nil request id replay", outcome: "observed", code: "one row", text: "idempotency is per owner, so a hand-made key is not an authority" });
  }, 60_000);

  it("holds the promise window open on the server, not only in the form", async () => {
    // PHASE 11 item 6. The browser has refused a backwards promise window since Stage 6
    // (`e2e/stage6-local-forms.spec.ts`), and the copy layer has mapped the server's
    // words since then too — but nothing ever sent the impossible window straight to
    // `create_promise`, so the guard in the migration was only ever read, never reached.
    // A client-side rule with no server counterpart is a rule a determined caller walks
    // through, which is exactly what this stage is meant to falsify.
    const today = todayInIndia();
    const create = (madeOn: string | null, promisedDate: string | null) =>
      owner.client.rpc("create_promise", { p_receivable_id: owner.ids.receivableId, p_promised_amount_paise: 20_000, p_made_on: madeOn, p_promised_date: promisedDate, p_source: "CALL", p_note: "", p_request_id: crypto.randomUUID() });

    // The control is the shape a real call takes: origin today, deadline later. Without
    // it the refusals below would be indistinguishable from a broken fixture.
    const before = await snapshot(owner.client);
    expectAccepted("control: a promise window that runs forward", await create(today, addIndiaBusinessDays(today, 3)));
    // And one more control, because "made today, promised today" is a commitment a
    // client can genuinely make: the guard is `>` and not `>=`.
    expectAccepted("control: a promise due the same day it was made", await create(today, today));

    for (const [label, madeOn, promisedDate, refusal] of [
      ["the deadline behind the day it was made", addIndiaBusinessDays(today, 1), today, /promise date cannot be earlier than the day the promise was made/i],
      ["dated as made in the future", addIndiaBusinessDays(today, 2), addIndiaBusinessDays(today, 3), /cannot be dated as made in the future/i],
    ] as const) {
      const text = expectRefused(`create_promise with ${label}`, await create(madeOn, promisedDate), ["P0001"]);
      assert(refusal.test(text), `create_promise with ${label} refused with something else: "${text}"`);
    }

    // A date that is not a date has to be refused by the type, before any of the
    // chronology arithmetic runs. Measured per shape, because the three codes are not
    // interchangeable: 22007 is a string the date parser cannot read at all, 22008 is
    // readable but out of range (a month 13, a February 30th), and 22P02 is what the
    // uuid slots answer. Pinning all three as if they were one would let a genuine
    // parse change hide behind a passing suite.
    const dateShapes: Array<{ literal: string; codes: string[]; advice?: string }> = [
      { literal: "not-a-date", codes: ["22007"] },
      { literal: "2026-13-45", codes: ["22008"], advice: MEASURED_DATE_ADVICE },
      { literal: "2026-02-30", codes: ["22008"] },
      { literal: "", codes: ["22007"] },
      { literal: " ", codes: ["22007"] },
    ];
    for (const shape of dateShapes) {
      for (const slot of ["made on", "promised date"] as const) {
        const args = { p_receivable_id: owner.ids.receivableId, p_promised_amount_paise: 20_000, p_made_on: slot === "made on" ? shape.literal : today, p_promised_date: slot === "made on" ? today : shape.literal, p_source: "CALL", p_note: "", p_request_id: crypto.randomUUID() };
        expectRefused(`create_promise with a malformed ${slot}`, await owner.client.rpc("create_promise", args as never), shape.codes, shape.literal, shape.advice);
      }
    }

    const after = await snapshot(owner.client);
    const added = (after.promises as unknown[]).length - (before.promises as unknown[]).length;
    ledger.push({ probe: "promises after the chronology battery", outcome: "observed", code: String(added), text: "" });
    expect(added, "an impossible promise window still wrote a row").toBe(2);
    // The refused windows left no trace of their own: every promise now on this ledger
    // is one of the two the controls above legitimately opened.
    const sameOwner = (after.promises as Array<{ receivable_id: string }>).every((promise) => promise.receivable_id === owner.ids.receivableId);
    expect(sameOwner, "a refused promise window reached a receivable this account does not own").toBe(true);
  }, 60_000);

  it("holds the phone rule on the create verb, not only on the edit verb", async () => {
    // Residual gap 1 in docs/STAGE9_ABUSE_MATRIX.md. Stage 4 applies the shared input rules to
    // `update_client`, five-digit phone included, and the browser form has refused a short phone
    // since Stage 6 — but no live test ever drove a malformed phone into a create verb, so the
    // rule was proven on the verb that edits and unproven on the verb that creates.
    //
    // The rule is read out of `assert_stage3_client_input` (20260812170000_stage3_core_workflows.sql)
    // rather than invented: strip to digits and a leading plus, then require 10 to 15 digits to be a
    // phone at all. Two consequences are pinned here because a reader would not guess them, and both
    // are measured rather than assumed: input carrying no digits at all is "leave it blank" and is
    // stored as no phone, while a lone "+" is phone-shaped input with too few digits and is refused.
    const before = await snapshot(owner.client);
    const nameFor = (label: string) => `Abuse Phone ${label} ${runTag.slice(-4)}`;
    const createWith = (name: string, phone: string) =>
      owner.client.rpc("create_client", { p_name: name, p_company: "", p_phone: phone, p_email: "", p_notes: "" });

    // Controls: the formats the field itself invites ("any Indian format you already use").
    const international = await createWith(nameFor("international"), "+91 98765 43210");
    expectAccepted("control: create_client with '+91 98765 43210'", international);
    expect((international.data as { phone: string }).phone, "the create verb stores what it says it stores").toBe("+919876543210");
    const noDigits = await createWith(nameFor("letters"), "call me later");
    expectAccepted("create_client with a digit-free phone leaves it blank", noDigits);
    expect((noDigits.data as { phone: string | null }).phone, "input with no digits is 'leave it blank', not a malformed phone").toBeNull();

    for (const [label, phone] of [["a five-digit phone", "12345"], ["a sixteen-digit phone", "1234567890123456"], ["a lone plus sign", "+"]] as const) {
      const text = expectRefused(`create_client with ${label}`, await createWith(nameFor(label.replace(/[^a-z]/g, "")), phone), ["P0001"]);
      assert(/valid phone number/i.test(text), `create_client with ${label} refused with something else: "${text}"`);
    }

    // The composite verb is the one the product's Add-receivable form actually calls, so the
    // refusal has to reach it too: a rule that only holds on the inner verb is a rule the
    // composite could walk past.
    const composite = await owner.client.rpc("create_client_and_receivable", {
      p_client_name: nameFor("composite"), p_company: "", p_phone: "12345", p_email: "", p_client_notes: "",
      p_label: "Abuse phone invoice", p_invoice_ref: "AP-1", p_amount_due_paise: 1_000, p_due_date: addIndiaBusinessDays(todayInIndia(), 3), p_notes: "",
    });
    const compositeText = expectRefused("create_client_and_receivable with a five-digit phone", composite, ["P0001"]);
    assert(/valid phone number/i.test(compositeText), `the composite verb refused with something else: "${compositeText}"`);

    const after = await snapshot(owner.client);
    expect((after.clients as unknown[]).length - (before.clients as unknown[]).length, "a refused phone still opened a client row").toBe(2);
    expect((after.receivables as unknown[]).length - (before.receivables as unknown[]).length, "the refused composite write still opened a receivable").toBe(0);
  }, 60_000);

  it("refuses a required ledger field that is blank in the class the browser trims", async () => {
    // Residual gap 2 in docs/STAGE9_ABUSE_MATRIX.md, and the ledger's half of the repair
    // Stage 8 made to the Founder fields.
    //
    // `btrim(x)` with no second argument strips the ASCII space and nothing else, so a
    // client name, receivable label or cancellation reason made of tabs, newlines,
    // non-breaking spaces or ideographic spaces was content to the database and blank to
    // the form that refuses it. Measured before this test existed, the literal that
    // `client/src/components/sheets.tsx` refuses with `!form.name.trim()` reached a row.
    // The cancellation reason is the worst of the three: it lands in `activities.note` and
    // in the promise outcome, so an invisible reason authorised a cancellation and wrote
    // itself into the owner's own history.
    //
    // The rule this pins is the one the browser already enforces, and it is deliberately
    // only as wide as the browser: edge-trim with the characters JavaScript's `trim()`
    // removes, refuse the result when the field is required, and leave optional text
    // carrying what its owner typed. U+200B stays significant because `trim()` keeps it —
    // the class is matched to the client, not widened past it, exactly as Stage 8 decided
    // for `c_ws`.
    const account = await bootstrapLedger("blank");
    const before = await snapshot(account.client);
    const hex = (character: string) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
    const stamp = async (table: "clients" | "receivables", id: string) => {
      assert(id, `no ${table} id was available to stamp, so an earlier control did not return its row`);
      const { data, error } = await account.client.from(table).select("updated_at").eq("id", id).single();
      assert(!error && !!data, `the probe account could not re-read its own ${table} row: ${error?.message}`);
      return (data as { updated_at: string }).updated_at;
    };
    const dueDate = addIndiaBusinessDays(todayInIndia(), 3);

    // The ECMAScript WhiteSpace and LineTerminator production, by codepoint — the same
    // list tests/stage8-founder-contracts.test.ts uses to prove the Founder class.
    const blanks = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
      0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]
      .map((code) => String.fromCharCode(code));

    let controlReceivableId = "";
    const required: Array<{ field: string; wording: RegExp; blank: (value: string) => Promise<Probe>; control: () => Promise<Probe> }> = [
      {
        field: "create_client's p_name",
        wording: /client name of up to 160 characters/i,
        blank: (value) => account.client.rpc("create_client", { p_name: value, p_company: "", p_phone: "", p_email: "", p_notes: "" }),
        control: () => account.client.rpc("create_client", { p_name: "Ravi Kumar", p_company: "", p_phone: "", p_email: "", p_notes: "" }),
      },
      {
        field: "update_client's p_name",
        wording: /client name of up to 160 characters/i,
        blank: async (value) => account.client.rpc("update_client", { p_client_id: account.ids.clientId, p_name: value, p_company: "", p_phone: "", p_email: "", p_notes: "", p_expected_updated_at: await stamp("clients", account.ids.clientId) }),
        control: async () => account.client.rpc("update_client", { p_client_id: account.ids.clientId, p_name: "Ravi Kumar", p_company: "", p_phone: "", p_email: "", p_notes: "", p_expected_updated_at: await stamp("clients", account.ids.clientId) }),
      },
      {
        field: "create_receivable's p_label",
        wording: /receivable label of up to 240 characters/i,
        blank: (value) => account.client.rpc("create_receivable", { p_client_id: account.ids.clientId, p_label: value, p_invoice_ref: "", p_amount_due_paise: 1_000, p_due_date: dueDate, p_notes: "" }),
        // The receivable the two edit verbs and the close below are aimed at is the
        // control's own row: a probe that was refused has no row to point at.
        control: async () => {
          const probe = await account.client.rpc("create_receivable", { p_client_id: account.ids.clientId, p_label: "Consulting invoice", p_invoice_ref: "", p_amount_due_paise: 1_000, p_due_date: dueDate, p_notes: "" });
          if (!probe.error) controlReceivableId = (probe.data as { id: string }).id;
          return probe;
        },
      },
      {
        field: "update_receivable_details's p_label",
        wording: /receivable label of up to 240 characters/i,
        blank: async (value) => account.client.rpc("update_receivable_details", { p_receivable_id: controlReceivableId, p_label: value, p_invoice_ref: "", p_notes: "", p_expected_updated_at: await stamp("receivables", controlReceivableId) }),
        control: async () => account.client.rpc("update_receivable_details", { p_receivable_id: controlReceivableId, p_label: "Consulting invoice", p_invoice_ref: "", p_notes: "", p_expected_updated_at: await stamp("receivables", controlReceivableId) }),
      },
      {
        field: "cancel_receivable's p_reason",
        wording: /short reason for closing this receivable/i,
        blank: async (value) => account.client.rpc("cancel_receivable", { p_receivable_id: controlReceivableId, p_reason: value }),
        control: () => account.client.rpc("cancel_receivable", { p_receivable_id: controlReceivableId, p_reason: "The work was never started" }),
      },
      {
        field: "cancel_promise's p_reason",
        wording: /short reason for withdrawing this promise/i,
        blank: async (value) => account.client.rpc("cancel_promise", { p_promise_id: account.ids.promiseId, p_reason: value }),
        control: () => account.client.rpc("cancel_promise", { p_promise_id: account.ids.promiseId, p_reason: "The client went quiet" }),
      },
    ];

    // Every verb is proven live on real content first: without that control a lost grant
    // or a renamed argument would answer each blank probe with a refusal that has nothing
    // to do with whitespace.
    for (const verb of required) {
      expectAccepted(`${verb.field} takes real content`, await verb.control());
      for (const character of blanks) {
        const text = expectRefused(`${verb.field} given three ${hex(character)} only`, await verb.blank(character.repeat(3)), ["P0001"]);
        assert(verb.wording.test(text), `${verb.field} refused a ${hex(character)}-only value with something else: "${text}"`);
      }
    }

    // The composite verb is the one the product's Add-receivable form calls, and it
    // reaches both rules by calling `create_client` and then `create_receivable`. Proving
    // the inner verbs alone would leave a rule the surface the browser uses could walk
    // past. One character per class family is enough here — the class itself is proven
    // whole above — and a refused composite has to leave neither row behind.
    const composite = (name: string, label: string) =>
      account.client.rpc("create_client_and_receivable", {
        p_client_name: name, p_company: "", p_phone: "", p_email: "", p_client_notes: "",
        p_label: label, p_invoice_ref: "", p_amount_due_paise: 1_000, p_due_date: dueDate, p_notes: "",
      });
    expectAccepted("create_client_and_receivable takes real content", await composite("Devi Sharma", "Consulting retainer"));
    const families = [blanks[5], blanks[0], blanks[6], blanks[23], blanks[24]];
    for (const character of families) {
      const nameText = expectRefused(`create_client_and_receivable's p_client_name given three ${hex(character)} only`, await composite(character.repeat(3), "Consulting retainer"), ["P0001"]);
      assert(/client name of up to 160 characters/i.test(nameText), `the composite refused a ${hex(character)}-only name with something else: "${nameText}"`);
      const labelText = expectRefused(`create_client_and_receivable's p_label given three ${hex(character)} only`, await composite("Devi Sharma", character.repeat(3)), ["P0001"]);
      assert(/receivable label of up to 240 characters/i.test(labelText), `the composite refused a ${hex(character)}-only label with something else: "${labelText}"`);
    }

    // The class stops where the browser's stops: a zero-width space is content to
    // `trim()`, so it stays content here instead of becoming a blank the form would let
    // through and the database would refuse.
    const zeroWidth = await account.client.rpc("create_client", { p_name: "\u200B", p_company: "", p_phone: "", p_email: "", p_notes: "" });
    expectAccepted("create_client with a zero-width space, which JavaScript keeps", zeroWidth);

    // Edges only: a name padded at its edges with the trimmed class is normalised to what
    // the owner meant, and a name carrying that character between two letters is left
    // exactly as typed.
    const padded = await account.client.rpc("create_client", { p_name: "\u00A0Ravi\u00A0Kumar\u00A0", p_company: "", p_phone: "", p_email: "", p_notes: "" });
    expectAccepted("create_client with non-breaking edges", padded);
    expect((padded.data as { name: string }).name, "edge trimming reached into the name's content").toBe("Ravi\u00A0Kumar");

    // The rule's other half, stated as behaviour: an optional ledger field keeps the bytes
    // it was given, trimmed of the ASCII space as it has always been. Nothing reads those
    // bytes — no total, no payment URI, no WhatsApp destination — which is why the
    // widening lands on the required fields only.
    const optional = await account.client.rpc("create_receivable", { p_client_id: account.ids.clientId, p_label: "Optional padding probe", p_invoice_ref: "", p_amount_due_paise: 1_000, p_due_date: dueDate, p_notes: "\u00A0\u00A0" });
    expectAccepted("create_receivable with non-breaking notes", optional);
    expect((optional.data as { notes: string }).notes, "an optional field was rewritten by the required-field rule").toBe("\u00A0\u00A0");

    const after = await snapshot(account.client);
    // 160 blank probes wrote nothing. The rows that exist are the four controls that each
    // created something — the client, the receivable, the composite, and the one the
    // receivable-edit control edited without creating — plus the zero-width and
    // padded-edge clients and the optional-notes receivable.
    expect((after.clients as unknown[]).length - (before.clients as unknown[]).length, "a refused blank name opened a client row").toBe(4);
    expect((after.receivables as unknown[]).length - (before.receivables as unknown[]).length, "a refused blank label opened a receivable").toBe(3);
  }, 180_000);
});
