// Arc 3C STEP 4 — the decision half of the delete-account Edge Function.
//
// This module is deliberately free of runtime globals: no `Deno`, no `fetch`, no Supabase client.
// The handler in `index.ts` is a thin wire between HTTP and these rules, which is what lets every
// security claim about the endpoint be executed by `tests/arc3c-erasure-contract.test.ts` instead
// of asserted in a comment. The rules here are the ones that carry a cost if they drift: who may
// call, what a valid confirmation looks like, which request fields exist at all, and what a
// refusal is allowed to say.
//
// Shared rule across every function below: a rejection message never repeats caller input. An
// error path that echoes a token, an identifier, or a raw database message turns a refusal into a
// disclosure, and this endpoint's failures will be read by whoever is attacking it.

/** The phrase the UI asks the account holder to type. Exact, case-sensitive, one spelling. */
export const ERASURE_CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";

/** The single RPC the endpoint may call. It takes no arguments, so there is nothing to forward. */
export const ERASURE_RPC = "delete_my_account";

/** The only database refusal that is the caller's to read: it names a condition they can act on. */
const FOUNDER_ENTANGLEMENT_MESSAGE =
  "This account is part of a Founder review record, so DueWeave cannot erase it from the self-service path";

const SESSION_MESSAGE = "Your session is no longer valid. Sign in again before deleting your account.";

const UNCHANGED_MESSAGE =
  "DueWeave could not delete your account. Everything is unchanged: you can keep using DueWeave as before, or try again.";

/**
 * The one message that must never read like a success. `delete_my_account()` and the auth-account
 * removal are two separate calls, so there is a real state between them: the business records are
 * gone and the login still works. Telling the account holder that plainly is the only honest
 * option, and the handler pairs it with `status: "incomplete"` so the UI cannot show a deletion.
 */
export const INCOMPLETE_ERASURE_MESSAGE =
  "DueWeave removed your business records but could not finish closing the account. Sign in again and repeat the deletion, or contact support.";

export type Rejection = { status: number; message: string };

function reject(status: number, message: string): Rejection {
  return { status, message };
}

/**
 * Accept a request body only if it is exactly one field, `confirm`, carrying the phrase.
 *
 * The whitelist is the security property, not a validation nicety: identity arrives in the bearer
 * token, so any body field naming a user would be a second, browser-controlled source of the target.
 * Rejecting unknown fields outright means a later edit cannot wire one in without this test firing.
 */
export function parseConfirmation(bodyText: string): Rejection | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return reject(400, "The deletion request could not be read.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return reject(400, "The deletion request must carry only a confirmation.");
  }
  const fields = Object.keys(parsed);
  if (fields.length !== 1 || fields[0] !== "confirm") {
    return reject(400, "The deletion request carries a confirmation and nothing else.");
  }
  const confirm = (parsed as { confirm: unknown }).confirm;
  if (typeof confirm !== "string" || confirm.trim() !== ERASURE_CONFIRMATION_PHRASE) {
    return reject(400, "Type the confirmation phrase exactly as it is shown.");
  }
  return null;
}

/** Read the caller's credential out of the Authorization header. Never returns it in a rejection. */
export function bearerToken(authorization: string | null | undefined): { token: string } | Rejection {
  // The scheme name is case-insensitive (RFC 7235); the token itself is not touched or interpreted
  // here — GoTrue decides whether it is a live session.
  if (!authorization) return reject(401, "Sign in before deleting your account.");
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  if (!match) return reject(401, "Sign in before deleting your account.");
  return { token: match[1] };
}

/**
 * Decide the `Access-Control-Allow-Origin` value that answers this request, from configuration only.
 * The result is what to send back, so a request that carried no `Origin` gets `null` — there is no
 * cross-origin conversation to authorise, and emitting the header anyway would be noise.
 *
 * An unset origin is a refusal rather than a wildcard: a function deployed before the app's real
 * host is known would otherwise accept the browser of whoever finds the URL. A caller that sends no
 * `Origin` at all (a script, the CLI) is judged on its token instead, which is the only credential
 * this endpoint honours.
 */
export function requestOriginFor(origin: string | null, configured: string | null | undefined): { origin: string | null } | Rejection {
  if (!configured) {
    return reject(501, "This deployment has not set ALLOWED_APP_ORIGIN, so account deletion is not available yet.");
  }
  if (origin === null) return { origin: null };
  if (origin !== configured) {
    return reject(403, "This request did not come from the DueWeave application.");
  }
  return { origin: configured };
}

/** Erasure is a POST. Everything else, including a preflight, is refused by this rule. */
export function authorizeMethod(method: string): Rejection | null {
  return method === "POST" ? null : reject(405, "Account deletion is requested with POST.");
}

/**
 * Turn whatever the database said into copy a browser may see.
 *
 * Two messages are product text and pass through as constants (never as the received string, so an
 * unrecognised message cannot smuggle a suffix along with a recognised prefix). Everything else —
 * a permission error, a constraint name, a host, an SQLSTATE — is a finding for the operator, not
 * for the account holder, and is replaced.
 */
export function erasureFailureMessage(raw: string | null | undefined): string {
  const text = typeof raw === "string" ? raw : "";
  if (text.includes("Founder review record")) return FOUNDER_ENTANGLEMENT_MESSAGE;
  if (text.includes("Authentication is required")) return SESSION_MESSAGE;
  return UNCHANGED_MESSAGE;
}
