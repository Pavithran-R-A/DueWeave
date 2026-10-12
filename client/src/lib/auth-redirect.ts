// An emailed link is opened later, often in a different browser, so its destination has to
// be named by the site that asked for it. Leaving it out hands the decision to Auth's own
// Site URL, which is a hosted setting no customer can see: a real confirmation message
// delivered from the deployed site on 2026-10-12 carried a localhost address for exactly
// that reason. Deriving it from the browser's origin makes one rule true in every
// environment — the local stack returns to the local stack, the deployed site to the
// deployed site — and keeps the answer out of any single build's configuration.

/** The screen that turns a session arriving in the URL into a ledger, or a sign-in form. */
export const AUTH_RETURN_PATH = "/auth";

/** The address an emailed confirmation link must land on, for the site making the request. */
export function confirmationRedirectUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${AUTH_RETURN_PATH}`;
}
