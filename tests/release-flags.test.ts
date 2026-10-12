import { describe, expect, it } from "vitest";
import { RELEASE_FLAG_NAMES, missingReleaseFlagSpecs, releaseFlagBuildError, releaseFlagEnabled } from "@/lib/release-flags";

// The shipped rule was `!== "false"`, so a build that simply forgot a flag compiled signup
// and password recovery ON. These cases pin the opposite: a flow exists only when a build
// says so in words, and forgetting is a build error rather than a product decision.
describe("release flags are fail-closed", () => {
  it("enables a flow only when the build specifies exactly \"true\"", () => {
    expect(releaseFlagEnabled("true")).toBe(true);
  });

  it("keeps the flow disabled when the variable is absent from the build", () => {
    expect(releaseFlagEnabled(undefined)).toBe(false);
  });

  it("keeps the flow disabled for the explicit off value", () => {
    expect(releaseFlagEnabled("false")).toBe(false);
  });

  it("refuses every sloppy spelling of on", () => {
    expect(releaseFlagEnabled("TRUE")).toBe(false);
    expect(releaseFlagEnabled("True")).toBe(false);
    expect(releaseFlagEnabled(" true")).toBe(false);
    expect(releaseFlagEnabled("1")).toBe(false);
    expect(releaseFlagEnabled("")).toBe(false);
    expect(releaseFlagEnabled(null)).toBe(false);
    expect(releaseFlagEnabled(true)).toBe(false);
  });

  it("lists every flag a build has to state on purpose", () => {
    expect([...RELEASE_FLAG_NAMES]).toEqual(["VITE_PUBLIC_SIGNUP_ENABLED", "VITE_AUTH_EMAIL_ENABLED"]);
  });

  it("reports both flags missing when the build environment names neither", () => {
    expect(missingReleaseFlagSpecs({})).toEqual([...RELEASE_FLAG_NAMES]);
  });

  it("accepts a build that states either setting explicitly, on or off", () => {
    expect(missingReleaseFlagSpecs({ VITE_PUBLIC_SIGNUP_ENABLED: "false", VITE_AUTH_EMAIL_ENABLED: "false" })).toEqual([]);
    expect(missingReleaseFlagSpecs({ VITE_PUBLIC_SIGNUP_ENABLED: "true", VITE_AUTH_EMAIL_ENABLED: "true" })).toEqual([]);
  });

  it("names the single flag a half-specified build forgot", () => {
    expect(missingReleaseFlagSpecs({ VITE_PUBLIC_SIGNUP_ENABLED: "true" })).toEqual(["VITE_AUTH_EMAIL_ENABLED"]);
  });

  it("treats an empty or nonsense value as unspecified rather than as a choice", () => {
    expect(missingReleaseFlagSpecs({ VITE_PUBLIC_SIGNUP_ENABLED: "", VITE_AUTH_EMAIL_ENABLED: "yes" })).toEqual([...RELEASE_FLAG_NAMES]);
  });
});

// `vite build` inlines the environment it was handed, so a flag nobody stated was not a
// decision a reviewer could see — it was the absence of one, compiled. The build guard is
// the point where that silence becomes an error.
describe("every build has to state every release flag", () => {
  const both = { VITE_PUBLIC_SIGNUP_ENABLED: "false", VITE_AUTH_EMAIL_ENABLED: "false" };

  it("names the flags a build left unstated, in an error a developer can act on", () => {
    const error = releaseFlagBuildError({ VITE_SUPABASE_URL: "https://example.supabase.co" }, { building: true });
    expect(error).toContain("VITE_PUBLIC_SIGNUP_ENABLED");
    expect(error).toContain("VITE_AUTH_EMAIL_ENABLED");
    expect(error).toContain("build");
  });

  it("accepts a build that states both, on or off", () => {
    expect(releaseFlagBuildError(both, { building: true })).toBeNull();
    expect(releaseFlagBuildError({ VITE_PUBLIC_SIGNUP_ENABLED: "true", VITE_AUTH_EMAIL_ENABLED: "true" }, { building: true })).toBeNull();
  });

  it("still refuses a build that states only one of the two", () => {
    expect(releaseFlagBuildError({ VITE_PUBLIC_SIGNUP_ENABLED: "true" }, { building: true })).toContain("VITE_AUTH_EMAIL_ENABLED");
  });

  it("refuses a staging-mode build too, because any compiled bundle is deployable", () => {
    expect(releaseFlagBuildError({}, { building: true })).toContain("VITE_PUBLIC_SIGNUP_ENABLED");
  });

  it("does not block the dev server, which never becomes an artifact", () => {
    expect(releaseFlagBuildError({}, { building: false })).toBeNull();
  });
});
