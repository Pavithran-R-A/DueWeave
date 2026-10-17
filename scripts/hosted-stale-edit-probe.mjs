#!/usr/bin/env node
// The release plan's step 8 is "run the hosted stale-edit test", and until now that question had no
// committed instrument: it could only be answered by scratch drivers, which is how "the stale edit was
// refused fast on production" decays into a memory. This is that proof as one operator command.
//
//   node scripts/hosted-stale-edit-probe.mjs --account p3c-red-baseline/qa-identity.json
//
// For each of the two edit routines, it reads a sacrificial row the account owns, writes it with the
// lock token it just read (the authorized fresh edit), then tries the same write with the token the
// fresh edit made stale, then tries it with no token at all. The first must land; the other two must be
// refused with DW001, promptly, and must leave the row exactly as the fresh edit left it.
//
// Why timing is asserted rather than inferred. Before migration 26 the stale edit raised its conflict
// with SQLSTATE 40001, the code whose standard meaning is "roll back and run this again"; PostgREST
// obeys that reading, so the customer's request was re-run until the edge gave up at 125 s while the
// owner's read-back showed the row untouched (measured on the live project 2026-10-16 and on the pinned
// local v14.18 build 2026-10-17, and recorded in the header of
// `supabase/migrations/20261017090000_current_cl39_edit_conflict_errcode_reachable.sql`). An instrument
// that asked only "was it refused" would therefore have reported the hang as a pass. Lateness is a
// finding here, and so is a refusal carrying a retryable code, because that means the migration is not
// in force.
//
// Four rules keep it safe and honest to point at production:
//   * Every write is aimed at a row labelled for probing, never at the free-tier journey rows the
//     release record is built on — and the probe writes a field it does not use to find the row, so it
//     stays discoverable on the next run instead of growing residue the plan's cap refuses.
//   * A write is judged by the owner reading the row back, never by the caller's reply.
//   * The target must be this project's production ref, checked before anything is sent.
//   * No credential value is printed. Tokens and passwords live in this process only.
import { pathToFileURL } from "node:url";
import path from "node:path";
import { request, readJson, longestKey, projectUrl, readIdentity, PROBE_NAME, LEDGER_TABLES } from "./hosted-tenant-isolation.mjs";

export { PROBE_NAME };

const DEFAULT_SITE = "https://dueweave.pages.dev";

/** The hosted project this instrument is allowed to write to. Anything else is refused before a request
 *  leaves, because the question it answers is about production's behaviour specifically. */
export const PRODUCTION_REF = "ugzdqcytouwfdlcjujqv";

/** A refusal has to arrive inside this to count as the repair rather than the hang. Measured against
 *  the two sides of the defect: a private-use DW001 answered in 181 ms and again in 15 ms on the pinned
 *  build, while a retryable code was unanswered at 20-40 s and the live edge gave up at 125 s. Ten
 *  seconds clears an ordinary round trip over a transatlantic pooler by two orders of magnitude and
 *  still sits far under the failure it watches for. */
export const DEFAULT_CEILING_MS = 10_000;

/** The codes whose standard meaning is "retry this". Reaching the caller with one of these is the
 *  un-repaired defect, not a refusal: `supabase/tests/stage4_02_edit_conflict_code.sql` sweeps for
 *  exactly this pair, for exactly this reason. */
const RETRYABLE_CODES = new Set(["40001", "40P01"]);

/** PostgREST's own family: the request never reached the routine, so it proves nothing about it. */
const PRE_POLICY_CODES = new Set(["PGRST100", "PGRST102", "PGRST201", "PGRST202", "PGRST203", "PGRST204", "PGRST300", "PGRST301", "PGRST303", "PGRST900", "PGRST901"]);

/**
 * The two routines migration 26 redefines, and how to probe each.
 *
 * `keyField` is what setup locates the sacrificial row by and is therefore sent back unchanged on every
 * call; `writeField` is the one the probe actually moves. The two have to differ, or proving the fresh
 * edit by renaming the row would leave the next run unable to find its own target — on the free tier
 * that is not a re-run, it is a `HTTP 400 P0001` from `enforce_free_receivable_limit`
 * (`20260812150500_secure_foundation.sql:258`) at setup with zero probes printed.
 */
