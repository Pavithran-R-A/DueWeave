import { describe, expect, it } from "vitest";
import { GENERIC_AUTH_FAILURE, RESEND_REQUESTED_COPY, friendlyAuthError, interpretResendResponse, interpretSignInResponse, interpretSignUpResponse } from "@/lib/auth-outcome";

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

// Every email request on this release line is throttled per address, and the throttled customer is
// the one who is about to give up: the copy has to say *wait*, never *try again*, because each retry
// pushes the window further out. The wording that carries that sentence is not stable — the client
// library builds the message from whichever of `msg`/`message`/`error_description` the server filled
// (`node_modules/@supabase/auth-js/dist/module/lib/fetch.js` `_getErrorMessage`) and this repository
// has never captured a rate-window body from a real server: measured 2026-10-16T12:21Z against
// `ugzdqcytouwfdlcjujqv`, two rapid `/auth/v1/recover` requests for an address with no account both
// answered `HTTP 200 {}` (`prod-census/recover-shape-1220.log`), so the window is per-account and an
// unknown address cannot be used to read it. What the reply does carry, in the same wrapper, is its
// HTTP status (`AuthApiError.status`), so that is the signal the reading has to key on — with the
// wording kept as the secondary route for a refusal that arrives without one.
describe("a rate window is read by its status, not only by a sentence nobody has captured", () => {
  const WINDOW_SENTENCE = "For security purposes, you can only request this after 55 seconds.";

  it("tells a throttled confirmation resend to wait even when its sentence names no rate limit", () => {
    const outcome = interpretResendResponse({ error: { message: WINDOW_SENTENCE, status: 429 } });
    expect(outcome.status).toBe("error");
    expect(outcome.status === "error" && outcome.error).toContain("wait");
    expect(outcome.status === "error" && outcome.error).not.toBe(GENERIC_AUTH_FAILURE);
  });

  it("tells a throttled sign-in to wait rather than to try again immediately", () => {
    const outcome = interpretSignInResponse({ error: { message: "Too many requests", status: 429 }, data: { session: null } });
    expect(outcome.status).toBe("error");
    expect(outcome.status === "error" && outcome.error).toContain("wait");
  });

  it("tells a throttled sign-up to wait, and does not mistake it for an account that needs confirming", () => {
    const outcome = interpretSignUpResponse({ error: { message: WINDOW_SENTENCE, status: 429 } });
    expect(outcome.status).toBe("error");
    expect(outcome.status === "error" && outcome.error).toContain("wait");
  });

  it("keeps the same reading on the recovery request that the settings screen and the forgot form both use", () => {
    expect(friendlyAuthError(WINDOW_SENTENCE, 429)).toContain("wait");
    expect(friendlyAuthError(WINDOW_SENTENCE, 429)).not.toContain("try again");
  });

  it("does not let a status rewrite a refusal whose own sentence the screen already answers correctly", () => {
    expect(friendlyAuthError("Invalid login credentials", 400))
      .toBe("That email and password combination does not match an account.");
  });

  it("still reads the wording alone when a reply arrives without a status", () => {
    expect(interpretResendResponse({ error: { message: "Email rate limit exceeded" } }).status).toBe("error");
    expect(interpretSignInResponse({ error: { message: "Email rate limit exceeded" }, data: { session: null } }).status).toBe("error");
  });
});
