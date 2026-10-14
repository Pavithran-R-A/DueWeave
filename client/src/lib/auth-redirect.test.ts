import { describe, expect, it } from "vitest";
import { AUTH_RETURN_PATH, confirmationRedirectUrl, linkArrivalNotice, withoutLinkArrival } from "./auth-redirect";

// A confirmation email is a link the customer opens later, possibly in a different
// browser on a different machine. If the request that generated it names no destination,
// Auth substitutes its own Site URL — which is how a customer on the deployed site ended
// up being sent to http://localhost:3000 (measured in a real delivered message on
// 2026-10-12). The destination therefore has to come from the site that asked.

describe("where an emailed DueWeave link lands", () => {
  it("names an absolute address on the site that asked, for the deployed origin", () => {
    expect(confirmationRedirectUrl("https://dueweave.pages.dev")).toBe("https://dueweave.pages.dev/auth");
  });

  it("never carries the hosted default when a real site is asking", () => {
    expect(confirmationRedirectUrl("http://localhost:3000")).toBe("http://localhost:3000/auth");
    expect(confirmationRedirectUrl("https://dueweave.pages.dev")).not.toContain("localhost");
  });

  it("answers an empty target, because a request that states none gets the Site URL substituted", () => {
    expect(confirmationRedirectUrl("https://dueweave.pages.dev")).not.toBe("");
  });

  it("follows the origin the browser is actually on, so the local stack stays local", () => {
    expect(confirmationRedirectUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/auth");
  });

  it("keeps one address per origin when the origin arrives with a trailing slash", () => {
    expect(confirmationRedirectUrl("https://dueweave.pages.dev/")).toBe("https://dueweave.pages.dev/auth");
  });

  it("lands on the screen that already turns a detected session into a ledger", () => {
    expect(AUTH_RETURN_PATH).toBe("/auth");
  });
});

// A customer who opens a confirmation link twice, or an hour late, is redirected back to
// this screen by the auth server itself. Measured against the hosted project on 2026-10-14:
// a link that is already used, expired, or unrecognisable arrives as
// `/auth#error=access_denied&error_code=otp_expired&error_description=...` (HTTP 303), while
// a successful one arrives with a session in the same place. The deployed app said nothing
// at all about the first arrival, so a confirmed customer saw a silent sign-in form and a
// technical report left in the address bar.

describe("what an emailed link reports back to this screen", () => {
  const usedOrExpiredLink = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=";
  const unreadableLink = "#error=invalid_request&error_code=validation_failed&error_description=Invalid+email+verification+type&sb=";
  const successfulConfirmation = "#access_token=session-token&refresh_token=refresh-token&token_type=bearer&expires_in=3600&type=confirmation&sb=";

  it("tells the customer a link that no longer works is not a broken account", () => {
    const notice = linkArrivalNotice(usedOrExpiredLink);
    expect(notice).not.toBe("");
    expect(notice.toLowerCase()).toContain("sign in");
  });

  it("keeps the server's technical report out of what the customer reads", () => {
    for (const arrival of [usedOrExpiredLink, unreadableLink]) {
      expect(linkArrivalNotice(arrival)).not.toMatch(/otp_expired|validation_failed|access_denied|invalid_request|SQLSTATE|PGRST/i);
    }
  });

  it("answers a link that could not be read instead of staying quiet", () => {
    expect(linkArrivalNotice(unreadableLink)).not.toBe("");
    expect(linkArrivalNotice(unreadableLink)).not.toBe(linkArrivalNotice(usedOrExpiredLink));
  });

  it("says nothing when the link worked and brought a session back", () => {
    expect(linkArrivalNotice(successfulConfirmation)).toBe("");
  });

  it("says nothing for an ordinary visit to the sign-in screen", () => {
    for (const arrival of ["", "#", "#sb=", "#token_type=bearer"]) {
      expect(linkArrivalNotice(arrival)).toBe("");
    }
  });

  it("clears the report from the address so a refresh does not re-report it", () => {
    expect(withoutLinkArrival(`https://dueweave.pages.dev/auth${usedOrExpiredLink}`)).toBe("https://dueweave.pages.dev/auth");
  });

  it("leaves an address that carries something else untouched", () => {
    const withSession = "https://dueweave.pages.dev/auth#access_token=session-token&token_type=bearer";
    expect(withoutLinkArrival(withSession)).toBe(withSession);
    expect(withoutLinkArrival("https://dueweave.pages.dev/auth/update-password")).toBe("https://dueweave.pages.dev/auth/update-password");
    expect(withoutLinkArrival("https://dueweave.pages.dev/auth?mode=recovery#sb=")).toBe("https://dueweave.pages.dev/auth?mode=recovery#sb=");
  });
});
