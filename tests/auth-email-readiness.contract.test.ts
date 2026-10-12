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
});

// The confirmation screen is the one place a launch cannot recover from on its own: an email
// that never lands (spam folder, sender warming, a typo the server accepted) leaves the visitor
// with "Start again with a different email" while the first address is already registered.
// GoTrue's `/resend` is the way out, and it has to be reachable from both entries to that
// screen — a fresh sign-up and a sign-in attempt against an address that is still unconfirmed.
describe("the confirmation screen can be reached again and asked again", () => {
  it("asks the server to send the confirmation link again, from the same screen that reports the wait", () => {
    expect(authHook).toContain('supabase.auth.resend({ type: "signup"');
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
