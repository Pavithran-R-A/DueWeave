import { describe, expect, it } from "vitest";
import { GENERIC_AUTH_FAILURE, interpretSignUpResponse } from "@/lib/auth-outcome";

// Local Supabase confirms sign-ups immediately, so a browser journey can only ever
// exercise one of the three endings a provider can give. The screen's whole promise
// is that it says different things for each, so the reading of the response is
// tested here instead: what a session, a bare user, and a refusal each mean.
const none = { session: null, user: null };

describe("sign-up response contract", () => {
  it("opens the ledger only when the provider actually handed back a session", () => {
    expect(interpretSignUpResponse({ error: null, data: { session: { access_token: "issued" }, user: { id: "u1" } } }))
      .toEqual({ status: "session" });
  });

  it("asks for the confirmation email when the account exists but no session does", () => {
    const outcome = interpretSignUpResponse({ error: null, data: { session: null, user: { id: "u1" } } });
    expect(outcome).toEqual({ status: "confirmation-required" });
    expect(outcome).not.toHaveProperty("session");
  });

  it("refuses to claim an account is ready when the provider returned neither", () => {
    expect(interpretSignUpResponse({ error: null, data: none })).toEqual({ status: "error", error: GENERIC_AUTH_FAILURE });
  });

  it("answers an existing email with the way back to sign in", () => {
    expect(interpretSignUpResponse({ error: { message: "User already registered" }, data: none }))
      .toEqual({ status: "error", error: "An account already exists for this email. Try signing in instead." });
  });

  it("keeps a provider failure it does not recognise factual rather than raw", () => {
    const outcome = interpretSignUpResponse({ error: { message: 'duplicate key value violates unique constraint "profiles_pkey"' }, data: none });
    expect(outcome).toEqual({ status: "error", error: GENERIC_AUTH_FAILURE });
    expect(JSON.stringify(outcome)).not.toMatch(/duplicate key|constraint|PGRST|23505/);
  });
});
