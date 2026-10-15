import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runIsolationProbes } from "../scripts/hosted-tenant-isolation.mjs";

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
      requests.push({ asked: `${request.method} ${url.pathname}${url.search}`, body: json, hasBearer: Boolean(request.headers.authorization && request.headers.authorization !== `Bearer ${KEY}`), asOwner: caller === OWNER_A });
      const reply = (status, payload) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };

      if (url.pathname === "/auth/v1/token") {
        const entry = tokens[json.password];
        if (!entry) return reply(400, { msg: "Invalid login credentials" });
        return reply(200, { access_token: entry.token, refresh_token: `refresh-for-${entry.owner}`, user: { id: entry.owner } });
      }

      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fn = url.pathname.split("/").pop();
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
        const targetTable = ["create_promise", "record_payment", "cancel_receivable", "snooze_receivable", "update_receivable_details"].includes(fn)
          ? "receivables"
          : fn === "cancel_promise"
            ? "promises"
            : fn === "update_client"
              ? "clients"
              : null;
        if (targetTable) {
          const id = json.p_receivable_id ?? json.p_promise_id ?? json.p_client_id;
          const target = rows[targetTable].find((row) => row.id === id);
          if (!target || target.owner_id !== caller) return reply(403, { code: "42501", message: "row-level security" });
        }
        if (fn === "create_client") {
          const row = { id: `cl-probe-${requests.length}`, owner_id: caller, name: json.p_name };
          rows.clients.push(row);
          return reply(201, row);
        }
        if (fn === "create_receivable") {
          const client = rows.clients.find((entry) => entry.id === json.p_client_id);
          if (!client || client.owner_id !== caller) return reply(403, { code: "42501", message: "row-level security" });
          const row = { id: `rc-probe-${requests.length}`, owner_id: caller, client_id: client.id, label: json.p_label, status: "OPEN" };
          rows.receivables.push(row);
          return reply(201, row);
        }
        if (fn === "create_promise") {
          const row = { id: `pm-probe-${requests.length}`, owner_id: caller, receivable_id: json.p_receivable_id, status: "OPEN" };
          rows.promises.push(row);
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

  it("keeps every token and password out of its own report", async () => {
    const site = await serveBackend({ policy: { readLeak: true, founderOpen: true } });
    const printed = [];
    const { findings, lines } = await runIsolationProbes({ ...site, ...sessions(), log: (line) => printed.push(line) });
    expect(findings.length, "a clean run was reported, so this case proves nothing about redaction").toBeGreaterThan(0);
    expect(lines.length, "the instrument produced no report").toBeGreaterThan(0);
    for (const secret of [TOKEN_A, TOKEN_B, "victim-pw", "attacker-pw", KEY]) {
      expect(printed.join("\n"), `a credential value reached the operator's screen: ${secret.slice(0, 8)}…`).not.toContain(secret);
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
