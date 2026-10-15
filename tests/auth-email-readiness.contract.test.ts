import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const auth = readFileSync(path.join(root, "client/src/pages/Auth.tsx"), "utf8");
const home = readFileSync(path.join(root, "client/src/pages/Home.tsx"), "utf8");
const authHook = readFileSync(path.join(root, "client/src/hooks/useSupabaseAuth.ts"), "utf8");

// Both pages used to ask their own question about the same two flags: Auth asked
// `!== "false"` (so an unspecified flag meant ON) and Home asked `=== "false"`. The
// pairs below are what each screen has to do in each of the two states, now that one
// fail-closed helper answers the question for both.
describe("signup and recovery boundaries on the auth and settings screens", () => {
  it("asks the shared helper for each flag instead of comparing to a string locally", () => {
    expect(auth).toContain('import { releaseFlagEnabled } from "@/lib/release-flags";');
    expect(home).toContain('import { releaseFlagEnabled } from "@/lib/release-flags";');
    expect(auth).toContain("releaseFlagEnabled(import.meta.env.VITE_PUBLIC_SIGNUP_ENABLED)");
    expect(auth).toContain("releaseFlagEnabled(import.meta.env.VITE_AUTH_EMAIL_ENABLED)");
    expect(home).toContain("const authEmailEnabled = releaseFlagEnabled(import.meta.env.VITE_AUTH_EMAIL_ENABLED);");
  });

  it("leaves no page free to re-open a flow by comparing a release flag to a string", () => {
    for (const [name, source] of [["Auth.tsx", auth], ["Home.tsx", home]] as const) {
      expect(source, `${name} still compares a release flag to a literal`).not.toMatch(
        /VITE_(?:PUBLIC_SIGNUP|AUTH_EMAIL)_ENABLED\s*[!=]==\s*["']/,
      );
    }
  });

  it("keeps a disabled build from sending a reset link or offering registration", () => {
    expect(auth).toContain('mode === "forgot" && !authEmailEnabled');
    expect(auth).toContain("No reset link has been sent.");
    expect(auth).toContain("New registrations are temporarily paused");
    expect(auth).toContain("Password recovery emails are temporarily unavailable.");
    expect(home).toContain("if (!authEmailEnabled) {");
    expect(home).toContain("Password recovery unavailable");
    expect(home).toContain("Recovery emails are temporarily unavailable");
  });

  it("offers both flows once a build explicitly enables email delivery and signup", () => {
    expect(auth).toContain('authEmailEnabled ? <button type="button"');
    expect(auth).toContain("publicSignUpEnabled ? <>New to DueWeave?");
    expect(home).toContain("authEmailEnabled ? <button className=\"settings-row\" onClick={onRecovery}>");
    expect(home).toContain("Send link");
  });

  // The paused confirmation screen said registrations were paused in one sentence and opened the
  // registration form in the button two nodes away. Measured on the artifact production serves:
  // that click reached `POST /auth/v1/signup`, and the hosted project answers signups (`disable_signup`
  // is false), so a build whose flag says "closed" created a user. `e2e-paused/release-flags.spec.ts`
  // proves the fix in a browser; the pins below keep a later edit from re-welding the two states
  // together, which is the failure this file exists for.
  it("gates every way the auth screen opens registration on the signup flag", () => {
    const doors = auth.split(/\r?\n/).filter((line) => line.includes('changeMode("signUp")'));
    expect(doors.length, "no line in Auth.tsx switches into registration mode — the scan found nothing to gate").toBeGreaterThan(0);
    for (const line of doors) {
      expect(line, `a registration door is not gated by the flag: ${line.trim().slice(0, 90)}`).toContain("publicSignUpEnabled ?");
    }
    expect(auth).toContain("Registration is paused, so a different address cannot be started here.");
  });

  it("refuses a registration submit while the flag is off, whoever opened the form", () => {
    expect(auth).toContain('mode === "signUp" && !publicSignUpEnabled');
    expect(auth).toContain("No account has been created.");
  });
});

// The confirmation screen is the one place a launch cannot recover from on its own: an email
// that never lands (spam folder, sender warming, a typo the server accepted) leaves the visitor
// with "Start again with a different email" while the first address is already registered.
// GoTrue's `/resend` is the way out, and it has to be reachable from both entries to that
// screen — a fresh sign-up and a sign-in attempt against an address that is still unconfirmed.
describe("the confirmation screen can be reached again and asked again", () => {
  it("asks the server to send the confirmation link again, from the same screen that reports the wait", () => {
    expect(authHook).toContain("supabase.auth.resend({");
    expect(authHook).toContain('type: "signup"');
    expect(authHook).toContain("interpretResendResponse");
    expect(auth).toContain("resendConfirmation");
    expect(auth).toContain("Send the confirmation email again");
  });

  it("holds the button down while the request is in flight, because a double tap sends two emails", () => {
    expect(auth).toContain("disabled={resending}");
    expect(auth).toContain("setResending(true)");
    expect(auth).toContain("setResending(false)");
  });

  it("keeps the resend behind the same email-delivery flag as recovery and says so when it is off", () => {
    expect(auth).toContain("Confirmation emails are temporarily unavailable");
  });

  it("reports the accepted request with the shared copy instead of a delivery claim", () => {
    expect(auth).toContain("RESEND_REQUESTED_COPY");
  });

  it("routes a sign-in against an unconfirmed address into the confirmation screen instead of a generic failure", () => {
    expect(authHook).toContain("interpretSignInResponse");
    expect(auth).toContain('signInOutcome.status === "confirmation-required"');
  });
});

// A request that names no destination gets the hosted Site URL substituted for it, and a
// delivered confirmation message measured on 2026-10-12 proved that the site had been
// naming none. Both emails a customer can wait on are covered here: the first link and
// the resent one, because a visitor who asks again must come back to the same place.
describe("every email DueWeave asks for states where its link lands", () => {
  it("builds that address from the origin the browser is on, not from a value written into this file", () => {
    expect(authHook).toContain('import { confirmationRedirectUrl } from "@/lib/auth-redirect";');
    expect(authHook).toContain("confirmationRedirectUrl(window.location.origin)");
    expect(authHook).not.toMatch(/emailRedirectTo:\s*["'`]/);
  });

  it("states the destination on the sign-up request that produces the confirmation email", () => {
    expect(authHook).toMatch(/options:\s*\{[^}]*emailRedirectTo:\s*confirmationRedirectUrl\(window\.location\.origin\)/s);
  });

  it("states the same destination on the resend, so a second link is no worse than the first", () => {
    expect(authHook).toMatch(/auth\.resend\(\{[^}]*options:\s*\{[^}]*emailRedirectTo:\s*confirmationRedirectUrl\(window\.location\.origin\)/s);
  });

  it("keeps the recovery link on the recovery route it has always named", () => {
    expect(authHook).toContain("redirectTo: `${window.location.origin}/auth/update-password`");
  });
});

// One launch step cannot be re-ordered: a reset link delivered before the release flags flip has to
// stay completable in the build production serves while they are off, because that link is the only
// recovery a customer of the paused build can ever hold. Measured 2026-10-15 against
// https://dueweave.pages.dev — `/auth/update-password` with no session renders "This recovery link
// is not active." beside the flags-off notice, and `onSubmit` dispatches to `updatePassword` without
// consulting `authEmailEnabled`. The flag is allowed to refuse a *request* and to hide the buttons; it
// must never gate consuming a session the link already delivered.
function emailFlagGuards(source: string) {
  return [...source.matchAll(/mode === "(\w+)" && !authEmailEnabled/g)].map((match) => match[1] ?? "");
}

describe("a delivered reset link stays completable in the flags-off build", () => {
  it("guards only the reset request with the email flag", () => {
    expect(emailFlagGuards(auth), "the email flag now gates a submit other than the forgot request").toEqual(["forgot"]);
  });

  it("names an update-mode guard when one exists, so the pin above is not blind", () => {
    const mutated = 'if (mode === "update" && !authEmailEnabled) return;\nif (mode === "forgot" && !authEmailEnabled) return;';
    expect(emailFlagGuards(mutated)).toEqual(["update", "forgot"]);
  });

  it("wires the update submit to the provider call rather than to a flag test", () => {
    expect(auth).toMatch(/mode === "forgot"\s*\?\s*await resetPassword\(email\)\s*:\s*await updatePassword\(password\)/);
  });
});
