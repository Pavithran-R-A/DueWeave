#!/usr/bin/env node
// The customer-launch record has claimed cross-tenant isolation on production from hand-typed curl
// commands, each of which left behind a claim the next session could not re-derive. This instrument
// answers the question from the repository, with real customer sessions:
//
//   node scripts/hosted-tenant-isolation.mjs \
//     --victim p3c-red-baseline/qa-identity.json --attacker p3c-red-baseline/qa-identity-b.json
//
// It signs in as both accounts through the same password grant a customer's browser uses, then has
// the attacker try to read, edit, delete, insert into and RPC-call the victim's ledger; it repeats
// those reads with the anonymous key and no session and with a forged bearer, and it asks the Founder
// RPCs from a customer session, because the payment gate staying closed is a boundary the release has
// only ever read as a refusal.
//
// Four rules make it safe and honest to point at production:
//   * Reads are aimed at the victim's real rows; every destructive probe is aimed at a sacrificial
//     client, receivable and promise that the victim creates for this run and that the QA erasure
//     removes afterwards. If isolation ever regressed, the free-tier journey rows the release record
//     is built on would not be the casualty.
//   * A refused write is proved by the owner reading the row back, never by the attacker's reply:
//     PostgREST answers a write that matched no visible row with an empty representation, which is
//     indistinguishable from a write that was applied to nothing.
//   * A `PGRST…` code is never counted as a refusal. That family means the request was rejected
//     before any policy ran — an unknown function, a wrong argument name, a body PostgREST could not
//     parse — so it proves nothing about isolation and would let a typo report a green gate.
//   * No credential value is printed: tokens and passwords live in this process only, and the report
//     gives lengths, statuses and verdicts. It is a laptop and operator command, never a CI step,
//     because it writes rows to production and needs two confirmed accounts.
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_SITE = "https://dueweave.pages.dev";

/** The tables holding a customer's money ledger, in the order an operator reads them. */
export const LEDGER_TABLES = ["clients", "receivables", "promises", "payments", "activities"];

const PROBE_NAME = "DueWeave isolation probe (safe to delete)";
const HIJACK_NAME = "HIJACKED BY A CROSS-TENANT WRITE";

/** PostgREST's own codes: the request never reached a row-security policy, so it cannot be evidence
 *  that one refused it. Measured on this project's live API across the Stage 4 and Stage 8 work. */
const PRE_POLICY_CODES = new Set(["PGRST100", "PGRST102", "PGRST201", "PGRST202", "PGRST203", "PGRST204", "PGRST300", "PGRST301", "PGRST303", "PGRST900", "PGRST901"]);

function parseArgs(argv) {
  const options = { site: DEFAULT_SITE, victim: "", attacker: "", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") options.dryRun = true;
    else if (token === "--site") options.site = String(argv[++index] ?? "");
    else if (token === "--victim") options.victim = String(argv[++index] ?? "");
    else if (token === "--attacker") options.attacker = String(argv[++index] ?? "");
    else {
      console.error(`Unrecognised argument "${token}". Expected --site <origin>, --victim <identity file>, --attacker <identity file> or --dry-run.`);
      process.exit(2);
    }
  }
  return options;
}

export function request(url, init) {
  return fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(30_000) });
}

export async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && !payload.code && !payload.message) return [payload];
  return [];
}

function idsOf(payload, column = "id") {
  return rowsOf(payload).map((row) => row?.[column]).filter((value) => typeof value === "string");
}

function codeOf(payload) {
  return typeof payload?.code === "string" ? payload.code : "";
}

/**
 * Run every probe against a reachable Supabase surface with two signed-in accounts.
 *
 * `victim` and `attacker` each carry `email`, `password` and a `label` used in the report; `api` and
 * `key` are the project URL and the publishable key, which the caller reads off the deployed bundle.
 * The tokens the grants return never leave this function.
 */
