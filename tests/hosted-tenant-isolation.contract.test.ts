import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runIsolationProbes, PROBE_NAME } from "../scripts/hosted-tenant-isolation.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

// The customer-launch record has claimed cross-tenant isolation on production from hand-typed curl
// commands, and every one of those left behind a claim the next session could not re-derive. This
// instrument answers the question again from the repository: sign in as two real accounts, then have
// one try to read, edit, delete, insert into and RPC-call the other's rows, plus the anonymous and
// garbage-token probes, plus the Founder gate from a customer session.
//
// It is tested against a loopback stand-in that enforces row-level security the way PostgREST does,
// because the assertions that matter here are about what a *refusal* looks like from the outside: an
// empty representation, a 42501, a 401. A suite that only ever ran against production could not show
// that a leak is detected, and a leak is the one outcome this instrument exists to catch.
//
// Three cases exist because of how easily an instrument like this reports a green light it did not
// earn: a destructive probe aimed at the victim's real ledger (which would damage the very rows the
// release record is built on if isolation ever regressed), a write trusted from the attacker's own
// empty reply instead of read back as the owner, and a run continued with a session that was never
// issued.

/** The RPCs that change a row already in place rather than adding one. Each names the table the
 *  attack reads its target from and the field the stand-in moves when a broken policy applies it. */
const RPC_APPLIED = {
  cancel_receivable: { table: "receivables", id: "p_receivable_id", fields: () => ({ status: "CANCELLED" }) },
  snooze_receivable: { table: "receivables", id: "p_receivable_id", fields: () => ({ status: "SNOOZED" }) },
  update_receivable_details: { table: "receivables", id: "p_receivable_id", fields: (json) => ({ label: json.p_label }) },
  update_client: { table: "clients", id: "p_client_id", fields: (json) => ({ name: json.p_name }) },
  cancel_promise: { table: "promises", id: "p_promise_id", fields: () => ({ status: "CANCELLED" }) },
};

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const TOKEN_A = "token-victim-never-printed";
const TOKEN_B = "token-attacker-never-printed";
const KEY = "sb_publishable_testkey_000000";
const UPI_VPA = "dueweave.founder@icici";
const PAYEE_NAME = "DueWeave Collections Pvt Ltd";
const REFUND_POLICY = "Founder access is non-refundable within 7 days of approval, as reviewed by the founder.";
/** The free tier's ceiling on OPEN or PARTIALLY_PAID receivables per account, enforced by
 *  `public.enforce_free_receivable_limit()` (`20260812150500_secure_foundation.sql:258`). */
const FREE_ACTIVE_RECEIVABLE_LIMIT = 3;

/** The argument names PostgREST resolves each customer-facing RPC by, read off the deployed
 *  signatures (`20260815100000_current_stage5_promise_chronology.sql:418`,
 *  `20260815090000_current_stage5_lifecycle_correctness.sql:523,815,880,938` and
 *  `20261004170000_current_arc2_ledger_required_blank_class.sql:148`). A body with a name the
 *  function does not declare is a `PGRST202` schema-cache miss — the call never reaches a policy, so
 *  an instrument that read it as a refusal would report the gate green on a typo. */
const RPC_SIGNATURES = {
  create_client: ["p_name", "p_company", "p_phone", "p_email", "p_notes"],
  create_receivable: ["p_client_id", "p_label", "p_invoice_ref", "p_amount_due_paise", "p_due_date", "p_notes"],
  create_promise: ["p_receivable_id", "p_promised_amount_paise", "p_made_on", "p_promised_date", "p_source", "p_note", "p_request_id"],
  record_payment: ["p_receivable_id", "p_amount_paise", "p_paid_on", "p_method", "p_reference", "p_request_id", "p_note"],
  cancel_receivable: ["p_receivable_id", "p_reason"],
  snooze_receivable: ["p_receivable_id", "p_until"],
  cancel_promise: ["p_promise_id", "p_reason"],
  update_receivable_details: ["p_receivable_id", "p_label", "p_invoice_ref", "p_notes", "p_expected_updated_at"],
  update_client: ["p_client_id", "p_name", "p_company", "p_phone", "p_email", "p_notes"],
};

/** Parameters the function declares as `uuid`, which PostgreSQL casts before any policy runs. */
const UUID_PARAMETERS = { create_promise: ["p_request_id"], record_payment: ["p_request_id"] };
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The vocabularies the two money writes accept, read off their own guards. */
const PROMISE_SOURCES = ["WHATSAPP", "CALL", "EMAIL", "MEETING", "OTHER"];
const PAYMENT_METHODS = ["UPI", "BANK_TRANSFER", "CASH", "OTHER"];

