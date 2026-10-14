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

// The same link can arrive twice: a customer opens it in a second tab, a mail scanner
// follows it, or the tab is reloaded from history. The auth server consumes the one-time
// token on the first pass, so every later pass is redirected back with a failure report in
// the fragment even though the address itself is already confirmed. A customer who had
// successfully confirmed met a silent sign-in form on 2026-10-14 for exactly that reason.

/** The two reports the hosted auth server was measured sending, and nothing else is trusted. */
const LINK_REPORTS: Record<string, string> = {
  otp_expired:
    "This emailed link no longer works — it has already been used, or it has expired. If your email is confirmed, sign in below to open your ledger. If it is not, sign in and DueWeave will show you what to do next.",
  validation_failed:
    "This link could not be read as a DueWeave confirmation link. Open the link from the email again, or sign in below if your email is already confirmed.",
};

/**
 * What the customer should be told about a link that arrived reporting a problem, or ""
 * when the address carries no report. The server's own wording is never passed through:
 * only the code is read, and DueWeave answers in its own words.
 */
export function linkArrivalNotice(hash: string): string {
  const report = new URLSearchParams(hash.replace(/^#/, "")).get("error_code") ?? "";
  return LINK_REPORTS[report] ?? "";
}

/**
 * The address as it should remain in the bar once the report has been read. Clearing it is
 * what stops a refresh from re-announcing a link problem, and stops the server's technical
 * text from being mistaken for DueWeave's verdict. An address with no report is left alone.
 */
export function withoutLinkArrival(url: string): string {
  const fragmentStart = url.indexOf("#");
  if (fragmentStart === -1) return url;
  if (!linkArrivalNotice(url.slice(fragmentStart))) return url;
  return url.slice(0, fragmentStart);
}