export async function runIsolationProbes({ api, key, victim, attacker, log = () => {} }) {
  const lines = [];
  const findings = [];
  const report = (line) => {
    lines.push(line);
    log(line);
  };
  const problem = (line) => {
    findings.push(line);
    report(line);
  };

  async function call(session, method, pathname, { query = "", body, prefer } = {}) {
    const headers = { apikey: key, authorization: `Bearer ${session?.token ?? key}` };
    if (body) headers["content-type"] = "application/json";
    if (prefer) headers.prefer = prefer;
    const response = await request(`${api}/rest/v1/${pathname}${query}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).catch((error) => {
      problem(`${method} ${pathname} could not be sent (${error.message})`);
      return null;
    });
    if (!response) return null;
    return { status: response.status, payload: await readJson(response) };
  }

  async function signIn(account) {
    const response = await request(`${api}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ email: account.email, password: account.password }),
    }).catch((error) => {
      problem(`SESSION ${account.label} could not be probed (${error.message})`);
      return null;
    });
    if (!response) return null;
    const body = await readJson(response);
    if (response.status !== 200 || !body?.access_token) {
      problem(`SESSION ${account.label} ${account.email} was refused HTTP ${response.status} (${body?.msg ?? body?.error_description ?? "no session issued"}), so no probe was run`);
      return null;
    }
    report(`SESSION ${account.label} ${account.email} signed in (access token ${body.access_token.length} characters, user id ${body.user?.id}, neither printed again)`);
    return { ...account, token: body.access_token, userId: body.user?.id };
  }

  let declinedCount = 0;
  /** Read one row the way its owner can, which is the only view that can tell a refused write from an
   *  applied one. Returns null when the owner cannot read the row at all. */
  async function ownerRow(table, id) {
    const outcome = await call(victimSession, "GET", table, { query: `?select=*&id=eq.${id}` });
    return rowsOf(outcome?.payload)[0] ?? null;
  }

  function changedColumns(before, after) {
    if (before === null && after === null) return [];
    if (after === null) return ["the row itself"];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  }
  /** Record one probe. `refused` is the outcome the gate requires; a pre-policy rejection is called
   *  out as inconclusive instead of quietly counting, because "it would not parse" is not "it was blocked". */
  const verdict = (probe, outcome, outcomeText) => {
    const code = codeOf(outcome?.payload);
    if (PRE_POLICY_CODES.has(code)) {
      problem(`${probe} never reached a row-security policy: HTTP ${outcome.status} ${code} ${outcome?.payload?.message ?? ""}`.trim());
      return false;
    }
    if (!outcome) return false;
    const blocked = outcome.status === 401 || outcome.status === 403 || rowsOf(outcome.payload).length === 0;
    if (blocked) {
      declinedCount += 1;
      report(`REFUSED    ${probe}  HTTP ${outcome.status}${code ? ` ${code}` : ""}${outcomeText ? `, ${outcomeText}` : ""}`);
      return true;
    }
    report(`LEAK       ${probe}  HTTP ${outcome.status} returned ${rowsOf(outcome.payload).length} row(s)${code ? ` ${code}` : ""}`);
    problem(`${probe} was not refused: HTTP ${outcome.status} returned ${rowsOf(outcome.payload).length} row(s)`);
    return false;
  };

  const victimSession = await signIn(victim);
  if (!victimSession) return { findings, lines, declined: declinedCount };
  const attackerSession = await signIn(attacker);
  if (!attackerSession) return { findings, lines, declined: declinedCount };

  const inventory = {};
  for (const table of LEDGER_TABLES) {
    const asOwner = await call(victimSession, "GET", table, { query: `?select=id&order=id.asc&limit=500` });
    inventory[table] = idsOf(asOwner?.payload);
    report(`OWN        ${table} ${inventory[table].length} row(s) belong to ${victimSession.email}`);
  }
  const beforeCounts = Object.fromEntries(LEDGER_TABLES.map((table) => [table, inventory[table].length]));

  const probeClient = await call(victimSession, "POST", "rpc/create_client", {
    body: { p_name: PROBE_NAME, p_company: "", p_phone: "", p_email: "", p_notes: "Created by scripts/hosted-tenant-isolation.mjs; removed by the QA account erasure." },
    prefer: "return=representation",
  });
  const probeClientId = idsOf(probeClient?.payload)[0];
  if (!probeClientId) {
    problem(`SETUP the victim could not create a sacrificial client (HTTP ${probeClient?.status ?? "no response"} ${codeOf(probeClient?.payload)}), so no destructive probe ran`);
    return { findings, lines, declined: declinedCount };
  }
  const probeReceivable = await call(victimSession, "POST", "rpc/create_receivable", {
    body: { p_client_id: probeClientId, p_label: PROBE_NAME, p_invoice_ref: "", p_amount_due_paise: 100000, p_due_date: "2099-12-31", p_notes: "isolation probe" },
    prefer: "return=representation",
  });
  const probeReceivableId = idsOf(probeReceivable?.payload)[0];
  if (!probeReceivableId) {
    problem(`SETUP the victim could not create a sacrificial receivable (HTTP ${probeReceivable?.status ?? "no response"} ${codeOf(probeReceivable?.payload)}), so no destructive probe ran`);
    return { findings, lines, declined: declinedCount };
  }
  const probePromise = await call(victimSession, "POST", "rpc/create_promise", {
    body: { p_receivable_id: probeReceivableId, p_promised_amount_paise: 100000, p_made_on: "2099-12-01", p_promised_date: "2099-12-31", p_source: "verbal", p_note: "isolation probe", p_request_id: `isolation-probe-${Date.now()}` },
    prefer: "return=representation",
  });
  const probePromiseId = idsOf(probePromise?.payload)[0];
  report(`SETUP      sacrificial client ${probeClientId}, receivable ${probeReceivableId}${probePromiseId ? `, promise ${probePromiseId}` : `, no promise row (HTTP ${probePromise?.status} ${codeOf(probePromise?.payload)})`}`);

  for (const table of LEDGER_TABLES) {
    for (const id of inventory[table]) {
      const read = await call(attackerSession, "GET", table, { query: `?select=*&id=eq.${id}` });
      verdict(`read victim ${table} ${id}`, read, read && `the account's own read shows ${inventory[table].length} row(s) exist`);
    }
    const wide = await call(attackerSession, "GET", table, { query: `?select=id&limit=1000` });
    const stolen = idsOf(wide?.payload).filter((id) => inventory[table].includes(id));
    if (stolen.length > 0) {
      report(`LEAK       list ${table} as the attacker  ${stolen.length} victim row(s) came back`);
      problem(`list ${table} as the attacker returned ${stolen.length} of the victim's own rows`);
    } else {
      declinedCount += 1;
      report(`REFUSED    list ${table} as the attacker  HTTP ${wide?.status} with ${rowsOf(wide?.payload).length} row(s) of the victim's ${inventory[table].length}`);
    }
  }

  verdict("read victim profile as the attacker", await call(attackerSession, "GET", "profiles", { query: `?select=*&id=eq.${victimSession.userId}` }));
  verdict("read victim entitlement as the attacker", await call(attackerSession, "GET", "entitlements", { query: `?select=*&user_id=eq.${victimSession.userId}` }));
  verdict("read founder_admins as a customer", await call(attackerSession, "GET", "founder_admins", { query: `?select=*` }));

  const patch = await call(attackerSession, "PATCH", "clients", { query: `?id=eq.${probeClientId}`, body: { name: HIJACK_NAME }, prefer: "return=representation" });
  const patchedBack = await call(victimSession, "GET", "clients", { query: `?select=name&id=eq.${probeClientId}` });
  const nameNow = rowsOf(patchedBack?.payload)[0]?.name;
  if (nameNow !== PROBE_NAME) {
    report(`APPLIED    patch victim probe client  the owner reads "${nameNow}" where the attacker wrote "${HIJACK_NAME}"`);
    problem(`patch victim probe client was applied: the owner's read-back shows the attacker's value`);
  } else {
    verdict(`patch victim probe client`, patch, "the owner still reads the probe name");
  }

  const deleteAttempt = await call(attackerSession, "DELETE", "receivables", { query: `?id=eq.${probeReceivableId}`, prefer: "return=representation" });
  const stillThere = await call(victimSession, "GET", "receivables", { query: `?select=id&id=eq.${probeReceivableId}` });
  if (rowsOf(stillThere?.payload).length === 0) {
    report("APPLIED    delete victim probe receivable  the owner can no longer read the row back");
    problem("delete victim probe receivable was applied: the sacrificial row is gone");
  } else {
    verdict("delete victim probe receivable", deleteAttempt, "the owner still reads the row");
  }

  verdict("insert into clients with the victim's owner_id", await call(attackerSession, "POST", "clients", { body: { owner_id: victimSession.userId, name: "Foreign insert with a spoofed owner" }, prefer: "return=representation" }));

  // Every cross-tenant attack below names a row the victim owns, because that is the only question
  // isolation can answer. `mark_due_promises_broken` is deliberately absent: it takes no target and
  // sweeps the caller's own promises, so calling it on production would write real rows to prove
  // nothing about a boundary.
  //
  // A targeted attack also carries the row it aimed at, because the attacker's reply cannot be the
  // evidence for a write: a function declared to return nothing answers an applied call with the same
  // empty body as a refused one, and the mutate-in-place attacks move no row count, so the recount
  // that guards the victim's ledger at the end of this run is blind to them too.
  const rpcAttacks = [
    ["record_payment on the victim's receivable", "rpc/record_payment", { p_receivable_id: probeReceivableId, p_amount_paise: 1, p_paid_on: "2099-12-01", p_method: "cash", p_reference: "isolation probe", p_request_id: `isolation-payment-${Date.now()}` }, false, { table: "receivables", id: probeReceivableId }],
    ["create_promise on the victim's receivable", "rpc/create_promise", { p_receivable_id: probeReceivableId, p_promised_amount_paise: 1, p_made_on: "2099-12-01", p_promised_date: "2099-12-31", p_source: "verbal", p_note: "isolation probe", p_request_id: `isolation-promise-${Date.now()}` }, false, { table: "receivables", id: probeReceivableId }],
    ["cancel_receivable on the victim's receivable", "rpc/cancel_receivable", { p_receivable_id: probeReceivableId, p_reason: "isolation probe" }, false, { table: "receivables", id: probeReceivableId }],
    ["snooze_receivable on the victim's receivable", "rpc/snooze_receivable", { p_receivable_id: probeReceivableId, p_until: "2099-12-31" }, false, { table: "receivables", id: probeReceivableId }],
    ["update_receivable_details on the victim's receivable", "rpc/update_receivable_details", { p_receivable_id: probeReceivableId, p_label: HIJACK_NAME, p_invoice_ref: "", p_amount_due_paise: 1, p_due_date: "2099-12-31", p_notes: "" }, false, { table: "receivables", id: probeReceivableId }],
    ["update_client on the victim's client", "rpc/update_client", { p_client_id: probeClientId, p_name: HIJACK_NAME, p_company: "", p_phone: "", p_email: "", p_notes: "" }, false, { table: "clients", id: probeClientId }],
    ["create_receivable inside the victim's client", "rpc/create_receivable", { p_client_id: probeClientId, p_label: HIJACK_NAME, p_invoice_ref: "", p_amount_due_paise: 1, p_due_date: "2099-12-31", p_notes: "" }, false, { table: "clients", id: probeClientId }],
    ...(probePromiseId ? [["cancel_promise on the victim's promise", "rpc/cancel_promise", { p_promise_id: probePromiseId, p_reason: "isolation probe" }, false, { table: "promises", id: probePromiseId }]] : []),
    ["get_founder_offer as a customer", "rpc/get_founder_offer", {}, true, null],
    ["list_pending_founder_claims as a customer", "rpc/list_pending_founder_claims", {}, true, null],
    ["get_founder_funnel as a customer", "rpc/get_founder_funnel", {}, true, null],
  ];
  for (const [probe, pathname, body, isFounderGate, target] of rpcAttacks) {
    const before = target ? await ownerRow(target.table, target.id) : null;
    if (target && before === null) {
      problem(`${probe} was not attempted: the victim cannot read back its own ${target.table} ${target.id}, so this run has no way to tell whether the attack applied`);
      continue;
    }
    const outcome = await call(attackerSession, "POST", pathname, { body, prefer: "return=representation" });
    if (!outcome) continue;
    if (target) {
      const after = await ownerRow(target.table, target.id);
      const moved = changedColumns(before, after);
      if (moved.length > 0) {
        const detail = after === null ? `${target.table} ${target.id} no longer reads back at all` : moved.map((column) => `${column} went from ${JSON.stringify(before[column])} to ${JSON.stringify(after[column])}`).join(", ");
        report(`APPLIED    ${probe}  the owner reads ${detail}`);
        problem(`${probe} was applied: the owner's read-back shows ${detail}`);
        continue;
      }
    }
    const code = codeOf(outcome.payload);
    if (PRE_POLICY_CODES.has(code)) {
      problem(`${probe} never reached a row-security policy: HTTP ${outcome.status} ${code} ${outcome?.payload?.message ?? ""}`.trim());
      continue;
    }
    const blocked = outcome.status === 401 || outcome.status === 403 || rowsOf(outcome.payload).length === 0;
    if (isFounderGate) {
      if (blocked) {
        declinedCount += 1;
        report(`CLOSED     ${probe}  HTTP ${outcome.status}${code ? ` ${code}` : ""}, so the Founder payment gate stays shut for a customer session`);
      } else {
        report(`OPEN       ${probe}  answered a customer session with ${rowsOf(outcome.payload).length} row(s)`);
        problem(`${probe}: the Founder payment gate opened for a customer session`);
      }
      continue;
    }
    if (blocked) {
      declinedCount += 1;
      report(`REFUSED    ${probe}  HTTP ${outcome.status}${code ? ` ${code}` : ""}`);
    } else {
      report(`APPLIED    ${probe}  HTTP ${outcome.status} returned ${rowsOf(outcome.payload).length} row(s)`);
      problem(`${probe} was applied: HTTP ${outcome.status} returned ${rowsOf(outcome.payload).length} row(s)`);
    }
  }

  for (const table of [...LEDGER_TABLES, "profiles", "entitlements", "founder_admins"]) {
    const outcome = await call(null, "GET", table, { query: `?select=id&limit=5` });
    const anonymousEmpty = outcome && rowsOf(outcome.payload).length === 0;
    if (anonymousEmpty) {
      declinedCount += 1;
      report(`REFUSED    anon read ${table}  HTTP ${outcome.status} with nothing exposed`);
    } else {
      report(`LEAK       anon read ${table}  HTTP ${outcome?.status} returned ${rowsOf(outcome?.payload).length} row(s)`);
      problem(`anon read ${table}: the anonymous role exposed ${rowsOf(outcome?.payload).length} row(s) with no session at all`);
    }
  }
  const forged = await call({ token: "not-a-real-session-token" }, "GET", "clients", { query: `?select=id&limit=5` });
  verdict("forged bearer read clients", forged, "no session behind it");

  const changed = [];
  for (const table of LEDGER_TABLES) {
    const asOwner = await call(victimSession, "GET", table, { query: `?select=id&limit=500` });
    const now = idsOf(asOwner?.payload).filter((id) => id !== probeClientId && id !== probeReceivableId && id !== probePromiseId);
    if (now.length !== beforeCounts[table]) changed.push(`${table} ${beforeCounts[table]} -> ${now.length}`);
  }
  if (changed.length > 0) problem(`the victim's real ledger moved during the probes: ${changed.join(", ")}`);
  else report(`OWN        ${victimSession.email}'s real ledger reads identical after every probe`);

  return { findings, lines, declined: declinedCount };
}

