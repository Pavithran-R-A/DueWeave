// Arc 3C STEP 7 — the field rules the sign-in, sign-up and recovery forms share.
//
// This lives outside the page component so the floor below is a rule that can be executed, not a
// sentence inside JSX. The reason it matters right now is a hosted one: the production project runs
// Supabase's Free tier, where `password_min_length` reads 6 and leaked-password protection is a paid
// setting this build does not turn on and will not pay for. So the eight-character floor is enforced
// here, in the only place DueWeave controls without a configuration write, and raising the hosted
// value to match it is recorded as a later production Auth action rather than done in this step.
//
// The floor is deliberately a *length* rule and nothing more — no symbol, digit or case requirements.
// Composition policies push people to write passwords down or reuse them, which trades a guessable
// secret for a recorded one.

export const PASSWORD_MIN_LENGTH = 8;

export type AuthMode = "signIn" | "signUp" | "forgot" | "update";

export interface AuthFieldInput {
  name: string;
  email: string;
  password: string;
}

export interface AuthFieldErrors {
  name: string;
  email: string;
  password: string;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The state every field starts and every successful submit ends in. */
export const noFieldErrors: AuthFieldErrors = { name: "", email: "", password: "" };

/**
 * What each mode needs before it is worth asking the server. Anything the person can still fix by
 * typing is checked here; anything only the server knows (an unknown password, an email already
 * taken) is left for the server to report.
 *
 * Sign-in carries no length gate on purpose: an account whose password predates this floor must still
 * be able to open its ledger, and refusing a correct password reads to the person as a lockout.
 */
export function validateAuthFields(mode: AuthMode, input: AuthFieldInput): AuthFieldErrors {
  const errors: AuthFieldErrors = { ...noFieldErrors };
  if (mode === "signUp" && !input.name.trim()) errors.name = "Add your name so we know who to greet.";
  if (mode !== "update") {
    if (!input.email.trim()) errors.email = "Enter your email address.";
    else if (!EMAIL_SHAPE.test(input.email.trim())) errors.email = "That does not look like an email address yet.";
  }
  if (mode !== "forgot") {
    if (!input.password) errors.password = "Enter your password.";
    else if (mode !== "signIn" && input.password.length < PASSWORD_MIN_LENGTH) {
      errors.password = `Choose a password with at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
  }
  return errors;
}
