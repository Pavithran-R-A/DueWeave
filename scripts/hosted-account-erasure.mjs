#!/usr/bin/env node
// B17's open half, as an operator command. The hosted erasure *boundary* has been proved twice
// already — an unauthenticated `POST functions/v1/delete-account` is refused with 401 by the
// function's own session check, and its preflight answers 204 with the site's own origin allowed —
// but no signed-in account has ever been erased on production and shown what the database looks
// like afterwards. Without that second census, "the account and its records are gone" is a
// description of migration 25's DELETE statements rather than a measurement.
//
// This instrument signs in as the account holder, reads the census, calls the function with the
// holder's own bearer, reads the census again, and then tries the credential a third time. What it
// prints is a judgement against the numbers it started with, so the four ways an erasure can lie are
// all caught:
//   * a row of the erased account left anywhere, in the product tables or in the auth schema;
//   * the auth account row itself surviving the admin removal;
//   * a table shedding more rows than the erased account owned, which would mean somebody else's
//     data went with it;
//   * the October 5 orphans — auth rows that name no account — moving at all, because the standing
//     instruction is to preserve them until they are separately authorised.
//
// Three rules keep it safe to point at production:
//   * it takes its numbers from `hosted-db-census.mjs`'s own frozen statements, so the before/after
//     pair is the same census the release record already cites and no second SQL dialect exists;
//   * deletion is irreversible, so nothing is sent without `--confirm-erase`, and the account to be
//     erased is named only by a signed-in token — never by a flag a typo could point elsewhere;
//   * the session token, the refresh token and the password are never printed, and the database
//     credential stays inside the connection string exactly as the census keeps it.
//
// It is a human command. No workflow, no release gate and no CI job may reach it.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { census, cliPath, connectionUrl, passwordPath, query, scrub } from "./hosted-db-census.mjs";
import { longestKey, projectUrl, readIdentity, readJson, request } from "./hosted-tenant-isolation.mjs";

const DEFAULT_SITE = "https://dueweave.pages.dev";
const DEFAULT_REF = "ugzdqcytouwfdlcjujqv";
const DEFAULT_POOLER_HOST = "aws-0-ap-south-1.pooler.supabase.com";
const DEFAULT_POOLER_PORT = "5432";

/** The phrase `delete-account` accepts and nothing else — see `ERASURE_CONFIRMATION_PHRASE`. */
export const ERASURE_CONFIRM_PHRASE = "DELETE MY ACCOUNT";

/** The five census reads an erasure is judged by, named so the frozen statement list stays visible. */
const SNAPSHOT_LABELS = ["auth-users", "auth-residue", "ledger-census", "owner-census", "account-state"];

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function truthy(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "t" || value === "true";
  return null;
}

function countMap(rows) {
  const out = {};
  for (const row of rows) out[String(row.tbl)] = num(row.rows);
  return out;
}

/** Turn the five labelled answers into the numbers every finding below is computed from. */
export function buildSnapshot(rowsByLabel) {
  const users = rowsByLabel["auth-users"]?.[0] ?? {};
  const state = rowsByLabel["account-state"]?.[0] ?? null;
  const auth = {};
  for (const row of rowsByLabel["auth-residue"] ?? []) {
    auth[String(row.auth_table)] = { total: num(row.rows_total), orphaned: num(row.rows_without_user), forOwner: num(row.rows_for_owner) };
  }
  return {
    usersTotal: num(users.users_total),
    confirmed: num(users.confirmed),
    unconfirmed: num(users.unconfirmed),
    account: { exists: state !== null, email: state?.account ?? null, emailConfirmed: state ? truthy(state.email_confirmed) : null },
    ledger: countMap(rowsByLabel["ledger-census"] ?? []),
    ownerRows: countMap(rowsByLabel["owner-census"] ?? []),
    auth,
    // Every rule below iterates what a read returned, so a read that returned nothing has to be
    // recorded as missing rather than left to look like a table with no rows in it.
    missing: SNAPSHOT_LABELS.filter((label) => !Array.isArray(rowsByLabel[label]) || rowsByLabel[label].length === 0),
  };
}

