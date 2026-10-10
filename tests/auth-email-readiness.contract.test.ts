import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const auth = readFileSync(path.join(root, "client/src/pages/Auth.tsx"), "utf8");
const home = readFileSync(path.join(root, "client/src/pages/Home.tsx"), "utf8");

describe("production email-delivery fail-closed boundary", () => {
  it("uses a distinct switch from public signup and never silently sends a reset from the disabled form", () => {
    expect(auth).toContain('import.meta.env.VITE_AUTH_EMAIL_ENABLED !== "false"');
    expect(auth).toContain('mode === "forgot" && !authEmailEnabled');
    expect(auth).toContain("No reset link has been sent.");
    expect(auth).toContain('authEmailEnabled ? <button type="button"');
  });
  it("prevents the signed-in settings menu from offering unconfigured email delivery", () => {
    expect(home).toContain('import.meta.env.VITE_AUTH_EMAIL_ENABLED === "false"');
    expect(home).toContain("Recovery emails are temporarily unavailable");
    expect(home).toContain("Password recovery unavailable");
  });
});
