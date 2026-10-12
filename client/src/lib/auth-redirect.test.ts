import { describe, expect, it } from "vitest";
import { AUTH_RETURN_PATH, confirmationRedirectUrl } from "./auth-redirect";

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