const entries = (map) => Object.entries(map ?? {});

function summarize(snapshot) {
  const own = entries(snapshot.ownerRows).filter(([, rows]) => rows > 0).map(([table, rows]) => `${table}=${rows}`).join(" ") || "none";
  const authOwn = entries(snapshot.auth).filter(([, counts]) => counts.forOwner > 0).map(([table, counts]) => `${table}=${counts.forOwner}`).join(" ") || "none";
  return `accounts=${snapshot.usersTotal} confirmed=${snapshot.confirmed} unconfirmed=${snapshot.unconfirmed} own-rows ${own} · auth-own ${authOwn}`;
}

/**
 * What each census read owes the judgement, and the sentence printed when it reads nothing at all.
 *
 * Every rule in `erasureFindings` iterates the rows a read returned, so a read that failed is not a
 * neutral gap — it silently deletes the rules that would have needed it. A deletion that cannot be
 * undone has to stop at the first one of those, before the function is called.
 */
const READ_GAP = {
  "auth-users": "read no account count, so nothing here can be judged",
  "auth-residue": "read no auth-schema counts, so neither the erased account's own residue nor the October 5 orphans have a baseline",
  "ledger-census": "read no ledger counts, so a table shedding another account's rows could not be seen",
  "owner-census": "carried no per-account rows, so an empty result after it would prove nothing",
  "account-state": "read no account row for the signed-in uuid, so this run cannot see the account it is about to erase",
};

/** The reads an after census must also carry; the account row is legitimately absent once it is gone. */
const AFTER_READS = SNAPSHOT_LABELS.filter((label) => label !== "account-state");

export function beforeEraseFindings(before) {
  const findings = before.missing.map((label) => `BEFORE ${label} ${READ_GAP[label]} — the erasure was not attempted and nothing was changed`);
  if (before.usersTotal === null && !before.missing.includes("auth-users")) {
    findings.push(`BEFORE auth-users ${READ_GAP["auth-users"]} — the erasure was not attempted and nothing was changed`);
  }
  return findings;
}

/**
 * Judge the after census against the before one. Every rule reports what it measured, because a
 * finding nobody can re-check is the same problem as a missing one.
 */
