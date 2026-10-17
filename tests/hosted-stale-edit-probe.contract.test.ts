import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PRODUCTION_REF, projectRef, assertProductionTarget, runStaleEditProbes, PROBE_NAME, DEFAULT_CEILING_MS } from "../scripts/hosted-stale-edit-probe.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

// CL-39 was proven on the pinned local build and its production preconditions were qualified by
// `scripts/hosted-migration-qualification.mjs`, but the post-promotion question — step 8 of the release
// plan, "run the hosted stale-edit test" — had no committed instrument. It would have been answered by
// scratch drivers again, which is exactly how "the stale edit was refused fast on production" decays
// into a memory. This is that proof as one operator command, in the shape the other hosted
// instruments already use.
//
// What makes the claim worth printing is that each probe is judged by the owner's read-back and by the
// clock, not by the reply alone. A stale refusal that arrives after two minutes is the defect, not the
// fix: the pre-migration hang was PostgREST re-running a raise carrying SQLSTATE 40001, so it answered
// nothing until the edge gave up at 125 s. An instrument that only checked "was it refused" would have
// reported the hang as a pass. So a finding is raised for a refusal carrying a retryable code, for a
// refusal that arrives later than the ceiling, for a stale write that moves the row, and for a fresh
// authorized edit that is refused — the last because "valid timestamp still writing" is the half of the
// gate that a repair focused on refusals can silently break.
//
// Tested against a loopback stand-in that enforces the optimistic-lock rules in the order migration 26
// runs them, because the interesting outcomes are the ones production must be hoped not to produce, and
// a suite that could only ever run against a healthy deployment cannot show that a regression is caught.

const OWNER = "11111111-1111-4111-8111-111111111111";
const TOKEN = "token-probe-account-never-printed";
const KEY = "sb_publishable_testkey_000000";

/** The argument names PostgREST resolves each routine by, read off the bodies migration 26 replaces
 *  (`supabase/migrations/20261017090000_current_cl39_edit_conflict_errcode_reachable.sql:38-48` and
 *  `:96`). A call carrying a name the deployed function does not declare is answered `PGRST202` from
 *  the schema cache before the routine runs at all, which is a complaint about the request, not a
 *  conflict refusal, and must never be counted as one. */
const RPC_SIGNATURES = {
  update_client: ["p_client_id", "p_name", "p_company", "p_phone", "p_email", "p_notes", "p_expected_updated_at"],
  update_receivable_details: ["p_receivable_id", "p_label", "p_invoice_ref", "p_notes", "p_expected_updated_at"],
  create_client: ["p_name", "p_company", "p_phone", "p_email", "p_notes"],
  create_receivable: ["p_client_id", "p_label", "p_invoice_ref", "p_amount_due_paise", "p_due_date", "p_notes"],
};

/** The message each routine raises on a token mismatch, quoted from the two `raise exception` sites
 *  (`:73` and `:125`) — the wording the client's conflict copy keys on as well as the code. */
const CONFLICT_MESSAGE = {
  update_client: "This client changed in another session",
  update_receivable_details: "This receivable changed in another session",
};

const FREE_ACTIVE_RECEIVABLE_LIMIT = 3;

const servers = [];

/**
 * A deployment that behaves like this project's API: one signed-in account, the row-level-security
 * filter on reads, and the two edit routines enforcing the optimistic lock the way migration 26 does —
 * authentication, then the id, then the owner-scoped `for update` lookup, then the token, and only then
 * the field rules. That order is what makes the probe trustworthy: a stale call carrying a valid payload
 * can only be refused by the token check.
 *
 * `policy` breaks one rule at a time, which is how every finding assertion below is earned.
 */
