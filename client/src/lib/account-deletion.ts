// Arc 3C STEP 5 — the account holder's copy of the erasure outcome.
//
// Two rules govern this file, and both come from what the endpoint can and cannot promise:
//
//   1. Only a 200 that carries the deleted marker is a deletion. Everything else — a 200 whose body is
//      a gateway page, a 500 that says `error`, a request that never reached the runtime — says the
//      account is still there, because that is what each of them means. `delete_my_account()` and the
//      auth-account removal are two separate calls, so there is a genuine third state in between, and
//      it gets its own name rather than a coin flip between success and failure.
//   2. The words are the client's. A reply body is classified, never quoted: this endpoint's `message`
//      field is product text today, but the same field can carry a reverse proxy's HTML, a database
//      constraint name, or whatever an attacker appends to a recognised prefix. The most expensive
//      sentence in the product to say by accident is "your account has been deleted", so the sentence
//      comes from here.

/** The phrase the screen asks for. Must equal the endpoint's rule — pinned by tests/arc3c-account-deletion.test.ts. */
export const ACCOUNT_DELETION_CONFIRMATION = "DELETE MY ACCOUNT";

/** Client-owned sentences, one per state a person can be left in. */
export const DELETION_MESSAGES = {
  session: "Your sign-in is no longer active. Sign in again, then repeat the deletion.",
  confirmation: "Type the confirmation phrase exactly as it is shown above to continue.",
  origin: "DueWeave did not recognise this browser as the application. Open DueWeave from its own address and try again.",
  notConfigured: "Account deletion is not switched on for this deployment yet. Nothing has changed.",
  offline: "DueWeave could not reach the deletion service. Nothing has changed and your account is intact — try again once you are connected.",
  founder: "This account is part of a Founder review record, so DueWeave cannot erase it from the app. Settle that review with DueWeave support first.",
  unchanged: "DueWeave could not delete your account. Everything is unchanged — keep working as before, or try the deletion again.",
  incomplete: "DueWeave removed your business records but could not finish closing the account. Sign in again and repeat the deletion, or contact support.",
} as const;

export interface DeletionReply {
  /** Status from the function, or null when no HTTP reply arrived at all. */
  status: number | null;
  /** Whatever the reply carried: parsed JSON on the success path, read or unread on the failure path. */
  body: unknown;
}

export type DeletionOutcome =
  | { state: "deleted" }
  | { state: "intact"; message: string }
  | { state: "partial"; message: string };

// The endpoint's own copy is matched only on the fragments that identify a state, and the matched text
// is never re-emitted — see the header.
const DELETED_MARKER = "deleted";
const INCOMPLETE_MARKER = "incomplete";
const FOUNDER_MARKER = "Founder review record";

/** Exact-phrase gate for the confirmation field. The endpoint trims, so this trims too. */
export function isExactConfirmation(typed: string): boolean {
  return typed.trim() === ACCOUNT_DELETION_CONFIRMATION;
}

function markerOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const marker = (body as { status?: unknown }).status;
  return typeof marker === "string" ? marker : null;
}

function textOf(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "";
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

export function interpretDeletionReply(reply: DeletionReply): DeletionOutcome {
  const marker = markerOf(reply.body);
  if (reply.status === 200 && marker === DELETED_MARKER) return { state: "deleted" };

  if (reply.status === null) return { state: "intact", message: DELETION_MESSAGES.offline };
  if (reply.status === 401) return { state: "intact", message: DELETION_MESSAGES.session };
  if (reply.status === 400) return { state: "intact", message: DELETION_MESSAGES.confirmation };
  if (reply.status === 403) return { state: "intact", message: DELETION_MESSAGES.origin };
  if (reply.status === 501) return { state: "intact", message: DELETION_MESSAGES.notConfigured };

  // The two states that share a status code: `error` (nothing moved) and `incomplete` (the ledger
  // moved and the login did not). The marker separates them; a 500 with no marker is read as the
  // conservative case, because "everything is unchanged" is the claim a person can act on and is
  // wrong only in a direction that costs them nothing.
  if (reply.status === 500 && marker === INCOMPLETE_MARKER) return { state: "partial", message: DELETION_MESSAGES.incomplete };
  if (reply.status === 500 && textOf(reply.body).includes(FOUNDER_MARKER)) return { state: "intact", message: DELETION_MESSAGES.founder };

  return { state: "intact", message: DELETION_MESSAGES.unchanged };
}