export function erasureFindings({ before, after, functionOutcome, credentialAfter }) {
  const findings = [];
  for (const label of AFTER_READS) {
    if (after.missing.includes(label)) findings.push(`AFTER the after census read nothing from ${label}, so the erasure cannot be proven against a read that returned nothing`);
  }
  const answered = functionOutcome?.body?.status ?? null;
  const http = functionOutcome?.status ?? 0;
  if (http !== 200 || answered !== "deleted") {
    if (answered === "incomplete") {
      findings.push(`ERASURE delete-account answered HTTP ${http} status=incomplete: the business records are gone but the login still exists, so the account holder is in the state the contract calls incomplete and the erasure has to be re-run`);
    } else {
      findings.push(`ERASURE delete-account answered HTTP ${http} status=${answered ?? "unreadable"} — no deletion was confirmed by the function`);
    }
  }

  if (after.account.exists) findings.push(`AFTER the auth account row is still present for ${before.account.email ?? "the erased account"}, so GoTrue's own record survived the admin removal`);

  for (const [table, rows] of entries(after.ownerRows)) {
    if (rows === null) findings.push(`AFTER the after census carries no count for public.${table}, so its erasure is unproven`);
    else if (rows > 0) findings.push(`AFTER public.${table} still holds ${rows} row(s) owned by the erased account`);
  }
  for (const [table, counts] of entries(after.auth)) {
    if (counts.forOwner === null) findings.push(`AFTER the after census carries no auth.${table} count for the erased account`);
    else if (counts.forOwner > 0) findings.push(`AFTER auth.${table} still holds ${counts.forOwner} row(s) naming the erased account`);
  }

  const dropped = before.usersTotal !== null && after.usersTotal !== null ? before.usersTotal - after.usersTotal : null;
  if (dropped !== 1) findings.push(`AFTER the number of auth accounts fell by ${dropped === null ? "an unreadable amount" : dropped}, not by 1`);

  for (const [table, rowsBefore] of entries(before.ledger)) {
    const rowsAfter = after.ledger[table];
    if (rowsAfter === null || rowsAfter === undefined) {
      findings.push(`AFTER public.${table} was counted before the erasure but not after, so its delta is unmeasured`);
      continue;
    }
    const owned = before.ownerRows[table] ?? 0;
    const lost = rowsBefore - rowsAfter;
    if (lost > owned) findings.push(`AFTER public.${table} lost ${lost} rows, ${owned} of them owned by the erased account — rows belonging to another account went with them, or something else wrote to production during the run`);
    else if (lost < owned) findings.push(`AFTER public.${table} lost ${lost} rows while the erased account owned ${owned}, so ${owned - lost} of its rows are still in the table`);
  }

  // Whole-table auth counts are the only way to see a purge wider than the account: `forOwner` says
  // how many rows the erased account could justify taking, and anything past that belonged to someone
  // else. The `orphaned` column cannot express it because those rows also never named this account.
  for (const [table, countsBefore] of entries(before.auth)) {
    const countsAfter = after.auth[table];
    if (!countsAfter || countsBefore.total === null || countsAfter.total === null || countsBefore.forOwner === null) continue;
    const lost = countsBefore.total - countsAfter.total;
    if (lost > countsBefore.forOwner) {
      findings.push(`AFTER auth.${table} lost ${lost} rows, ${countsBefore.forOwner} of them naming the erased account — rows that named other accounts went with them, so this erasure reached past its own account or something else wrote to auth during the run`);
    }
  }

  // The orphans are the release record's standing debt: rows naming no account, to be preserved.
  for (const [table, countsBefore] of entries(before.auth)) {
    const countsAfter = after.auth[table];
    if (!countsAfter || countsAfter.orphaned === null || countsBefore.orphaned === null) continue;
    const lost = countsBefore.orphaned - countsAfter.orphaned;
    if (lost !== 0) findings.push(`AFTER auth.${table} shed ${lost} row(s) that named no account — the October 5 orphans are to be preserved until separately authorised, so this erasure reached past its own account`);
  }

  const confirmed = before.account.emailConfirmed ? 1 : 0;
  const unconfirmed = before.account.emailConfirmed ? 0 : 1;
  if (before.confirmed !== null && after.confirmed !== null && before.confirmed - after.confirmed !== confirmed) {
    findings.push(`AFTER the confirmed-account count moved by ${before.confirmed - after.confirmed} although the erased account was ${confirmed ? "confirmed" : "not confirmed"}`);
  }
  if (before.unconfirmed !== null && after.unconfirmed !== null && before.unconfirmed - after.unconfirmed !== unconfirmed) {
    findings.push(`AFTER the unconfirmed-account count moved by ${before.unconfirmed - after.unconfirmed} although the erased account was ${unconfirmed ? "unconfirmed" : "confirmed"}`);
  }

  if (credentialAfter?.status === 200) findings.push(`GRANT the erased credential still signs in (HTTP 200) after the erasure, so the account is live`);

  return findings;
}

/** The exact call the deployed function accepts: one field, the caller's own bearer, the site as origin. */
export function buildEraseCall({ token, site, api, key }) {
  return {
    url: `${api}/functions/v1/delete-account`,
    init: {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: site,
      },
      body: JSON.stringify({ confirm: ERASURE_CONFIRM_PHRASE }),
    },
  };
}

/**
 * Sign in, read, erase, read, then try the credential again — the order the proof depends on.
 *
 * `signIn`, `snapshot` and `erase` are injected so the judgement above can be executed against
 * stand-ins; the wiring in `main` sends the same three through the hosted GoTrue surface, the census
 * statements and the deployed function.
 */