/** `public.current_business_date()` is `timezone('Asia/Kolkata', now())::date`
 *  (`20260815090000_current_stage5_lifecycle_correctness.sql:67`) — the ledger's today, which is not
 *  necessarily the day the machine running this suite is standing on. */
function businessDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const field = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${field("year")}-${field("month")}-${field("day")}`;
}

/**
 * The checks `create_promise` and `record_payment` run before they look at the row at all, in the
 * order the deployed bodies run them (`20260815100000_current_stage5_promise_chronology.sql:446-473`
 * and `20260815090000_current_stage5_lifecycle_correctness.sql:561-578`). They matter here for one
 * reason: a raised validation is `HTTP 400 P0001`, exactly what the owner-scoped guard raises when it
 * refuses a cross-tenant target (`:477` / `:583`), so the status code cannot tell an isolation refusal
 * from a bad argument. The message can, and an attack refused by a rule about its own payload tested
 * nothing about the boundary.
 *
 * `record_payment`'s future-date rule is deliberately absent: it sits at `:610`, *after* the ownership
 * guard, so a future-dated payment attack still reaches the boundary. `snooze_receivable` runs the
 * other way (`:952` refuses a date before today), which is why the same literal `2099-12-31` is the
 * right value for one probe and the wrong one for another.
 */
function validationRefusal(fn: string, json: Record<string, unknown>) {
  if (fn === "create_promise") {
    if (!PROMISE_SOURCES.includes(String(json.p_source ?? "").trim().toUpperCase())) return "Choose how the promise was made";
    if (!(Number(json.p_promised_amount_paise) > 0)) return "Enter a promised amount greater than zero";
    if (json.p_made_on == null) return "Choose the date the customer made this promise";
    if (json.p_promised_date == null) return "Choose the date the customer promised";
    if (String(json.p_made_on) > String(json.p_promised_date)) return "The promise date cannot be earlier than the day the promise was made";
    if (String(json.p_made_on) > businessDate()) return "A promise cannot be dated as made in the future";
    return null;
  }
  if (fn === "record_payment") {
    if (!PAYMENT_METHODS.includes(String(json.p_method ?? "").trim().toUpperCase())) return "Choose how the money arrived";
    if (!(Number(json.p_amount_paise) > 0)) return "Enter a payment amount greater than zero";
    if (json.p_paid_on == null) return "Choose the date the money arrived";
    if (String(json.p_reference ?? "").trim().length > 160) return "Reference can be up to 160 characters";
    return null;
  }
  return null;
}

/** The message each function raises when the caller does not own the target row. */
const OWNERSHIP_REFUSAL = {
  create_promise: "Receivable is not available for this account",
  record_payment: "Receivable is not available for this account",
  cancel_receivable: "Receivable is not available for this account",
  snooze_receivable: "Receivable is not available to snooze",
  update_receivable_details: "That receivable is not available in this private ledger",
  update_client: "Client is not available for this account",
  create_receivable: "Client is not available for this account",
  cancel_promise: "Promise is not available for this account",
};

/**
 * What `get_founder_offer()` answers a customer with, measured on the hosted row and recorded in
 * `docs/CONSUMER_LIVE_PROGRESS.md` STEP 8: the offer is visible by design (`grant execute … to
 * authenticated`, and the customer purchase page calls it), and the payment gate is shut by the
 * readiness conjunction of `20260928090000_current_stage8_readiness_parity.sql:175`. `ready` flips
 * every gate term, which is the state the isolation run has to refuse.
 */
function founderOffer({ ready = false } = {}) {
  return [{
    amount_paise: 49900,
    founder_cap: 50,
    available_spots: 50,
    payee_name: ready ? PAYEE_NAME : "DueWeave",
    upi_id: ready ? UPI_VPA : null,
    payment_destination_status: ready ? "LIVE" : "PLACEHOLDER",
    support_contact: ready ? "founder-support@dueweave.test" : "Support contact not configured",
    support_contact_status: ready ? "CONFIGURED" : "PENDING",
    refund_policy_status: ready ? "APPROVED" : "PENDING_APPROVAL",
    refund_policy_text: ready ? REFUND_POLICY : null,
    disclosures_status: ready ? "APPROVED" : "PENDING",
    review_window_copy: "Usually reviewed within 24 hours.",
    enabled: true,
  }];
}

/** The victim's ledger, seeded with the ids a real QA account carries after the free-tier journey. */
function seedRows() {
  return {
    clients: [{ id: "cl-real", owner_id: OWNER_A, name: "Real Ledger Client" }],
    receivables: [{ id: "rc-real", owner_id: OWNER_A, client_id: "cl-real", label: "Real invoice", status: "OPEN" }],
    promises: [{ id: "pm-real", owner_id: OWNER_A, receivable_id: "rc-real", status: "OPEN" }],
    payments: [{ id: "py-real", owner_id: OWNER_A, receivable_id: "rc-real" }],
    activities: [{ id: "ac-real", owner_id: OWNER_A }],
    profiles: [{ id: OWNER_A }],
    entitlements: [{ user_id: OWNER_A }],
    founder_admins: [],
  };
}

/**
 * The state production was actually in when the third isolation run of 2026-10-16 was refused before
 * it could probe anything: the free-tier journey row, plus a sacrificial triple two earlier runs left
 * behind, which together hold all three active receivables the plan allows.
 */
function seedRowsAfterEarlierRuns() {
  const rows = seedRows();
  rows.clients.push({ id: "cl-earlier", owner_id: OWNER_A, name: PROBE_NAME, archived_at: null });
  rows.receivables.push(
    { id: "rc-earlier", owner_id: OWNER_A, client_id: "cl-earlier", label: PROBE_NAME, status: "OPEN", outstanding_paise: 100000 },
    { id: "rc-earlier-2", owner_id: OWNER_A, client_id: "cl-earlier", label: PROBE_NAME, status: "OPEN", outstanding_paise: 100000 },
  );
  rows.promises.push({ id: "pm-earlier", owner_id: OWNER_A, receivable_id: "rc-earlier", status: "ACTIVE" });
  return rows;
}

const servers = [];

/**
 * A deployment that behaves like Supabase: a password grant for each QA account, a PostgREST surface
 * whose reads, updates and deletes are filtered by the row owner, an insert whose owner must be the
 * caller, RPCs that refuse a target the caller does not own, and Founder RPCs that refuse anyone not
 * in `founder_admins`. Every request is recorded so a case can prove what the instrument aimed at.
 *
 * `policy` breaks exactly one rule at a time — that is how each leak assertion is earned rather than
 * assumed. `writeApplies` is the subtle one: it applies the attacker's write but still answers the
 * attacker with an empty representation, which is what a deployment with a broken policy would look
 * like from the attacker's side.
 */
async function serveBackend({ policy = {}, rows = seedRows() } = {}) {
  const requests = [];
  const tokens = { "victim-pw": { token: TOKEN_A, owner: OWNER_A }, "attacker-pw": { token: TOKEN_B, owner: OWNER_B } };
  const issuedTokens = Object.values(tokens).map((entry) => entry.token);
  const ownerOf = (authorization) => {
    const entry = Object.values(tokens).find((candidate) => candidate.token === (authorization ?? "").replace(/^Bearer /, ""));
    return entry ? entry.owner : null;
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const body = [];
    request.on("data", (chunk) => body.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(body).toString("utf8");
      const json = text ? JSON.parse(text) : {};
      const caller = ownerOf(request.headers.authorization);
      const record: { asked: string; body: Record<string, unknown>; hasBearer: boolean; asOwner: boolean; bearerParts: number; reason: string | null } = { asked: `${request.method} ${url.pathname}${url.search}`, body: json, hasBearer: Boolean(request.headers.authorization && request.headers.authorization !== `Bearer ${KEY}`), asOwner: caller === OWNER_A, bearerParts: request.headers.authorization ? request.headers.authorization.replace(/^Bearer /, "").split(".").length : 0, reason: null };
      requests.push(record);
      const reply = (status: number, payload: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      /** A function that `raise exception`s answers the way PostgREST surfaces it — `P0001` at HTTP 400
       *  for a plain raise, `P0002` at HTTP 500 for the two guards that spell out `no_data_found` — and
       *  the raised text is kept on the request so a case can tell which rule refused the call. */
      const raise = (message: string, { code = "P0001", status = 400 } = {}) => {
        record.reason = message;
        reply(status, { code, message });
      };

      if (url.pathname === "/auth/v1/token") {
        const entry = tokens[json.password];
        if (!entry) return reply(400, { msg: "Invalid login credentials" });
        return reply(200, { access_token: entry.token, refresh_token: `refresh-for-${entry.owner}`, user: { id: entry.owner } });
      }

      // The gateway parses the bearer before any row policy runs: a string that is not a JWS is
      // refused as `PGRST301 Expected 3 parts in JWT`, and a JWS-shaped one the project key cannot
      // sign is refused as an invalid signature. Both are authentication declining the caller, which
      // is exactly what the forged-bearer probe asks about — and neither one reaches a policy.
      if (url.pathname.startsWith("/rest/v1/")) {
        const bearer = (request.headers.authorization ?? "").replace(/^Bearer /, "");
        if (bearer && bearer !== KEY && !issuedTokens.includes(bearer)) {
          const parts = bearer.split(".");
          return reply(401, { code: "PGRST301", message: parts.length === 3 ? "JWSError JWSInvalidSignature" : `Expected 3 parts in JWT; got ${parts.length}` });
        }
      }

      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fn = url.pathname.split("/").pop();
        const signature = RPC_SIGNATURES[fn];
        if (signature) {
          const unexpected = Object.keys(json).filter((name) => !signature.includes(name));
          if (unexpected.length > 0) return reply(404, { code: "PGRST202", message: `Could not find the function public.${fn}(${Object.keys(json).sort().join(", ")}) in the schema cache` });
          const badUuid = (UUID_PARAMETERS[fn] ?? []).find((name) => json[name] !== undefined && !UUID_SHAPE.test(String(json[name])));
          if (badUuid) return reply(400, { code: "22P02", message: `invalid input syntax for type uuid: parameter ${badUuid}` });
        }
        if (fn === "get_founder_offer") {
          if (!caller) return reply(400, { code: "P0001", message: "Authentication is required" });
          return reply(200, founderOffer({ ready: Boolean(policy.founderOpen) }));
        }
        if (policy.rpcApplies && fn in RPC_APPLIED) {
          const attack = RPC_APPLIED[fn];
          const target = rows[attack.table].find((entry) => entry.id === json[attack.id]);
          if (target) Object.assign(target, attack.fields(json));
          // A function declared to return nothing answers with an empty body, so the attacker's reply
          // looks exactly like the reply a refused call gets. Only the owner's read can tell them apart.
          response.writeHead(204);
          return response.end();
        }
        if (policy.founderOpen && fn.startsWith("list_pending_founder")) return reply(200, [{ claim_id: "fc-real" }]);
        if (policy.rpcNotFound && fn === "record_payment") return reply(404, { code: "PGRST202", message: "Could not find the function record_payment(...) in the schema cache" });
        if (fn.includes("founder")) return reply(403, { code: "42501", message: "author only" });
        const validation = validationRefusal(fn, json);
        if (validation) return raise(validation);
        const targetTable = ["create_promise", "record_payment", "cancel_receivable", "snooze_receivable", "update_receivable_details"].includes(fn)
          ? "receivables"
          : fn === "cancel_promise"
            ? "promises"
            : fn === "update_client" || fn === "create_receivable"
              ? "clients"
              : null;
        if (targetTable) {
          const id = json.p_receivable_id ?? json.p_promise_id ?? json.p_client_id;
          const target = rows[targetTable].find((row) => row.id === id);
          if (!target || target.owner_id !== caller) {
            // The measured production shape: the two guards that spell out `no_data_found` answer 500
            // P0002, every plain `raise exception` answers 400 P0001 — both with an empty row set, so
            // `verdict` still reads them as refusals, and the message is the only thing that says which.
            if (OWNERSHIP_REFUSAL[fn]) return raise(OWNERSHIP_REFUSAL[fn], fn === "update_receivable_details" || fn === "update_client" ? { code: "P0002", status: 500 } : {});
            return reply(403, { code: "42501", message: "row-level security" });
          }
        }
        if (fn === "create_client") {
          const row = { id: `cl-probe-${requests.length}`, owner_id: caller, name: json.p_name };
          rows.clients.push(row);
          return reply(201, row);
        }
        if (fn === "create_receivable") {
          // `enforce_free_receivable_limit` runs before the insert through the `receivables_free_limit`
          // trigger (`20260812150500_secure_foundation.sql:238` and `:348`), so the plan's cap answers
          // this call with a raised exception rather than a constraint violation.
          const active = rows.receivables.filter((entry) => entry.owner_id === caller && (entry.status === "OPEN" || entry.status === "PARTIALLY_PAID")).length;
          if (active >= FREE_ACTIVE_RECEIVABLE_LIMIT) return raise(`Free plan allows up to ${FREE_ACTIVE_RECEIVABLE_LIMIT} active receivables`);
          const client = rows.clients.find((entry) => entry.id === json.p_client_id);
          const row = { id: `rc-probe-${requests.length}`, owner_id: caller, client_id: client.id, label: json.p_label, status: "OPEN", outstanding_paise: Number(json.p_amount_due_paise) };
          rows.receivables.push(row);
          // `create_receivable` writes its own ledger event (`20261004170000…:142`), so setup alone
          // moves the activities count — the reason the protected window has to start after it.
          rows.activities.push({ id: `ac-probe-${requests.length}`, owner_id: caller, receivable_id: row.id });
          return reply(201, row);
        }
        if (fn === "create_promise") {
          // `promises.status` defaults to ACTIVE (`20260812150500_secure_foundation.sql:57`), which is
          // the state the reuse lookup in setup looks for on a second run.
          const row = { id: `pm-probe-${requests.length}`, owner_id: caller, receivable_id: json.p_receivable_id, status: "ACTIVE" };
          rows.promises.push(row);
          rows.activities.push({ id: `ac-probe-${requests.length}`, owner_id: caller, receivable_id: json.p_receivable_id, promise_id: row.id });
          return reply(201, row);
        }
        return reply(200, { ok: true });
      }

      const table = url.pathname.split("/").pop();
      if (!Object.prototype.hasOwnProperty.call(rows, table)) return reply(404, { message: `table ${table} is not served` });
      const idFilter = url.searchParams.get("id");
      const wanted = idFilter?.startsWith("eq.") ? idFilter.slice(3) : null;
      const visible = (row) => {
        if (policy.readLeak && table === "clients") return true;
        if (policy.anonLeak && !caller) return row.owner_id === OWNER_A || row.id === OWNER_A || row.user_id === OWNER_A;
        if (!caller) return false;
        if (table === "entitlements") return row.user_id === caller;
        if (table === "profiles" || table === "founder_admins") return row.id === caller || row.user_id === caller;
        return row.owner_id === caller;
      };
      const matches = () => rows[table].filter((row) => (wanted ? row.id === wanted : true));

      if (request.method === "GET") return reply(200, matches().filter(visible));

      if (request.method === "POST") {
        if (!caller) return reply(401, { code: "42501", message: "requires authentication" });
        if (json.owner_id && json.owner_id !== caller) return reply(403, { code: "42501", message: "new row violates row-level security policy" });
        return reply(201, []);
      }

      if (request.method === "PATCH") {
        const doomed = policy.writeApplies ? matches() : matches().filter(visible);
        for (const row of doomed) if (json.name) row.name = json.name;
        return reply(200, matches().filter(visible));
      }
      if (request.method === "DELETE") {
        const doomed = policy.writeApplies ? matches() : matches().filter(visible);
        for (const row of doomed) rows[table].splice(rows[table].indexOf(row), 1);
        return reply(200, matches().filter(visible));
      }
      return reply(405, { message: "not allowed" });
    });
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("the stand-in backend did not bind a port");
  return { api: `http://127.0.0.1:${address.port}`, requests, rows, key: KEY };
}

