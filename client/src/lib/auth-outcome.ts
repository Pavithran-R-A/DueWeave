// The reading of an auth reply is pure: it never asks for a client, and it is the part a
// screen has to get right. It lives here rather than beside the hook so the static half of
// the release gate can test it without configuring credentials — a unit suite that imported
// the hook would first import the client builder, which refuses to run unconfigured.
import { PASSWORD_MIN_LENGTH } from "./auth-validation";

export type AuthResult = { error?: string };

// A sign-up attempt ends in one of three genuinely different places, and the two
// that involve no error are not the same news to give someone: a session means the
// ledger is open right now, while no session means an email has to be confirmed
// first and there is nothing to open yet. Collapsing those into { error? } is what
// let the screen say "your account is ready" to a person who could not get in.
// A sign-in ends in the same three places, and reading it as only two (the old
// { error? }) is what made an unconfirmed address look like a wrong password.
export type AuthFlowOutcome = { status: "session" } | { status: "confirmation-required" } | { status: "error"; error: string };

export const GENERIC_AUTH_FAILURE = "We could not complete that request. Please try again.";

// A throttled request is not a failed one, and the difference is actionable: every retry inside the
// window pushes its end further out. So the answer has to name the wait, and must never read as an
// invitation to send the same request again now.
export const RATE_WINDOW_COPY = "Please wait a moment before trying again.";

/** The part of an auth refusal the screen has to decide from: its sentence, and the status it came with. */
export type AuthErrorReply = { message: string; status?: number };

// The sentence a rate window is written in is not stable — the client library builds it from whichever
// of `msg`/`message`/`error_description` the server filled in — while HTTP 429 is what the reply is
// actually carrying. So the status decides, and the wording is kept for a refusal that arrives without one.
function isRateWindow(error: AuthErrorReply) {
  return error.status === 429 || error.message.toLowerCase().includes("rate limit");
}

/** The part of a sign-up reply the screen has to decide from: a refusal, a session, a user, or nothing. */
export type SignUpResponse = {
  error?: AuthErrorReply | null;
  data?: { session?: unknown | null; user?: unknown | null } | null;
};

export function friendlyAuthError(message: string, status?: number) {
  const normalized = message.toLowerCase();
  if (isRateWindow({ message, status })) {
    return RATE_WINDOW_COPY;
  }
  if (normalized.includes("invalid login") || normalized.includes("invalid credentials")) {
    return "That email and password combination does not match an account.";
  }
  if (normalized.includes("already registered") || normalized.includes("already been registered")) {
    return "An account already exists for this email. Try signing in instead.";
  }
  if (normalized.includes("password should") || normalized.includes("password must")) {
    return `Choose a password with at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (normalized.includes("network") || normalized.includes("fetch")) {
    return "We could not reach DueWeave. Check your connection and try again.";
  }
  return GENERIC_AUTH_FAILURE;
}

// Read once, decided once: an account that exists is not the same news as a ledger
// that is open, and neither is the same as a refusal.
export function interpretSignUpResponse(response: SignUpResponse): AuthFlowOutcome {
  if (response.error) return { status: "error", error: friendlyAuthError(response.error.message, response.error.status) };
  if (response.data?.session) return { status: "session" };
  if (response.data?.user) return { status: "confirmation-required" };
  return { status: "error", error: GENERIC_AUTH_FAILURE };
}

export type SignInResponse = {
  error?: AuthErrorReply | null;
  data?: { session?: unknown | null } | null;
};

// Production Auth answers a correct password on an unconfirmed address with
// `Email not confirmed` (measured against the hosted project on 2026-10-12, HTTP 400).
// That is not a refusal the visitor can act on — it is the confirmation screen, reached
// from the other side, and it is the only way someone who never got the email can find
// their way back to it.
const UNCONFIRMED_ADDRESS = /email not confirmed|confirm your email|must be confirmed/;

export function interpretSignInResponse(response: SignInResponse): AuthFlowOutcome {
  if (response.error) {
    if (UNCONFIRMED_ADDRESS.test(response.error.message.toLowerCase())) return { status: "confirmation-required" };
    return { status: "error", error: friendlyAuthError(response.error.message, response.error.status) };
  }
  if (response.data?.session) return { status: "session" };
  return { status: "error", error: GENERIC_AUTH_FAILURE };
}

export type ResendResponse = { error?: AuthErrorReply | null; data?: unknown };

/** Two endings, because the server can only ever accept or refuse the request itself. */
export type ResendOutcome = { status: "requested" } | { status: "error"; error: string };

// The client library resolves a successful resend to an empty object: the request reached
// the sender, and nothing about the mailbox is known. The sentence has to stop exactly there.
export const RESEND_REQUESTED_COPY = "We've asked DueWeave to send the confirmation link again. It can take a minute, and we cannot tell from here whether it reached your inbox.";

export const RESEND_RATE_LIMITED_COPY = "A link was asked for very recently. Please wait a minute before asking again.";

// An accepted reply carries no data worth reading — `data` is `{ user: null, session: null }`
// whether or not anything will ever be sent — so only a refusal is a refusal.
export function interpretResendResponse(response: ResendResponse): ResendOutcome {
  if (!response.error) return { status: "requested" };
  if (isRateWindow(response.error)) return { status: "error", error: RESEND_RATE_LIMITED_COPY };
  return { status: "error", error: friendlyAuthError(response.error.message, response.error.status) };
}