export async function runErasure({ identity, confirmErasing, signIn, snapshot, erase, log = () => {} }) {
  const report = (line) => log(line);
  if (!confirmErasing) {
    report(`REFUSED  ${identity.email} was not erased. Deletion cannot be undone, so pass --confirm-erase when you mean it.`);
    return { refused: true, findings: [], before: null, after: null, owner: null };
  }
  const session = await signIn({ email: identity.email, password: identity.password });
  if (session.status !== 200 || !session.token || !session.userId) {
    report(`SESSION  ${identity.email} HTTP ${session.status} — the account could not sign in, so no erasure was attempted and nothing was changed`);
    return { refused: true, findings: [], before: null, after: null, owner: null };
  }
  const owner = session.userId;
  report(`OWNER    ${owner} — taken from the token GoTrue issued, never from an argument`);

  const before = buildSnapshot(await snapshot(owner));
  report(`BEFORE   ${summarize(before)}`);

  // A half-empty before census cannot support an after proof, and the deletion it would license is
  // irreversible, so the run stops here instead of discovering the gap once the account is gone.
  const unprovable = beforeEraseFindings(before);
  // The uuid came from the token and the census read that uuid, but the account was *chosen* by the
  // identity file. If that file's credential signs into a different address than the census describes,
  // the operator pointed at the wrong file — and every delta below would still read as clean.
  const censusEmail = String(before.account.email ?? "").toLowerCase();
  const identityEmail = String(identity.email ?? "").toLowerCase();
  if (censusEmail && identityEmail && censusEmail !== identityEmail) {
    unprovable.push(`BEFORE the census describes ${before.account.email} for ${owner} but the identity file signs in as ${identity.email} — the erasure was not attempted and nothing was changed`);
  }
  if (unprovable.length > 0) {
    for (const finding of unprovable) report(finding);
    return { refused: true, findings: [], before, after: null, owner };
  }

  const outcome = await erase({ token: session.token });
  report(`FUNCTION delete-account HTTP ${outcome.status} status=${outcome.body?.status ?? "unreadable"}${outcome.body?.message ? ` message="${outcome.body.message}"` : ""}`);

  const after = buildSnapshot(await snapshot(owner));
  report(`AFTER    ${summarize(after)}`);

  const credentialAfter = await signIn({ email: identity.email, password: identity.password });
  report(`GRANT    the erased credential answered HTTP ${credentialAfter.status}${credentialAfter.status === 200 ? " — it still signs in" : " — it no longer signs in"}`);

  const findings = erasureFindings({ before, after, functionOutcome: outcome, credentialAfter });
  return { refused: false, findings, before, after, owner };
}

/** Read the five labelled answers through the CLI's json output, scrubbed of the credential.
 *  The rows come back as they were answered so the caller decides how to judge them. */
export async function readCensusRows({ cli, url, owner, secrets = [], log = () => {} }) {
  const rowsByLabel = {};
  for (const read of census(owner).filter((entry) => SNAPSHOT_LABELS.includes(entry.label))) {
    const result = await query(cli, url, read.sql, "json");
    const text = scrub(result.text, secrets);
    const rows = parseJsonRows(text);
    if (result.code !== 0 || rows === null) log(`SNAPSHOT ${read.label} could not be read (exit ${result.code})`);
    else rowsByLabel[read.label] = rows;
  }
  return rowsByLabel;
}

/** The CLI prefixes its answer with connection chatter and suffixes it with an upgrade notice, so
 *  the array has to be lifted out of the surrounding text rather than parsed from the whole buffer. */
