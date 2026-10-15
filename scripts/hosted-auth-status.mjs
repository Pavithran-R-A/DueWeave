// The hosted launch questions that this release line has been answering with hand-typed curl
// commands, as one repeatable operator instrument:
//
//   node scripts/hosted-auth-status.mjs --site https://dueweave.pages.dev
//   node scripts/hosted-auth-status.mjs --identity p3c-red-baseline/qa-identity.json --request-confirmation
//   node scripts/hosted-auth-status.mjs --identity p3c-red-baseline/qa-identity.json --request-recovery
//   node scripts/hosted-auth-status.mjs --identity p3c-red-baseline/qa-identity.json --verify-recovery
//
// The last of those is the half that a 200 from `/recover` cannot carry: it signs in twice, once with
// the password the account used before the reset and once with the one the delivered link installs, so
// "the reset worked" is read as the old credential refused and the new one accepted.
//
// Everything it reads is reachable with the key a customer's browser already holds, so it runs on a
// laptop with no Supabase management token — which is the state this project has been in since the
// machine-global token was replaced by another product's on 2026-10-07. Three limits of that surface
// are measured facts, not guesses, and the report states them rather than leaving a silent field to
// look like a green light:
//   - `GET /auth/v1/settings` answers provider switches, `disable_signup`, `mailer_autoconfirm` and
//     the SAML/passkeys flags. It does not expose `site_url`, `additional_redirect_urls` or
//     `password_min_length`, so no credential-free read can prove where an emailed link will land.
//   - Whether a delivered message actually arrived, and to which address, is readable only in the
//     mailbox. A 200 from `/resend` proves the sender accepted the request, nothing more.
//   - Asked on 2026-10-14, `/recover` answered HTTP 200 for a `redirect_to` on a domain this project
//     was never configured to allow. So no status code from that endpoint is evidence about the
//     redirect allow-list either; it only says a request was accepted.
//
// The project URL and the publishable key are read out of the bundle the deployed site is serving
// right now, so "the live site points at this project" is measured on every run. In the served entry
// chunk the two literals are adjacent — the client factory is called with the project URL and then
// the key — and the key appears more than once, the first match being a truncated fragment, so the
// key is taken as the longest match and the URL as the last literal preceding it.
//
// No credential value is ever printed: the key and the QA password are read into requests and
// reported as lengths and outcomes. It is a laptop and operator command, never a CI step, because it
// reads whatever production happens to be serving and can send real mail.
// `tests/hosted-auth-status.contract.test.ts` holds those lines.
import { readFileSync } from "node:fs";

const DEFAULT_SITE = "https://dueweave.pages.dev";

function parseArgs(argv) {
  const options = { site: DEFAULT_SITE, identity: "", requestConfirmation: false, requestRecovery: false, verifyRecovery: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--request-confirmation") {
      options.requestConfirmation = true;
      continue;
    }
    if (token === "--request-recovery") {
      options.requestRecovery = true;
      continue;
    }
    if (token === "--verify-recovery") {
      options.verifyRecovery = true;
      continue;
    }
    if (token !== "--site" && token !== "--identity") {
      console.error(`Unrecognised argument "${token}". Expected --site <origin>, --identity <file>, --request-confirmation, --request-recovery or --verify-recovery.`);
      process.exit(2);
    }
    const value = argv[index + 1];
    if (!value) {
      console.error(`${token} needs a value.`);
      process.exit(2);
    }
    if (token === "--site") options.site = value;
    else options.identity = value;
    index += 1;
  }
  return options;
}

const problems = [];

function report(line) {
  console.log(line);
}

/** A finding is not a failure: an unconfirmed account is reported as a GRANT line, not a problem. */
function problem(line) {
  problems.push(line);
  console.log(`PROBLEM ${line}`);
}

function request(url, init) {
  return fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(30_000) });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** One password grant, reported under whichever prefix asked for it. The credential is read into the
 *  request and never echoed; only the status and the refusal text come back. */
async function passwordGrant(email, password, prefix) {
  const response = await request(`${api}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { ...publicHeaders, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).catch((error) => {
    problem(`${prefix} ${email} could not be probed (${error.message})`);
    return null;
  });
  if (!response) return null;
  return { response, body: await readJson(response) };
}

/** The identity file is untracked scratch holding credential values, so an unreadable one is a
 *  finding to report, not a crash: the caller says which half it could not run. */
function readIdentity(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function messageOf(body) {
  return body?.msg ?? body?.error_description ?? body?.error ?? "";
}

function longestKey(chunk) {
  const matches = chunk.match(/sb_publishable_[A-Za-z0-9_-]+/g) ?? [];
  return matches.reduce((longest, match) => (longest === null || match.length > longest.length ? match : longest), null);
}

/** The last absolute URL literal before the key: the argument the client factory pairs with it. */
function projectUrl(chunk, key) {
  const before = chunk.slice(0, chunk.indexOf(key));
  const matches = before.match(/https?:\/\/[^\s"'`)\\]+/g) ?? [];
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