async function serveBackend({ policy = {}, rows = seedRows() } = {}) {
  const requests = [];
  let clock = 0;
  /** Distinct, monotonically advancing timestamps, so "the lock token moved" is a fact the stand-in
   *  enforces rather than an artefact of two calls landing in the same millisecond. */
  const nextUpdatedAt = () => new Date(Date.UTC(2026, 9, 17, 0, 0, 0, clock += 1)).toISOString();
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const json = text ? JSON.parse(text) : {};
      const bearer = (request.headers.authorization ?? "").replace(/^Bearer /, "");
      const caller = bearer === TOKEN ? OWNER : null;
      const record = {
        asked: `${request.method} ${url.pathname}${url.search}`,
        body: json,
        asOwner: caller === OWNER,
        reason: null,
        code: null,
      };
      requests.push(record);
      const reply = (status, payload) => {
        record.code = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload.code ?? null) : null;
        response.writeHead(status, { "content-type": "application/json" });
        response.end(typeof payload === "string" ? payload : JSON.stringify(payload));
      };
      const raise = (message, { code = "P0001", status = 400 } = {}) => {
        record.reason = message;
        reply(status, { code, message });
      };

      if (url.pathname === "/auth/v1/token") {
        if (json.password !== "probe-pw") return reply(400, { msg: "Invalid login credentials" });
        return reply(200, { access_token: TOKEN, refresh_token: "refresh-never-printed", user: { id: OWNER } });
      }

      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fn = url.pathname.split("/").pop();
        const signature = RPC_SIGNATURES[fn];
        if (signature) {
          const unexpected = Object.keys(json).filter((name) => !signature.includes(name));
          if (unexpected.length > 0) return reply(404, { code: "PGRST202", message: `Could not find the function public.${fn}(${Object.keys(json).sort().join(", ")}) in the schema cache` });
        }
        if (fn === "create_client") {
          const row = { id: `cl-probe-${requests.length}`, owner_id: OWNER, name: json.p_name, company: json.p_company ?? "", phone: "", email: "", notes: "", archived_at: null, updated_at: nextUpdatedAt() };
          rows.clients.push(row);
          return reply(201, row);
        }
        if (fn === "create_receivable") {
          const active = rows.receivables.filter((entry) => entry.owner_id === OWNER && (entry.status === "OPEN" || entry.status === "PARTIALLY_PAID")).length;
          if (active >= FREE_ACTIVE_RECEIVABLE_LIMIT) return raise(`Free plan allows up to ${FREE_ACTIVE_RECEIVABLE_LIMIT} active receivables`);
          const row = { id: `rc-probe-${requests.length}`, owner_id: OWNER, client_id: json.p_client_id, label: json.p_label, invoice_ref: json.p_invoice_ref ?? "", notes: "", status: "OPEN", outstanding_paise: Number(json.p_amount_due_paise), updated_at: nextUpdatedAt() };
          rows.receivables.push(row);
          return reply(201, row);
        }
        const editTarget = { update_client: { table: "clients", id: "p_client_id" }, update_receivable_details: { table: "receivables", id: "p_receivable_id" } }[fn];
        if (editTarget) {
          if (!caller) return raise("Authentication is required");
          const id = json[editTarget.id];
          const target = rows[editTarget.table].find((row) => row.id === id);
          if (!target || target.owner_id !== caller) {
            return raise(fn === "update_client" ? "That client is not available in this private ledger" : "That receivable is not available in this private ledger", { code: "P0002", status: 500 });
          }
          const stale = json.p_expected_updated_at === undefined || json.p_expected_updated_at === null || json.p_expected_updated_at !== target.updated_at;
          if (stale) {
            // The two shapes this instrument exists to catch: a refusal raised with a code the transport
            // retries instead of forwarding, and a refusal that simply never arrives in time.
            if (policy.staleApplies || (json.p_expected_updated_at === undefined && policy.noTokenApplies)) {
              Object.assign(target, fn === "update_client" ? { company: json.p_company } : { invoice_ref: json.p_invoice_ref });
              if (!policy.noTokenAdvance) target.updated_at = nextUpdatedAt();
              return reply(200, target);
            }
            if (policy.stallMs) await new Promise((resolve) => setTimeout(resolve, policy.stallMs));
            if (policy.noTokenApplies && json.p_expected_updated_at === undefined) {
              Object.assign(target, fn === "update_client" ? { company: json.p_company } : { invoice_ref: json.p_invoice_ref });
              if (!policy.noTokenAdvance) target.updated_at = nextUpdatedAt();
              return reply(200, target);
            }
            return raise(CONFLICT_MESSAGE[fn], { code: policy.conflictCode ?? "DW001" });
          }
          if (policy.freshRefuses) return raise(CONFLICT_MESSAGE[fn], { code: policy.conflictCode ?? "DW001" });
          Object.assign(target, fn === "update_client" ? { company: json.p_company } : { invoice_ref: json.p_invoice_ref });
          // `set_updated_at` is a `before update` trigger on both tables
          // (`20260812150500_secure_foundation.sql:329` and `:331`), so an applied edit always advances
          // the token the next call has to present.
          if (!policy.noTokenAdvance) target.updated_at = nextUpdatedAt();
          return reply(200, target);
        }
        return reply(404, { code: "PGRST202", message: `unknown function ${fn}` });
      }

      const table = url.pathname.split("/").pop();
      if (!Object.prototype.hasOwnProperty.call(rows, table)) return reply(404, { message: `table ${table} is not served` });
      const idFilter = url.searchParams.get("id");
      const wanted = idFilter?.startsWith("eq.") ? idFilter.slice(3) : null;
      const visible = (row) => (caller ? row.owner_id === caller : false);
      const matches = () => rows[table].filter((row) => (wanted ? row.id === wanted : true));
      if (request.method === "GET") return reply(200, matches().filter(visible));
      return reply(405, { message: "not allowed" });
    });
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("the stand-in backend did not bind a port");
  return { api: `http://127.0.0.1:${address.port}`, requests, rows, key: KEY };
}