const ROUTINES = [
  {
    rpc: "update_client",
    table: "clients",
    idParameter: "p_client_id",
    keyField: "name",
    writeField: "company",
    writeParameter: "p_company",
    identity: { p_name: PROBE_NAME, p_phone: "", p_email: "", p_notes: "" },
    absentMessage: "That client is not available in this private ledger",
  },
  {
    rpc: "update_receivable_details",
    table: "receivables",
    idParameter: "p_receivable_id",
    keyField: "label",
    writeField: "invoice_ref",
    writeParameter: "p_invoice_ref",
    identity: { p_label: PROBE_NAME, p_notes: "" },
    absentMessage: "That receivable is not available in this private ledger",
  },
];

/** The value the authorized fresh edit lands, and the value a rejected edit must never land. Both are
 *  inside the 160-character ceiling `company` and `invoice_ref` share. */
const FRESH_VALUE = "stale-edit probe A";
const REJECTED_VALUE = "stale-edit probe B (a rejected edit must never land here)";

/** The ref in `https://<ref>.supabase.co`, or null when the URL is not a hosted project surface. A
 *  pooler host carrying a port in its first label still resolves to the project's ref, because that is
 *  the shape `supabase/.temp/pooler-url` holds. */
export function projectRef(apiUrl) {
  let host;
  try {
    host = new URL(apiUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.endsWith(".supabase.co")) return null;
  const first = host.split(".")[0];
  return /^[a-z0-9]{6,20}$/.test(first) ? first : null;
}

/** The message that names why a target is refused, or null when it is production. Kept apart from the
 *  run so a case can prove the guard answers for any host, including the loopback one the suite uses. */
export function assertProductionTarget(apiUrl) {
  const ref = projectRef(apiUrl);
  if (ref === PRODUCTION_REF) return null;
  return `refusing to write: ${apiUrl} resolves to project ${ref ?? "no ref (not a *.supabase.co project surface)"}, and this instrument only aims at DueWeave production ${PRODUCTION_REF}. Point --site at the deployed build that carries that project's key, or run it against the local stack through the local edit suite instead.`;
}

function parseArgs(argv) {
  const options = { site: DEFAULT_SITE, account: "", ceilingMs: DEFAULT_CEILING_MS, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") options.dryRun = true;
    else if (token === "--site") options.site = String(argv[++index] ?? "");
    else if (token === "--account") options.account = String(argv[++index] ?? "");
    else if (token === "--ceiling-ms") options.ceilingMs = Number(argv[++index]);
    else {
      console.error(`Unrecognised argument "${token}". Expected --site <origin>, --account <identity file>, --ceiling-ms <ms> or --dry-run.`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(options.ceilingMs) || options.ceilingMs <= 0) {
    console.error("--ceiling-ms must be a positive number of milliseconds, because a ceiling of zero or NaN would refuse every prompt answer as a stall.");
    process.exit(2);
  }
  return options;
}

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && !payload.code && !payload.message) return [payload];
  return [];
}

function idsOf(payload) {
  return rowsOf(payload).map((row) => row?.id).filter((value) => typeof value === "string");
}

function codeOf(payload) {
  return typeof payload?.code === "string" ? payload.code : "";
}

/**
 * Run the fresh/stale/tokenless sequence against a reachable Supabase surface with one signed-in
 * account. `api` and `key` are the project URL and publishable key, which the caller reads off the
 * deployed bundle so the question is asked of the surface customers actually use.
 */
export async function runStaleEditProbes({ api, key, account, ceilingMs = DEFAULT_CEILING_MS, log = () => {} }) {
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

  async function call(session, pathname, body) {
    const started = Date.now();
    try {
      const response = await request(`${api}/rest/v1/${pathname}`, {
        method: "POST",
        headers: { apikey: key, authorization: `Bearer ${session.token}`, "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify(body),
      });
      return { elapsedMs: Date.now() - started, status: response.status, payload: await readJson(response) };
    } catch (error) {
      // No reply at all is the shape of the defect at its worst: the transport kept re-running the
      // raise until something gave up. It cannot be reported as "not measured".
      return { elapsedMs: Date.now() - started, status: null, payload: null, transportError: error.message };
    }
  }

  async function ownerRead(table, id) {
    const response = await request(`${api}/rest/v1/${table}?select=*&id=eq.${id}`, { headers: { apikey: key, authorization: `Bearer ${session.token}` } }).catch(() => null);
    if (!response) return null;
    return rowsOf(await readJson(response))[0] ?? null;
  }

  async function signIn() {
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
      problem(`SESSION ${account.label} ${account.email} was refused HTTP ${response.status} (${body?.msg ?? body?.error_description ?? "no session issued"}), so no edit was attempted`);
      return null;
    }
    report(`SESSION ${account.label} ${account.email} signed in (access token ${body.access_token.length} characters, user id ${body.user?.id}, neither printed again)`);
    return { token: body.access_token };
  }

  const session = await signIn();
  if (!session) return { findings, lines };

  const ownRows = async (table, select) => {
    const response = await request(`${api}/rest/v1/${table}?select=${select}&order=id.asc&limit=500`, { headers: { apikey: key, authorization: `Bearer ${session.token}` } }).catch(() => null);
    return response ? rowsOf(await readJson(response)) : [];
  };

  // Setup reuses the sacrificial pair this run label is already on — including the pair
  // `scripts/hosted-tenant-isolation.mjs` leaves behind, which is why the name is imported rather than
  // reinvented. A second instrument minting its own probe rows on a free-tier account would be refused
  // by the plan's own cap on its next run.
  const foundClient = (await ownRows("clients", "id,name,archived_at")).find((row) => row.name === PROBE_NAME && !row.archived_at);
  const clientOutcome = foundClient
    ? null
    : await call(session, "rpc/create_client", { p_name: PROBE_NAME, p_company: "", p_phone: "", p_email: "", p_notes: "Created by scripts/hosted-stale-edit-probe.mjs; removed by the QA account erasure." });
  const clientId = foundClient?.id ?? idsOf(clientOutcome?.payload)[0];

  const foundReceivable = (await ownRows("receivables", "id,label,status,client_id")).find((row) => row.label === PROBE_NAME && row.client_id === clientId && (row.status === "OPEN" || row.status === "PARTIALLY_PAID"));
  const receivableOutcome = foundReceivable
    ? null
    : await call(session, "rpc/create_receivable", { p_client_id: clientId, p_label: PROBE_NAME, p_invoice_ref: "", p_amount_due_paise: 100_000, p_due_date: "2099-12-31", p_notes: "stale edit probe" });
  const receivableId = foundReceivable?.id ?? idsOf(receivableOutcome?.payload)[0];
  if (!clientId || !receivableId) {
    const failed = !clientId ? clientOutcome : receivableOutcome;
    problem(`SETUP the account could not provide a sacrificial client and receivable (HTTP ${failed?.status ?? "no response"} ${codeOf(failed?.payload)}: ${failed?.payload?.message ?? "no message"}), so no edit was attempted`);
    return { findings, lines };
  }
  report(`SETUP      ${foundClient ? "reused" : "created"} client ${clientId}, ${foundReceivable ? "reused" : "created"} receivable ${receivableId}`);

  // The protected window starts after setup: creating the receivable inserts ledger activity rows of its
  // own, and a baseline taken before that would report the instrument's own setup as data movement.
  const protectedIds = {};
  for (const table of LEDGER_TABLES) {
    const response = await request(`${api}/rest/v1/${table}?select=id&limit=500`, { headers: { apikey: key, authorization: `Bearer ${session.token}` } }).catch(() => null);
    protectedIds[table] = new Set(response ? idsOf(await readJson(response)) : []);
  }

  const targets = { update_client: clientId, update_receivable_details: receivableId };

  for (const routine of ROUTINES) {
    const id = targets[routine.rpc];
    const before = await ownerRead(routine.table, id);
    if (!before) {
      problem(`${routine.rpc} was not attempted: the owner cannot read its own ${routine.table} ${id} back, so this run has no way to judge any answer`);
      continue;
    }
    const staleToken = before.updated_at;
    if (typeof staleToken !== "string" || staleToken.length === 0) {
      problem(`${routine.rpc} was not attempted: the ${routine.table} row carries no readable updated_at, and the lock token is that column`);
      continue;
    }

    const body = (writeValue, withToken) => ({
      [routine.idParameter]: id,
      ...routine.identity,
      [routine.writeParameter]: writeValue,
      ...(withToken ? { p_expected_updated_at: withToken } : {}),
    });

    const fresh = await call(session, `rpc/${routine.rpc}`, body(FRESH_VALUE, staleToken));
    const afterFresh = await ownerRead(routine.table, id);
    const freshCode = codeOf(fresh.payload);
    if (PRE_POLICY_CODES.has(freshCode)) {
      problem(`${routine.rpc} fresh edit never reached the routine: HTTP ${fresh.status} ${freshCode} ${fresh.payload?.message ?? ""} — the arguments sent are not the signature the schema cache holds`.trim());
      continue;
    }
    if (!afterFresh || afterFresh[routine.writeField] !== FRESH_VALUE) {
      problem(`FRESH ${routine.rpc} was refused: the authorized edit carrying the token it just read answered HTTP ${fresh.status} ${freshCode || "no code"} in ${fresh.elapsedMs} ms${fresh.transportError ? ` (${fresh.transportError})` : ""}, and the owner reads "${afterFresh?.[routine.writeField] ?? "nothing"}" where "${FRESH_VALUE}" was asked for`);
      continue;
    }
    if (afterFresh.updated_at === staleToken) {
      // `set_updated_at` is a before-update trigger on both tables, so an applied edit always advances
      // the token. Without that movement the next call's token was never stale, and a DW001 refusal
      // after it would be about something else while this report said "conflict refused".
      problem(`${routine.rpc} cannot be judged: the applied fresh edit left updated_at at "${staleToken}", so no token in this run is actually stale and the conflict path was never reached`);
      continue;
    }
    report(`FRESH      ${routine.rpc}  HTTP ${fresh.status} in ${fresh.elapsedMs} ms, the owner reads "${FRESH_VALUE}" and the lock token moved from ${staleToken} to ${afterFresh.updated_at}`);

    for (const [label, presented] of [["STALE", staleToken], ["NO-TOKEN", null]]) {
      const attempt = await call(session, `rpc/${routine.rpc}`, body(REJECTED_VALUE, presented));
      const after = await ownerRead(routine.table, id);
      const code = codeOf(attempt.payload);
      if (after?.[routine.writeField] === REJECTED_VALUE) {
        problem(`${label} ${routine.rpc} was applied: the owner reads "${REJECTED_VALUE}" where only "${FRESH_VALUE}" was authorized${presented ? ` (token ${presented} was already spent)` : " (no lock token was sent)"}`);
        continue;
      }
      if (PRE_POLICY_CODES.has(code)) {
        problem(`${label} ${routine.rpc} never reached the routine: HTTP ${attempt.status} ${code} ${attempt.payload?.message ?? ""}`.trim());
        continue;
      }
      if (RETRYABLE_CODES.has(code)) {
        problem(`${label} ${routine.rpc} raised ${code}, a code the transport retries instead of forwarding: migration 26 is not in force on this project, so the customer is still waiting on a refusal nobody can see`);
        continue;
      }
      if (attempt.status === null) {
        problem(`${label} ${routine.rpc} answered nothing at all in ${attempt.elapsedMs} ms (${attempt.transportError}): that is the shape of the pre-migration hang, where the request was re-run until the edge gave up`);
        continue;
      }
      if (code !== "DW001") {
        problem(`${label} ${routine.rpc} was refused by something other than the conflict rule: HTTP ${attempt.status} ${code || "no code"} "${attempt.payload?.message ?? ""}", and the owner reads "${after?.[routine.writeField] ?? "nothing"}"`.trim());
        continue;
      }
      if (after?.updated_at !== afterFresh.updated_at) {
        problem(`${label} ${routine.rpc} refused with DW001 yet moved the row's lock token from ${afterFresh.updated_at} to ${after.updated_at}: a refused write must change nothing the owner can read`);
        continue;
      }
      if (attempt.elapsedMs > ceilingMs) {
        problem(`${label} ${routine.rpc} exceeded the ceiling: DW001 arrived in ${attempt.elapsedMs} ms where the release requires under ${ceilingMs} ms — a refusal the customer never waits out is the whole of this repair`);
        continue;
      }
      report(`${label.padEnd(11)}${routine.rpc}  HTTP ${attempt.status} ${code} in ${attempt.elapsedMs} ms (ceiling ${ceilingMs} ms), the owner still reads "${FRESH_VALUE}" and the token is unchanged`);
    }
  }

  const changed = [];
  for (const table of LEDGER_TABLES) {
    const response = await request(`${api}/rest/v1/${table}?select=id&limit=500`, { headers: { apikey: key, authorization: `Bearer ${session.token}` } }).catch(() => null);
    const now = new Set(response ? idsOf(await readJson(response)) : []);
    const lost = [...protectedIds[table]].filter((id) => !now.has(id));
    const gained = [...now].filter((id) => !protectedIds[table].has(id));
    if (lost.length > 0) changed.push(`${table} lost ${lost.length} row(s)`);
    if (gained.length > 0) changed.push(`${table} gained ${gained.length} row(s)`);
  }
  if (changed.length > 0) problem(`the account's ledger moved during the probes: ${changed.join(", ")}`);
  else report(`OWN        ${account.email}'s ledger holds the same rows after every probe as before it, sacrificial rows included`);

  return { findings, lines };
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
  if (options.dryRun) {
    console.log(`PLAN       for update_client and update_receivable_details: read a sacrificial row, write it with the token just read, then retry with that spent token and with no token at all. Refusals must be DW001 inside ${options.ceilingMs} ms and must change nothing the owner can read.`);
    console.log("DRY-RUN    nothing sent: it needs one confirmed account and writes real rows, so it never runs in CI.");
    return 0;
  }
  if (!options.account) {
    console.error("--account must name an identity file, because the question this instrument answers is what a signed-in customer's own stale edit does on production.");
    process.exit(2);
  }
  const identity = readIdentity(options.account);
  if (!identity) {
    console.error(`refused: ${options.account} holds no readable email and password. Identity files are untracked scratch, and \`password\` must be the credential the account signs in with today.`);
    process.exit(1);
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
  const refused = assertProductionTarget(api);
  if (refused) {
    console.error(refused);
    process.exit(1);
  }
  console.log(`SITE       ${site} entry ${entry.replace(/^\/+/, "")}`);
  console.log(`API        ${api} (project ${projectRef(api)})`);
  console.log(`KEY        publishable key read from the served bundle (${key.length} characters, never printed)`);
  console.log(`CEILING    ${options.ceilingMs} ms per refusal`);

  const { findings } = await runStaleEditProbes({
    api,
    key,
    account: { label: "owner", ...identity },
    ceilingMs: options.ceilingMs,
    log: (line) => console.log(line),
  });
  if (findings.length > 0) {
    console.error(`STALE-EDIT NOT PROVEN — ${findings.length} finding(s):`);
    for (const line of findings) console.error(`  ${line}`);
    return 1;
  }
  console.log("Stale-edit holds on production: the authorized fresh edit wrote, a spent token and a missing token were each refused with DW001 inside the ceiling, and neither rejection changed anything the owner can read.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => {
    process.exitCode = code;
  }, (error) => {
    console.error(`the stale-edit probe failed: ${error?.message ?? error}`);
    process.exitCode = 1;
  });
}