function flattenSettings(settings) {
  const scalars = [];
  const providers = [];
  for (const [name, value] of Object.entries(settings)) {
    if (typeof value === "boolean") scalars.push(`${name}=${value}`);
    if (name === "external" && value && typeof value === "object") {
      for (const [provider, enabled] of Object.entries(value)) if (typeof enabled === "boolean") providers.push(`external.${provider}=${enabled}`);
    }
  }
  return [...scalars, ...providers];
}

const options = parseArgs(process.argv.slice(2));

let site;
try {
  site = new URL(options.site).origin;
} catch {
  console.error(`--site must be a full http(s) origin, and "${options.site}" is not one.`);
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
  problem(`the deployed site at ${site} could not be read (${error.message}), so no hosted state was measured`);
  process.exit(1);
}
report(`SITE   ${site} entry ${entry.replace(/^\/+/, "")}`);

const key = longestKey(chunk);
if (!key) {
  problem(`${entry} carries no publishable key, so nothing could be probed — the deployed bundle is not the one expected`);
  process.exit(1);
}
const api = projectUrl(chunk, key);
if (!api) {
  problem(`${entry} carries no project URL beside its publishable key, so nothing could be probed`);
  process.exit(1);
}
report(`API    ${api}`);
report(`KEY    publishable key read from the served bundle (${key.length} characters, never printed)`);

const publicHeaders = { apikey: key, authorization: `Bearer ${key}` };

// What the hosted Auth service admits about itself, and what it withholds from an anonymous read.
let settingsResponse;
try {
  settingsResponse = await request(`${api}/auth/v1/settings`, { headers: publicHeaders });
} catch (error) {
  problem(`AUTH ${api}/auth/v1/settings could not be reached (${error.message})`);
  settingsResponse = null;
}
if (settingsResponse) {
  const settings = await readJson(settingsResponse);
  if (settingsResponse.status !== 200 || !settings) {
    problem(`AUTH /auth/v1/settings answered HTTP ${settingsResponse.status} instead of the public configuration`);
  } else {
    report(`AUTH   ${flattenSettings(settings).join(" ")}`);
    report("AUTH   not exposed by /auth/v1/settings: site_url, additional_redirect_urls, password_min_length — so no credential-free read can prove where an emailed link lands");
  }
}

// The disposable QA identity's confirmation state, read the way a customer's sign-in is read.
let qaEmail = "";
if (options.identity) {
  const identity = readIdentity(options.identity);
  if (!identity || !identity.email || !identity.password) {
    report(`GRANT  skipped: no readable identity at ${options.identity}`);
  } else {
    qaEmail = identity.email;
    if (options.verifyRecovery) {
      // A reset is only proven by what the two credentials do afterwards: the one the customer signed
      // in with has to stop working and the one the delivered link installs has to start. The password
      // values themselves never reach the report, and the refusal text is kept because it tells an
      // unused link ("Email not confirmed") apart from a reset that never landed.
      if (!identity.recoveryNewPassword) {
        report("NEWPW  skipped: --verify-recovery needs a recoveryNewPassword in the identity file, which holds the password the delivered link installs");
      } else {
        const old = await passwordGrant(identity.email, identity.password, "OLDPW");
        if (old) {
          const refused = messageOf(old.body);
          if (old.response.status === 200) {
            problem(`OLDPW ${identity.email} HTTP 200 — the pre-recovery password still signs in, so the reset was never completed`);
          } else {
            report(`OLDPW  ${identity.email} HTTP ${old.response.status} — the pre-recovery password no longer signs in${refused ? ` ("${refused}")` : ""}`);
          }
        }
        const recovered = await passwordGrant(identity.email, identity.recoveryNewPassword, "NEWPW");
        if (recovered) {
          const refused = messageOf(recovered.body);
          if (recovered.response.status === 200) {
            report(`NEWPW  ${identity.email} HTTP 200 — the recovery password signs in, so the reset landed and the address is confirmed`);
          } else {
            problem(`NEWPW ${identity.email} HTTP ${recovered.response.status} — the recovery password is refused${refused ? ` ("${refused}")` : ""}, so the delivered link has not been used`);
          }
        }
      }
    } else {
      const grant = await passwordGrant(identity.email, identity.password, "GRANT");
      if (grant) {
        const refused = messageOf(grant.body);
        if (grant.response.status === 200) report(`GRANT  ${identity.email} HTTP 200 — a session was issued, so the emailed confirmation has been used`);
        else report(`GRANT  ${identity.email} HTTP ${grant.response.status} — sign-in refused${refused ? ` ("${refused}")` : ""}, so confirmation is still required`);
      }
    }
  }
} else {
  report("GRANT  skipped: pass --identity <file> to read the disposable QA identity's confirmation state");
  if (options.verifyRecovery) report("NEWPW  skipped: --verify-recovery needs --identity <file> so it knows which account to read");
}