/** The ledger a QA account holds after the free-tier journey, plus nothing that looks like a probe:
 *  the sacrificial rows are the instrument's own to create and to edit. */
function seedRows() {
  return {
    clients: [{ id: "cl-real", owner_id: OWNER, name: "Real Ledger Client", company: "", phone: "", email: "", notes: "", archived_at: null, updated_at: "2026-10-01T00:00:00.000Z" }],
    receivables: [{ id: "rc-real", owner_id: OWNER, client_id: "cl-real", label: "Real invoice", invoice_ref: "", notes: "", status: "OPEN", outstanding_paise: 100000, updated_at: "2026-10-01T00:00:00.000Z" }],
    promises: [{ id: "pm-real", owner_id: OWNER, receivable_id: "rc-real", status: "ACTIVE", updated_at: "2026-10-01T00:00:00.000Z" }],
    payments: [{ id: "py-real", owner_id: OWNER, receivable_id: "rc-real" }],
    activities: [{ id: "ac-real", owner_id: OWNER }],
  };
}

/** The state a second run meets: the sacrificial pair the first run left behind, which together with
 *  the journey row already sits at the free tier's cap of three active receivables. */
function seedRowsAfterEarlierRun() {
  const rows = seedRows();
  rows.clients.push({ id: "cl-earlier", owner_id: OWNER, name: PROBE_NAME, company: "stale-edit probe A", phone: "", email: "", notes: "", archived_at: null, updated_at: "2026-10-17T00:00:00.000Z" });
  rows.receivables.push({ id: "rc-earlier", owner_id: OWNER, client_id: "cl-earlier", label: PROBE_NAME, invoice_ref: "stale-edit probe A", notes: "", status: "OPEN", outstanding_paise: 100000, updated_at: "2026-10-17T00:00:00.000Z" });
  return rows;
}

afterAll(async () => {
  await Promise.all(
    servers.map(async (server) => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    }),
  );
});

function account() {
  return { label: "owner", email: "dw-probe@example.test", password: "probe-pw", userId: OWNER };
}

