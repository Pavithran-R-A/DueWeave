import { describe, expect, it } from "vitest";
import { RESEND_REQUESTED_COPY, interpretResendResponse, interpretSignInResponse } from "@/lib/auth-outcome";

// A visitor who registers and gets no email has today one route: sign up again, which the
// server answers with "already registered". GoTrue exposes `/resend` for exactly this, and the
// client library resolves it to `{ data: { user: null, session: null }, error }` — an empty
// success that says nothing about delivery. The reading of that reply is what has to be right.
describe("resending a confirmation email has exactly two honest endings", () => {
  it("reads an empty success as a request that was accepted, not as a delivered email", () => {
    expect(interpretResendResponse({ error: null, data: { user: null, session: null } })).toEqual({ status: "requested" });
  });

  it("still reads the accepted reply when the client library carries no data at all", () => {
    expect(interpretResendResponse({})).toEqual({ status: "requested" });
  });

  it("names the waiting it has to ask for when the sender rate-limits, which is not a retry-now", () => {
    const outcome = interpretResendResponse({ error: { message: "Email rate limit exceeded" } });
    expect(outcome.status).toBe("error");
    expect(outcome.status === "error" && outcome.error).toContain("wait");
  });

  it("keeps a server-side refusal away from the screen and answers with the same friendly copy sign-up uses", () => {
    expect(interpretResendResponse({ error: { message: "Database error saving new user" } })).toEqual({
      status: "error",
      error: "We could not complete that request. Please try again.",
    });
  });

  it("says what happens next when the request was accepted, without claiming the mail arrived", () => {
    expect(RESEND_REQUESTED_COPY).toContain("asked");
    expect(RESEND_REQUESTED_COPY).toContain("cannot tell");
    for (const overclaim of ["sent", "delivered", "arrived", "check your inbox now"]) {
      expect(RESEND_REQUESTED_COPY.toLowerCase()).not.toContain(overclaim);
    }
  });
});

// The confirmation screen is where the resend lives, and until now only a fresh sign-up could
// reach it. Someone who registered, lost the email, and came back to sign in was told
// "We could not complete that request" — GoTrue's real answer, `Email not confirmed`, is
// swallowed by the generic mapping. The reading below is what lets that person see the same
// screen, with the same way to ask for the link again.
describe("signing in to an unconfirmed account is a place, not an error", () => {
  it("recognises the server's unconfirmed answer as the confirmation screen rather than a failure", () => {
    expect(interpretSignInResponse({ error: { message: "Email not confirmed" }, data: { session: null } }))
      .toEqual({ status: "confirmation-required" });
  });

  it("keeps a real session a session", () => {
    expect(interpretSignInResponse({ data: { session: { access_token: "x" } } })).toEqual({ status: "session" });
  });

  it("does not turn a wrong password into an invitation to confirm an email", () => {
    const outcome = interpretSignInResponse({ error: { message: "Invalid login credentials" }, data: { session: null } });
    expect(outcome.status).toBe("error");
    expect(outcome.status === "error" && outcome.error).toBe("That email and password combination does not match an account.");
  });

  it("refuses to report success when the server answered with neither a session nor a reason", () => {
    expect(interpretSignInResponse({ data: { session: null } }).status).toBe("error");
  });
});