export function longestKey(chunk) {
  const matches = chunk.match(/sb_publishable_[A-Za-z0-9_-]+/g) ?? [];
  return matches.reduce((longest, match) => (longest === null || match.length > longest.length ? match : longest), null);
}

export function projectUrl(chunk, key) {
  const before = chunk.slice(0, chunk.indexOf(key));
  const matches = before.match(/https?:\/\/[^\s"'`)\\]+/g) ?? [];
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

export function readIdentity(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed?.email && parsed?.password ? parsed : null;
  } catch {
    return null;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let site;
  try {
    site = new URL(options.site).origin;
  } catch {
    console.error(`--site must be a full http(s) origin, and "${options.site}" is not one.`);
    process.exit(2);
  }
  console.log(`PLAN       reads aimed at the victim's own ${LEDGER_TABLES.join(", ")} rows; every write and RPC attack aimed at a sacrificial row the victim creates first; anon, forged-bearer and Founder-gate probes alongside`);
  if (options.dryRun) {
    console.log("DRY-RUN    nothing sent: sign in twice, read the victim's inventory, create three sacrificial rows, then probe. Needs two confirmed accounts and writes real rows, so it never runs in CI.");
    return 0;
  }
  if (!options.victim || !options.attacker) {
    console.error("both --victim and --attacker must name an identity file, because the question this instrument answers is what one signed-in customer can do to another.");
    process.exit(2);
  }
  const victim = readIdentity(options.victim);
  const attacker = readIdentity(options.attacker);
  const unreadable = [!victim ? options.victim : null, !attacker ? options.attacker : null].filter(Boolean);
  if (unreadable.length > 0) {
    console.error(`refused: ${unreadable.join(" and ")} holds no readable email and password. Identity files are untracked scratch, and \`password\` must be the credential the account signs in with today.`);
    process.exit(1);
  }
  if (victim.email.toLowerCase() === attacker.email.toLowerCase()) {
    console.error("refused: --victim and --attacker are the same account, so every probe would compare an account with itself and report an isolation it never tested.");
    process.exit(2);
  }

  let entry = "";
  let chunk = "";
  try {
    const html = await (await request(`${site}/`, { headers: { accept: "text/html" } })).text();
    entry = html.match(/\/?assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? "";
    if (!entry) throw new Error("the served HTML links no entry chunk");
    chunk = await (await request(`${site}/${entry.replace(/^\/+/, "")}`, { headers: { accept: "application/javascript" } })).text();
  } catch (error) {
    console.error(`the deployed site at ${site} could not be read (${error.message}), so no hosted state was measured`);
    process.exit(1);
  }
  const key = longestKey(chunk);
  const api = key ? projectUrl(chunk, key) : null;
  if (!api) {
    console.error(`${entry} carries no publishable key beside a project URL, so nothing could be probed — the deployed bundle is not the one expected`);
    process.exit(1);
  }
  console.log(`SITE       ${site} entry ${entry.replace(/^\/+/, "")}`);
  console.log(`API        ${api}`);
  console.log(`KEY        publishable key read from the served bundle (${key.length} characters, never printed)`);

  const { findings, declined } = await runIsolationProbes({
    api,
    key,
    victim: { label: "victim", ...victim },
    attacker: { label: "attacker", ...attacker },
    log: (line) => console.log(line),
  });
  console.log(`DONE       ${declined} probe(s) declined as expected, ${findings.length} finding(s)`);
  if (findings.length > 0) {
    console.error(`ISOLATION NOT PROVEN — ${findings.length} finding(s):`);
    for (const line of findings) console.error(`  ${line}`);
    return 1;
  }
  console.log("Isolation holds: one signed-in customer could read, edit, delete, insert into or RPC-call nothing belonging to another, the anonymous and forged-bearer roles exposed nothing, and the Founder payment gate stayed closed.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (error) => {
    console.error(`isolation probes failed: ${error?.message ?? error}`);
    process.exit(1);
  });
}
