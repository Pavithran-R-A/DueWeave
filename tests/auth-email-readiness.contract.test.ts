import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const auth = readFileSync(path.join(root, "client/src/pages/Auth.tsx"), "utf8");
const home = readFileSync(path.join(root, "client/src/pages/Home.tsx"), "utf8");

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