/** The two accounts the instrument signs in as, with the passwords the stand-in recognises. */
function sessions() {
  return {
    victim: { label: "victim", email: "dw-victim@example.test", password: "victim-pw", userId: OWNER_A },
    attacker: { label: "attacker", email: "dw-attacker@example.test", password: "attacker-pw", userId: OWNER_B },
  };
}

afterAll(async () => {
  await Promise.all(
    servers.map(async (server) => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    }),
  );
});

describe("Hosted tenant isolation probes", () => {
  it("passes when every cross-tenant read is empty, every write changes nothing, and every RPC is refused", async () => {
    const site = await serveBackend();
    const { findings, lines } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    expect(lines.join("\n"), "the read probes were never attempted").toContain("read victim client");
    expect(findings, `a healthy deployment was reported broken:\n${lines.join("\n")}`).toEqual([]);
  });

  it("names the probe that lets one account read another's row", async () => {
    const site = await serveBackend({ policy: { readLeak: true } });
    const { findings, lines } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    expect(findings.join("\n"), "an attacker read that returned the victim's row has to be a finding").toMatch(/read victim client/i);
    expect(lines.join("\n")).toMatch(/LEAK/i);
  });

  it("re-reads the row as its owner, so a refused write that actually applied is still a finding", async () => {
    // PostgREST answers a write that matched no visible row with an empty representation, which looks
    // exactly like a write that was refused. So the attacker's reply cannot be the evidence.
    const site = await serveBackend({ policy: { writeApplies: true } });
    const { findings, lines } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    const ownerReadsBack = site.requests.filter((entry) => /GET \/rest\/v1\/clients/.test(entry.asked) && entry.hasBearer);
    expect(ownerReadsBack.length, "the instrument never read the probe row back as its owner").toBeGreaterThan(0);
    expect(findings.join("\n"), `a write the owner's read-back says landed was reported clean:\n${lines.join("\n")}`).toMatch(/patch|delete/i);
  });

  it("proves a targeted RPC was refused by the owner's read-back, not by the attacker's empty reply", async () => {
    // The read probes can trust an empty representation because a read has nothing else to do. A write
    // cannot: a function declared to return nothing answers 204 whether it refused the target or moved
    // it, and the four mutate-in-place attacks (cancel, snooze, edit details, edit client) change no
    // row count, so the recount that protects the victim's real ledger is blind to them too. Without a
    // read-back aimed at the RPC target, a deployment whose policy is broken reports the gate green.
    const site = await serveBackend({ policy: { rpcApplies: true } });
    const { findings, lines } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    const ownerReadsTargets = site.requests.filter((entry) => entry.asOwner && /^GET \/rest\/v1\/(clients|receivables|promises)\?select=\*&id=eq\.(cl-probe|rc-probe|pm-probe)/.test(entry.asked));
    expect(ownerReadsTargets.length, "the instrument never read an RPC attack's target back as its owner").toBeGreaterThan(0);
    expect(findings.join("\n"), `an RPC attack that moved the victim's row was counted as a refusal:\n${lines.join("\n")}`).toMatch(/cancel_receivable|snooze_receivable|update_receivable_details|update_client/i);
  });

  it("addresses every RPC attack with the argument names the deployed function declares", async () => {
    // The production run aimed `update_receivable_details` at six names while the deployed function
    // (`20261004170000_current_arc2_ledger_required_blank_class.sql:148`) declares five, so PostgREST
    // answered `PGRST202` from the schema cache and the attack never reached the row. A probe that is
    // answered before a policy runs cannot prove the policy held, whatever the HTTP status says.
    const site = await serveBackend();
    const { findings, lines } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    const targeted = site.requests.filter((entry) => entry.asked === "POST /rest/v1/rpc/update_receivable_details");
    expect(targeted.length, "the edit-details attack was never attempted").toBe(1);
    expect(Object.keys(targeted[0].body).sort(), "the attack sent argument names the deployed signature does not declare").toEqual(
      [...RPC_SIGNATURES.update_receivable_details].filter((name) => name !== "p_expected_updated_at").sort(),
    );
    expect(lines.join("\n"), `an attack answered before any policy ran was counted as a refusal:\n${lines.join("\n")}`).not.toMatch(/PGRST202/);
    expect(findings.join("\n"), `a healthy deployment was reported broken:\n${lines.join("\n")}`).not.toMatch(/never reached a row-security policy/);
  });

  it("identifies its money-write attacks by a uuid request id, so the promise row is really there to attack", async () => {
    // `create_promise(uuid, bigint, date, date, text, text, uuid)` and `record_payment(… uuid, text)`
    // cast `p_request_id` before anything else runs, so a human-readable label answered `22P02` and the
    // victim's sacrificial promise was never created — which silently dropped the whole
    // `cancel_promise` attack out of the run. An instrument that skips an attack still prints a green
    // gate for the attacks it did run.
    const site = await serveBackend();
    const { findings, lines } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    const setup = site.requests.find((entry) => entry.asked === "POST /rest/v1/rpc/create_promise");
    expect(setup, "the victim never created a sacrificial promise").toBeTruthy();
    expect(String(setup.body.p_request_id), "p_request_id is not a uuid, so the cast refuses it before any policy").toMatch(UUID_SHAPE);
    expect(site.rows.promises.length, "no promise row was created, so the promise-targeted attack had no target").toBeGreaterThan(1);
    const attack = site.requests.some((entry) => entry.asked === "POST /rest/v1/rpc/cancel_promise");
    expect(attack, "cancel_promise was skipped because setup failed, and the run reported the gate anyway").toBe(true);
    expect(findings, `a healthy deployment was reported broken:\n${lines.join("\n")}`).toEqual([]);
  });

  it("sends every money write inside the rules the function enforces before it reads the row", async () => {
    // Both money functions answer an out-of-vocabulary source, a non-positive amount and (for promises)
    // a `p_made_on` after the business date with `HTTP 400 P0001` — the same status and code the
    // owner-scoped guard raises when it refuses a cross-tenant target. Production printed
    // `REFUSED create_promise on the victim's receivable HTTP 400 P0001` for a probe carrying
    // `p_source: "verbal"` and `p_made_on: "2099-12-01"`, so the refusal was a rule about the payload and
    // the boundary was never reached. Every refusal this instrument counts for those two RPCs has to be
    // the guard's own message.
    const site = await serveBackend();
    const { lines } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    const money = site.requests.filter((entry) => /\/rest\/v1\/rpc\/(create_promise|record_payment)$/.test(entry.asked));
    expect(money.length, "the victim never created a sacrificial promise, or an attack missed its money RPC").toBe(3);
    const refused = money.filter((entry) => entry.reason !== null);
    expect(refused.map((entry) => entry.reason), `a money write refused by its own argument rules tested nothing about isolation:\n${refused.map((entry) => `${entry.asked}: ${entry.reason}`).join("\n")}`).toEqual(["Receivable is not available for this account", "Receivable is not available for this account"]);
    const accepted = money.filter((entry) => entry.reason === null);
    expect(accepted.length, "the victim's own setup write was refused, so no sacrificial promise exists").toBe(1);
    expect(accepted[0].asOwner, "the one money write that got through was not the owner's setup").toBe(true);
    expect(lines.join("\n"), "the operator's report does not say which rule answered, so a validation refusal and a guard refusal look alike").toMatch(/REFUSED\s+create_promise on the victim's receivable\s+HTTP 400 P0001 — "Receivable is not available for this account"/);
  });

  it("runs again on a deployment that still holds the rows an earlier run left behind", async () => {
    // Two isolation runs on 2026-10-16 each created a sacrificial client and receivable, and the QA
    // accounts are on the free tier, whose trigger refuses a fourth active receivable
    // (`20260812150500_secure_foundation.sql:258`). The third run's setup was therefore answered with
    // `HTTP 400 P0001` and zero probes ran — the instrument was refused by the product's own plan cap,
    // not by a boundary, and an acceptance gate that only runs twice is not a gate. Setup has to reuse
    // what is already labelled as this run's rather than grow the residue that starves it.
    const site = await serveBackend({ rows: seedRowsAfterEarlierRuns() });
    const { findings, lines } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    expect(findings, `a re-run was stopped by the plan's cap instead of a policy:\n${lines.join("\n")}`).toEqual([]);
    expect(site.requests.filter((entry) => entry.asked === "POST /rest/v1/rpc/create_client").length, "a second sacrificial client was created while one was there to reuse").toBe(0);
    expect(site.requests.filter((entry) => entry.asOwner && /\/rest\/v1\/rpc\/(create_receivable|create_promise)$/.test(entry.asked)).length, "a second sacrificial receivable or promise was created while one was there to reuse").toBe(0);
    expect(site.requests.some((entry) => entry.asked === "POST /rest/v1/rpc/cancel_promise"), "the reused promise row was never attacked, so cancel_promise went untested").toBe(true);
    expect(site.rows.clients.length, "the run grew the residue that eats the plan's headroom").toBe(2);
    expect(site.rows.receivables.length, "the run grew the residue that eats the plan's headroom").toBe(3);
  });

  it("starts the protected ledger window after its own setup writes", async () => {
    // Creating the sacrificial receivable and promise inserts ledger activity rows, so a baseline taken
    // before setup reported the victim's own `activities` count as moved by the attack — a finding
    // that had nothing to do with isolation and would have trained the operator to wave it through.
    const site = await serveBackend();
    const { findings, lines } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    expect(findings.join("\n"), `setup's own writes were reported as an attack on the ledger:\n${lines.join("\n")}`).not.toMatch(/ledger moved/);
    expect(findings, `a healthy deployment was reported broken:\n${lines.join("\n")}`).toEqual([]);
  });

  it("declines a forged bearer at the authentication layer and still calls that a refusal", async () => {
    // The forged-bearer probe asks whether a token nobody issued can read customer rows. PostgREST
    // answers it before any policy: a one-part string is `PGRST301 Expected 3 parts in JWT`, a JWS the
    // project key cannot sign is `PGRST301 JWSInvalidSignature`. Sending the first shape asked a
    // question about JWT parsing, not about a token; the instrument must present a structurally valid
    // one, and must report an authentication-layer decline as the refusal it is rather than as proof
    // that a row policy held.
    const site = await serveBackend();
    const { findings, lines } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    const forged = site.requests.filter((entry) => entry.asked === "GET /rest/v1/clients?select=id&limit=5" && entry.hasBearer && entry.bearerParts === 3);
    expect(forged.length, "no structurally valid but unsigned JWT was probed").toBeGreaterThan(0);
    expect(lines.join("\n"), `a declined forged token was reported as a finding:\n${lines.join("\n")}`).toMatch(/REFUSED.*forged/i);
    expect(findings.join("\n"), `a healthy deployment was reported broken:\n${lines.join("\n")}`).not.toMatch(/forged/i);
  });

  it("judges the Founder gate by the offer's readiness fields, because the offer is meant to answer a customer", async () => {
    // `get_founder_offer()` is `grant execute … to authenticated` by design and the customer purchase
    // page calls it (`client/src/data/supabase-founder-repository.ts:50`), so an answer is not the gate
    // opening. The gate is the conjunction in `20260928090000_current_stage8_readiness_parity.sql:175`:
    // a customer session must be shown an offer that cannot take a payment.
    const site = await serveBackend();
    const { findings, lines } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    expect(site.requests.some((entry) => entry.asked === "POST /rest/v1/rpc/get_founder_offer"), "the offer was never probed").toBe(true);
    expect(lines.join("\n"), `the closed offer projection was reported as an open gate:\n${lines.join("\n")}`).toMatch(/CLOSED.*get_founder_offer/i);
    expect(findings.join("\n"), `a fail-closed Founder offer was reported as payment-ready:\n${lines.join("\n")}`).not.toMatch(/get_founder_offer/i);
  });

  it("aims every destructive probe at the sacrificial row the victim created for this run", async () => {    // The victim account holds the free-tier journey rows the release record is built on. If isolation
    // ever regressed, a destructive probe aimed at those ids would damage real data rather than prove a
    // boundary — so the real ledger is probed by read only, and every PATCH/DELETE/RPC attack is aimed
    // at a row created for this run, which the QA erasure removes afterwards.
    const site = await serveBackend();
    await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    const destructive = site.requests.filter((entry) => /^(PATCH|DELETE) \/rest\/v1|^POST \/rest\/v1\/rpc/.test(entry.asked));
    expect(destructive.length, "no destructive probe ran, so this case proves nothing").toBeGreaterThan(0);
    for (const entry of destructive) {
      const aimedAtRealLedger = ["cl-real", "rc-real", "pm-real", "py-real"].some((id) => entry.asked.includes(id) || JSON.stringify(entry.body).includes(id));
      expect(aimedAtRealLedger, `${entry.asked} aimed at the victim's real ledger row`).toBe(false);
    }
  });

  it("treats a Founder RPC that answers a customer session as a finding", async () => {
    // The Founder payment gate is the boundary the release must keep closed, and it has been read on
    // production only as a refusal. A customer session that gets a payload back is the gate being open.
    const site = await serveBackend({ policy: { founderOpen: true } });
    const { findings } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    expect(findings.join("\n"), "the Founder gate opened for a customer and nothing said so").toMatch(/founder/i);
  });

  it("probes with no bearer at all, and fails when the anonymous role can read a customer row", async () => {
    const site = await serveBackend({ policy: { anonLeak: true } });
    const { findings } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    const anonymous = site.requests.filter((entry) => /\/rest\/v1\//.test(entry.asked) && !entry.hasBearer);
    expect(anonymous.length, "the anonymous role was never probed").toBeGreaterThan(0);
    expect(findings.join("\n"), "an anonymous read that returned a customer row has to be a finding").toMatch(/anon/i);
  });

  it("keeps every token, password and payment destination out of its own report", async () => {
    const site = await serveBackend({ policy: { readLeak: true, founderOpen: true } });
    const printed = [];
    const { findings, lines } = await runIsolationProbes({ ...site, ...sessions(), log: (line) => printed.push(line) });
    expect(findings.length, "a clean run was reported, so this case proves nothing about redaction").toBeGreaterThan(0);
    expect(lines.length, "the instrument produced no report").toBeGreaterThan(0);
    for (const secret of [TOKEN_A, TOKEN_B, "victim-pw", "attacker-pw", KEY, UPI_VPA, PAYEE_NAME, REFUND_POLICY]) {
      expect(printed.join("\n"), `a credential or payment value reached the operator's screen: ${secret.slice(0, 8)}…`).not.toContain(secret);
    }
  });

  it("refuses to count a request that never reached a policy as a refusal", async () => {
    // PostgREST answers an unknown function or a malformed body with a `PGRST…` code before any
    // row-security rule runs. Read as "it was blocked", one typo in an argument name would report the
    // whole gate green, so the instrument has to call that outcome out instead of counting it.
    const site = await serveBackend({ policy: { rpcNotFound: true } });
    const { findings } = await runIsolationProbes({ ...site, ...sessions(), log: () => {} });
    expect(findings.join("\n"), "a pre-policy rejection was silently accepted as a refusal").toMatch(/record_payment/i);
    expect(findings.join("\n")).toMatch(/never reached a row-security policy|PGRST202/i);
  });

  it("stays a laptop command, because it writes production rows and needs two confirmed accounts", () => {
    for (const name of ["ci.yml", "live-public.yml", "release-full-browser.yml", "codeql-release.yml"]) {
      const body = readFileSync(path.join(projectRoot, ".github", "workflows", name), "utf8");
      expect(body, `${name} would run a destructive production probe on every push`).not.toContain("hosted-tenant-isolation");
    }
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    for (const gate of ["verify:release:local", "verify:e2e:local", "test:e2e:smoke"]) {
      expect(pkg.scripts[gate], `${gate} must not aim writes at production`).not.toContain("hosted-tenant-isolation");
    }
  });

  it("stops the run when a session cannot be established, rather than probing with a missing bearer", async () => {
    const site = await serveBackend();
    const { findings } = await runIsolationProbes({ ...site, victim: { ...sessions().victim, password: "wrong-pw" }, attacker: sessions().attacker, log: () => {} });
    expect(findings.join("\n"), "probes ran without a victim session").toMatch(/sign in|session/i);
    const attacks = site.requests.filter((entry) => /^(PATCH|DELETE) \/rest\/v1|GET \/rest\/v1/.test(entry.asked));
    expect(attacks.length, "the run went on and probed anyway").toBe(0);
  });
});
