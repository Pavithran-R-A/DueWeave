// Arc 3C STEP 7 — the password floor the application can enforce by itself.
//
// The hosted project runs Supabase's Free tier, where leaked-password protection is a paid add-on and
// `password_min_length` is currently 6. Neither is changed by this repository step, so the only floor
// DueWeave actually enforces today is the one in front of the sign-up and password-update forms. That
// makes it worth testing as a rule rather than as a sentence in a component: a short password that is
// accepted at sign-up is a leaked credential waiting to be tried, and the app is the only party that
// can say "not eight characters, not yet" without a configuration write.
//
// Two boundaries keep this honest. The check is a *minimum*, not a composition policy — DueWeave does
// not demand symbols, digits, or mixed case, because that produces weak passwords people write down.
// And sign-in is deliberately not length-gated: an account created before the floor existed, or one
// whose password came from another product, must still be able to sign in. Refusing a correct
// password because it is short would turn a security rule into a lockout.

import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH, validateAuthFields } from "./auth-validation";

const ok = { name: "Pavithran", email: "qa.pavithran@example.test", password: "eight chars" };
const shortestAtOrAboveFloor = "x".repeat(PASSWORD_MIN_LENGTH);

function passwordError(password: string, mode: "signUp" | "update" | "signIn" | "forgot" = "signUp") {
  return validateAuthFields(mode, { ...ok, password }).password;
}

describe("STEP 7 the application's own password floor", () => {
  it("7.1 the floor is eight characters, and it is a number rather than a sentence", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it("7.2 sign-up refuses everything below the floor, and accepts the floor itself", () => {
    for (const short of ["", "a", "abc", "1234567", "seve n", " seven"]) {
      expect(passwordError(short), `accepted ${JSON.stringify(short)}`).not.toBe("");
    }
    expect(passwordError(shortestAtOrAboveFloor)).toBe("");
  });

  it("7.3 the same floor guards the password-update form", () => {
    // The recovery link lands here, so this is the one path where a person who was locked out chooses
    // a new secret. A floor that only covered sign-up would let a 6-character reset password through.
    expect(passwordError("1234567", "update")).not.toBe("");
    expect(passwordError("12345678", "update")).toBe("");
    expect(passwordError("", "update")).not.toBe("");
  });

  it("7.4 sign-in is not length-gated, so an existing short password still opens the ledger", () => {
    expect(passwordError("hunter2", "signIn")).toBe("");
    expect(passwordError("a", "signIn")).toBe("");
    expect(passwordError("", "signIn")).not.toBe("");
  });

  it("7.5 recovery asks for no password at all", () => {
    expect(validateAuthFields("forgot", { ...ok, password: "" }).password).toBe("");
    expect(validateAuthFields("forgot", { ...ok, password: "" }).email).toBe("");
  });

  it("7.6 the floor is a minimum, not a composition policy", () => {
    // Length alone is what this step promises. Anything stricter is a different product decision, and a
    // rule that rejects "correct horse" style passphrases for lacking a symbol pushes people to reuse.
    for (const acceptable of ["eighteen", "12345678", "........", "Éöüßåæøœ", "a b c d e"]) {
      expect(passwordError(acceptable), `refused ${JSON.stringify(acceptable)}`).toBe("");
    }
  });

  it("7.7 the rule counts characters, spaces among them", () => {
    // Pinned as measured rather than fixed: eight spaces clears a length rule, and the app's promise in
    // this step is a floor on length and nothing more. If a blank-only password ever has to be refused,
    // that is a second rule and it should arrive with its own decision, not inside a floor test.
    expect(passwordError("        ")).toBe("");
    expect(passwordError("       ")).not.toBe("");
  });

  it("7.8 the rest of the form's rules are untouched by the floor", () => {
    expect(validateAuthFields("signUp", { ...ok, name: "   " }).name).not.toBe("");
    expect(validateAuthFields("signUp", { ...ok, email: "not-an-email" }).email).not.toBe("");
    expect(validateAuthFields("signIn", { ...ok, email: "" }).email).not.toBe("");
    // Update mode has no email field at all: the recovery session already carries the identity.
    expect(validateAuthFields("update", { name: "", email: "", password: "12345678" }).email).toBe("");
  });

  it("7.9 a refusal names the rule instead of echoing the password", () => {
    const message = passwordError("abc");
    expect(message).toContain(String(PASSWORD_MIN_LENGTH));
    expect(message).not.toContain("abc");
  });
});