// The erasure function's unauthenticated boundary: the CORS repair and its own session check, which
// is the half of B17 that can be proved without anybody signing in.
const edge = `${api}/functions/v1/delete-account`;
let preflight;
try {
  preflight = await request(edge, {
    method: "OPTIONS",
    headers: { origin: site, "access-control-request-method": "POST", "access-control-request-headers": "authorization,apikey,content-type" },
    redirect: "manual",
  });
} catch (error) {
  problem(`EDGE OPTIONS delete-account could not be probed (${error.message})`);
  preflight = null;
}
if (preflight) {
  const allowed = preflight.headers.get("access-control-allow-origin");
  if (preflight.status === 204) report(`EDGE   OPTIONS delete-account HTTP 204 access-control-allow-origin=${allowed ?? "none"}`);
  else problem(`EDGE OPTIONS delete-account expected HTTP 204 with the site's own origin allowed and got HTTP ${preflight.status}`);
}
let bearerless;
try {
  bearerless = await request(edge, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json", origin: site },
    body: JSON.stringify({ confirm: "delete my account" }),
  });
} catch (error) {
  problem(`EDGE POST delete-account could not be probed (${error.message})`);
  bearerless = null;
}
if (bearerless) {
  const body = await readJson(bearerless);
  const message = body?.message ?? body?.error ?? "";
  if (bearerless.status === 401) report(`EDGE   POST delete-account without a bearer HTTP 401${message ? ` — "${message}"` : ""}`);
  else problem(`EDGE POST delete-account without a bearer expected HTTP 401 from the function's own session check and got HTTP ${bearerless.status}`);
}

// Requesting the mail is the only action here that reaches a person, so it never happens by default.
if (options.requestConfirmation) {
  if (!qaEmail) {
    report("RESEND skipped: --request-confirmation needs --identity <file> so it knows which address to ask for");
  } else {
    const redirectTo = `${site}/auth`;
    const resend = await request(`${api}/auth/v1/resend?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: "POST",
      headers: { ...publicHeaders, "content-type": "application/json" },
      body: JSON.stringify({ email: qaEmail, type: "signup" }),
    }).catch((error) => {
      problem(`RESEND could not be requested (${error.message})`);
      return null;
    });
    if (resend) {
      const body = await readJson(resend);
      if (resend.status === 200) {
        report(`RESEND redirect_to=${redirectTo} HTTP 200`);
        report("RESEND the request was accepted; where the link actually lands is readable only in the mailbox, never from this command");
      } else {
        const message = body?.error_description ?? body?.msg ?? body?.error ?? "";
        problem(`RESEND redirect_to=${redirectTo} answered HTTP ${resend.status}${message ? ` ("${message}")` : ""} — no confirmation mail was requested`);
      }
    }
  }
} else {
  report("RESEND skipped: this run sends no mail; pass --request-confirmation to request one confirmation message");
}

// A reset link has to land on the one route that holds the password form, so this asks the hosted
// sender for a recovery mail at exactly the destination `client/src/hooks/useSupabaseAuth.ts` asks
// for. Measured 2026-10-14: this project answers HTTP 200 even for a `redirect_to` on a domain that
// is nowhere in its configuration, so the status says the request was accepted and nothing about
// which domain the emailed link opens. Only the mailbox can settle that, and the line says so.
if (options.requestRecovery) {
  if (!qaEmail) {
    report("RECOVER skipped: --request-recovery needs --identity <file> so it knows which address to ask for");
  } else {
    const redirectTo = `${site}/auth/update-password`;
    const recover = await request(`${api}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: "POST",
      headers: { ...publicHeaders, "content-type": "application/json" },
      body: JSON.stringify({ email: qaEmail }),
    }).catch((error) => {
      problem(`RECOVER could not be requested (${error.message})`);
      return null;
    });
    if (recover) {
      const body = await readJson(recover);
      const message = body?.error_description ?? body?.msg ?? body?.error ?? "";
      if (recover.status === 200) {
        report(`RECOVER  redirect_to=${redirectTo} HTTP 200`);
        report("RECOVER  a recovery request was accepted; which domain the emailed link opens is readable only in the mailbox, never from this command — this project also answers HTTP 200 for a redirect_to it was never configured to allow");
      } else if (recover.status === 429) {
        report(`RECOVER  redirect_to=${redirectTo} HTTP 429${message ? ` — "${message}"` : ""}: a recovery mail for this address was already asked for moments ago, so nothing new was requested`);
      } else {
        problem(`RECOVER redirect_to=${redirectTo} answered HTTP ${recover.status}${message ? ` ("${message}")` : ""} — no recovery mail was requested`);
      }
    }
  }
} else {
  report("RECOVER skipped: this run sends no mail; pass --request-recovery to request one recovery message");
}

if (problems.length > 0) {
  console.error(`Hosted auth status: ${problems.length} problem(s).`);
  process.exit(1);
}
const mailed = [options.requestConfirmation && qaEmail ? "confirmation" : null, options.requestRecovery && qaEmail ? "recovery" : null].filter(Boolean);
report(`Hosted auth status: no problem found. Read-only probes only${mailed.length > 0 ? `; ${mailed.length} mail request(s) sent: ${mailed.join(", ")}` : ""}.`);