function parseJsonRows(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseErasureArgs(argv) {
  const options = { identity: "", site: DEFAULT_SITE, ref: DEFAULT_REF, host: DEFAULT_POOLER_HOST, port: DEFAULT_POOLER_PORT, confirmErasing: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--confirm-erase") options.confirmErasing = true;
    else if (flag === "--identity") options.identity = String(argv[++index] ?? "");
    else if (flag === "--site") options.site = String(argv[++index] ?? "");
    else if (flag === "--project-ref") options.ref = String(argv[++index] ?? "");
    else if (flag === "--pooler-host") options.host = String(argv[++index] ?? "");
    else if (flag === "--pooler-port") options.port = String(argv[++index] ?? "");
    else {
      throw new Error(`unknown argument: ${flag}\nusage: node scripts/hosted-account-erasure.mjs --identity <file> [--confirm-erase] [--dry-run] [--site <origin>] [--project-ref <ref>] [--pooler-host <host>] [--pooler-port <port>]`);
    }
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseErasureArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  console.log(`PLAN     sign in as the identity file's account, read the census through ${SNAPSHOT_LABELS.join(", ")}, call functions/v1/delete-account with the caller's own bearer, read the census again, then retry the credential`);
  if (options.dryRun) {
    console.log("DRY-RUN  nothing sent. Erasing an account cannot be undone, so this command needs --confirm-erase and never runs in CI.");
    return 0;
  }
  if (!options.identity) {
    console.error("refused: pass --identity <file> naming the account to erase; the uuid is taken from the token that file signs in with");
    return 2;
  }
  const identity = readIdentity(options.identity);
  if (!identity) {
    console.error(`refused: no readable email and password at ${options.identity}`);
    return 1;
  }

  let site;
  try {
    site = new URL(options.site).origin;
  } catch {
    console.error(`--site must be a full http(s) origin, and "${options.site}" is not one.`);
    return 2;
  }
  let chunk;
  try {
    const html = await (await request(`${site}/`, { headers: { accept: "text/html" } })).text();
    const entry = html.match(/\/?assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? "";
    if (!entry) throw new Error("the served HTML links no entry chunk");
    chunk = await (await request(`${site}/${entry.replace(/^\/+/, "")}`, { headers: { accept: "application/javascript" } })).text();
  } catch (error) {
    console.error(`refused: the deployed site at ${site} could not be read (${error.message}), so no project surface was available`);
    return 1;
  }
  const key = longestKey(chunk);
  const api = key ? projectUrl(chunk, key) : null;
  if (!key || !api) {
    console.error("refused: the served bundle carries no publishable key and project URL beside it, so nothing could be called");
    return 1;
  }

  const file = passwordPath();
  if (!existsSync(file)) {
    console.error(`refused: no hosted database password at ${file} — the census half of this proof reads it from off-repo at ~/.config/dueweave/prod-db-password, mode 600`);
    return 1;
  }
  const password = readFileSync(file, "utf8").trim();
  const url = connectionUrl(options.ref, options.host, options.port, password);
  const secrets = [password, encodeURIComponent(password)];
  const cli = cliPath();

  const outcome = await runErasure({
    identity,
    confirmErasing: options.confirmErasing,
    log: (line) => console.log(scrub(line, secrets)),
    signIn: async ({ email, password: secret }) => {
      const response = await request(`${api}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ email, password: secret }),
      }).catch(() => null);
      if (!response) return { status: 0, token: "", userId: "" };
      const body = await readJson(response);
      return { status: response.status, token: body?.access_token ?? "", userId: body?.user?.id ?? "", message: body?.error_description ?? body?.msg ?? "" };
    },
    snapshot: async (owner) => readCensusRows({ cli, url, owner, secrets, log: (line) => console.log(scrub(line, secrets)) }),
    erase: async ({ token }) => {
      const call = buildEraseCall({ token, site, api, key });
      const response = await request(call.url, call.init).catch(() => null);
      if (!response) return { status: 0, body: null };
      return { status: response.status, body: await readJson(response) };
    },
  });

  for (const finding of outcome.findings) console.log(scrub(finding, secrets));
  if (outcome.refused) return 1;
  if (outcome.findings.length > 0) {
    console.log(`DONE     erasure NOT proven — ${outcome.findings.length} finding(s) against the census taken before it`);
    return 1;
  }
  console.log(`DONE     erasure proven: the account, its records and its auth rows are gone, every other count unmoved, and the credential no longer signs in`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (error) => {
    console.error(`erasure failed: ${error?.message ?? error}`);
    process.exit(1);
  });
}