describe("Hosted stale-edit probe", () => {
  it("passes on a deployment where the fresh edit writes and both stale shapes are refused fast with DW001", async () => {
    const site = await serveBackend();
    const { findings, lines } = await runStaleEditProbes({ ...site, account: account(), log: () => {} });
    expect(lines.join("\n"), "neither routine was probed").toMatch(/update_client/);
    expect(lines.join("\n"), "the receivable routine was never probed").toMatch(/update_receivable_details/);
    expect(findings, `a healthy deployment was reported broken:\n${lines.join("\n")}`).toEqual([]);
  });

  it("measures the refusal against a ceiling instead of accepting any refusal, because the defect was a hang", async () => {
    // Pre-migration, the stale edit was unanswered at 30 s and the edge returned HTTP 504 at 125 s, while
    // the owner's read-back showed the row untouched. A run that recorded that as "refused, therefore
    // fine" would certify the very bug the migration exists to fix, so lateness has to be a finding on
    // its own — and the delay is asserted in the direction that a loaded machine can only worsen.
    const site = await serveBackend({ policy: { stallMs: 250 } });
    const { findings, lines } = await runStaleEditProbes({ ...site, account: account(), ceilingMs: 30, log: () => {} });
    expect(findings.join("\n"), `a refusal that arrived late was reported clean:\n${lines.join("\n")}`).toMatch(/stall|slow|exceeded|late/i);
    expect(lines.join("\n"), "the report never prints a measured duration, so no reader can judge the refusal").toMatch(/\d+ ms/);
  });

  it("treats a conflict raised with a retryable SQLSTATE as the un-repaired defect, not a refusal", async () => {
    // 40001 and 40P01 are the two codes PostgREST re-runs instead of forwarding
    // (migration 26 header, `:15-19`). An answer carrying one means the migration is not in force, and
    // the caller would still be staring at a hang.
    const site = await serveBackend({ policy: { conflictCode: "40001" } });
    const { findings, lines } = await runStaleEditProbes({ ...site, account: account(), log: () => {} });
    expect(findings.join("\n"), `a retryable conflict code was counted as a reachable refusal:\n${lines.join("\n")}`).toMatch(/40001|retryable|unreachable/i);
  });

  it("fails when a stale edit moves the row, proved by the owner's read-back rather than the reply", async () => {
    const site = await serveBackend({ policy: { staleApplies: true } });
    const { findings, lines } = await runStaleEditProbes({ ...site, account: account(), log: () => {} });
    expect(findings.join("\n"), `a stale write that applied was reported clean:\n${lines.join("\n")}`).toMatch(/stale/i);
  });

  it("fails when an edit that omits the token writes anyway, because the routine treats a missing token as a conflict", async () => {
    // `p_expected_updated_at` is `default null` and then tested at `:72` / `:125`: a call that leaves it
    // out is a blind write and must be refused. That is the fail-closed half of the same rule.
    const site = await serveBackend({ policy: { noTokenApplies: true } });
    const { findings, lines } = await runStaleEditProbes({ ...site, account: account(), log: () => {} });
    expect(findings.join("\n"), `a tokenless write that applied was reported clean:\n${lines.join("\n")}`).toMatch(/without.*token|missing.*token|no.*token/i);
  });

  it("fails when the fresh authorized edit is refused, because a repair aimed at refusals can break the write", async () => {
    const site = await serveBackend({ policy: { freshRefuses: true } });
    const { findings, lines } = await runStaleEditProbes({ ...site, account: account(), log: () => {} });
    expect(findings.join("\n"), `a refused fresh edit was reported clean:\n${lines.join("\n")}`).toMatch(/fresh|authorized/i);
  });

  it("refuses to call an edit stale when the applied fresh edit did not advance the lock token", async () => {
    // If `updated_at` does not move, the "stale" token the next probe presents is still current, so a
    // DW001 refusal would be about something else entirely and the run would prove nothing. A pass that
    // rests on a fictional premise is worse than no pass, because it looks like evidence.
    const site = await serveBackend({ policy: { noTokenAdvance: true } });
    const { findings, lines } = await runStaleEditProbes({ ...site, account: account(), log: () => {} });
    expect(findings.join("\n"), `a run whose stale token was never actually stale passed:\n${lines.join("\n")}`).toMatch(/token|updated_at|stale/i);
  });

  it("counts a request answered before the routine ran as inconclusive, never as a refusal", async () => {
    // `PGRST202` means the schema cache has no function with those argument names — which is what would
    // happen the moment the new signature is not yet live. Reading it as "the stale edit was refused"
    // would report the gate green on a schema-cache miss.
    const site = await serveBackend();
    const original = RPC_SIGNATURES.update_client;
    RPC_SIGNATURES.update_client = original.filter((name) => name !== "p_expected_updated_at");
    try {
      const { findings, lines } = await runStaleEditProbes({ ...site, account: account(), log: () => {} });
      expect(findings.join("\n"), `a pre-policy rejection was accepted as a refusal:\n${lines.join("\n")}`).toMatch(/PGRST202|never reached|inconclusive/i);
    } finally {
      RPC_SIGNATURES.update_client = original;
    }
  });

  it("keeps the row it edits discoverable by never writing the field it finds the row by", async () => {
    // The sacrificial client and receivable are located by `name` and `label` equal to `PROBE_NAME`, which
    // is what lets a re-run reuse them instead of growing residue the free tier refuses. An instrument
    // that proved its fresh edit by renaming the row would make its own next run unable to find it — so
    // the writable proof has to be a field that is not the lookup key.
    const site = await serveBackend();
    await runStaleEditProbes({ ...site, account: account(), log: () => {} });
    const edits = site.requests.filter((entry) => /\/rest\/v1\/rpc\/update_(client|receivable_details)$/.test(entry.asked));
    expect(edits.length, "no edit call was attempted").toBeGreaterThan(0);
    for (const entry of edits) {
      if (entry.asked.endsWith("update_client")) expect(entry.body.p_name, "a probe renamed the client it locates by name").toBe(PROBE_NAME);
      else expect(entry.body.p_label, "a probe relabelled the receivable it locates by label").toBe(PROBE_NAME);
    }
    const written = edits.map((entry) => entry.body.p_company ?? entry.body.p_invoice_ref).filter((value) => typeof value === "string" && value.length > 0);
    expect(written.length, "no edit carried a value in a field the instrument is allowed to write",).toBeGreaterThan(0);
  });

  it("reuses the sacrificial rows an earlier run left behind instead of growing past the plan's cap", async () => {
    const site = await serveBackend({ rows: seedRowsAfterEarlierRun() });
    const { findings, lines } = await runStaleEditProbes({ ...site, account: account(), log: () => {} });
    expect(findings, `a re-run was stopped by the plan's cap instead of the lock:\n${lines.join("\n")}`).toEqual([]);
    expect(site.requests.filter((entry) => entry.asked === "POST /rest/v1/rpc/create_client").length, "a second sacrificial client was created while one was there to reuse").toBe(0);
    expect(site.requests.filter((entry) => entry.asked === "POST /rest/v1/rpc/create_receivable").length, "a second sacrificial receivable was created while one was there to reuse").toBe(0);
  });

  it("aims every edit at the sacrificial rows and leaves the account's real ledger untouched", async () => {
    const site = await serveBackend();
    const { findings, lines } = await runStaleEditProbes({ ...site, account: account(), log: () => {} });
    const edits = site.requests.filter((entry) => /\/rest\/v1\/rpc\/update_/.test(entry.asked));
    expect(edits.length, "no edit ran, so this case proves nothing").toBeGreaterThan(0);
    for (const entry of edits) {
      const aimed = JSON.stringify(entry.body);
      expect(["cl-real", "rc-real", "pm-real"].some((id) => aimed.includes(id)), `${entry.asked} aimed at the account's real ledger row`).toBe(false);
    }
    expect(site.rows.clients.find((row) => row.id === "cl-real").company, "the real client's company moved").toBe("");
    expect(site.rows.receivables.find((row) => row.id === "rc-real").invoice_ref, "the real receivable's reference moved").toBe("");
    expect(findings.join("\n"), `the account's ledger was reported as moved by the probes:\n${lines.join("\n")}`).not.toMatch(/ledger moved/);
  });

  it("keeps every token, password and key out of its own report", async () => {
    const site = await serveBackend({ policy: { conflictCode: "40001", staleApplies: true } });
    const printed = [];
    const { findings, lines } = await runStaleEditProbes({ ...site, account: account(), log: (line) => printed.push(line) });
    expect(findings.length, "a clean run was reported, so this case proves nothing about redaction").toBeGreaterThan(0);
    expect(lines.length, "the instrument produced no report").toBeGreaterThan(0);
    for (const secret of [TOKEN, "probe-pw", KEY, "refresh-never-printed"]) {
      expect(printed.join("\n"), `a credential reached the operator's screen: ${secret.slice(0, 8)}…`).not.toContain(secret);
    }
  });

  it("stops before probing when no session can be established, rather than editing as a stranger", async () => {
    const site = await serveBackend();
    const { findings } = await runStaleEditProbes({ ...site, account: { ...account(), password: "wrong-pw" }, log: () => {} });
    expect(findings.join("\n"), "the run continued without a session").toMatch(/session|sign/i);
    expect(site.requests.filter((entry) => /\/rest\/v1\/rpc\/update_/.test(entry.asked)).length, "edits were attempted with no session").toBe(0);
  });

  it("pins its own target to the DueWeave production project and refuses anything else", () => {
    expect(PRODUCTION_REF).toBe("ugzdqcytouwfdlcjujqv");
    expect(projectRef(`https://${PRODUCTION_REF}.supabase.co`)).toBe(PRODUCTION_REF);
    // The production database pooler (`aws-0-ap-south-1.pooler.supabase.com:5432`, the host recorded in
    // the promotion ledger) is a wire protocol, not a REST surface, and carries no project ref in its
    // hostname. The guard's job is to refuse it: an instrument that read a ref out of anything shaped
    // like a Supabase host would happily send customer writes to a connection string.
    expect(projectRef("https://aws-0-ap-south-1.pooler.supabase.com:5432/postgres"), "the pooler is not a project surface").toBeNull();
    expect(projectRef("https://ugzdqcytouwfdlcjujqv:5432.supabase.co"), "a host with an embedded port is not a URL").toBeNull();
    expect(projectRef("http://127.0.0.1:54321")).toBeNull();
    expect(projectRef("https://rottenprojectref.supabase.co")).toBe("rottenprojectref");
    expect(assertProductionTarget(`https://${PRODUCTION_REF}.supabase.co`), "the production project was refused").toBeNull();
    expect(assertProductionTarget("https://some-other-project.supabase.co")).toMatch(/ugzdqcytouwfdlcjujqv/);
    expect(assertProductionTarget("http://127.0.0.1:54321")).toMatch(/ugzdqcytouwfdlcjujqv/);
    expect(assertProductionTarget("https://aws-0-ap-south-1.pooler.supabase.com:5432/postgres")).toMatch(/ugzdqcytouwfdlcjujqv/);
  });

  it("defaults its ceiling well below the hang it is watching for", () => {
    // Measured on the pinned local build: a private-use DW001 answered in 181 ms and again in 15 ms,
    // while 40001 and 40P01 were unanswered at 40 s and 20 s and the live edge gave up at 125 s. The
    // ceiling has to sit far under the failure and far over a normal round trip.
    expect(DEFAULT_CEILING_MS).toBeGreaterThan(1_000);
    expect(DEFAULT_CEILING_MS).toBeLessThan(30_000);
  });

  it("stays a laptop command, because it writes production rows", () => {
    for (const name of ["ci.yml", "live-public.yml", "release-full-browser.yml", "codeql-release.yml"]) {
      const body = readFileSync(path.join(projectRoot, ".github", "workflows", name), "utf8");
      expect(body, `${name} would run a production-writing probe on every push`).not.toContain("hosted-stale-edit-probe");
    }
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    for (const gate of ["verify:release:local", "verify:e2e:local", "test:e2e:smoke"]) {
      expect(pkg.scripts[gate], `${gate} must not aim writes at production`).not.toContain("hosted-stale-edit-probe");
    }
    expect(pkg.scripts["verify:hosted:stale-edit"], "the instrument has no operator command, so it will be re-run by scratch drivers").toContain("hosted-stale-edit-probe");
  });
});
