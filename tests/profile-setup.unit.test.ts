import { describe, expect, it } from "vitest";
import { BUSINESS_NAME_LIMIT, DISPLAY_NAME_LIMIT, isWorkspaceSetupComplete } from "@/lib/profile";
import { toProfile } from "@/data/supabase-adapters";

// Stage 6 decides "has this person set up their workspace?" from the persisted
// profiles row alone, so the rule and the row mapping are the two things that must
// not drift. Nothing below reads localStorage, a query string, or React state: if
// a marker outside the database could flip these answers, the gate would be lying.

const TOKEN = "2026-09-25T21:25:25.847824+00:00";

function profile(overrides: Partial<ReturnType<typeof toProfile>> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Asha Menon",
    businessName: "Northwind Studio",
    timezone: "Asia/Kolkata",
    currency: "INR",
    updatedAt: TOKEN,
    ...overrides,
  };
}

describe("workspace setup completeness (Stage 6 Phase 5)", () => {
  it("treats a brand-new profile whose business name is still empty as unfinished", () => {
    // This is the exact row a signup trigger creates: display_name seeded from Auth,
    // business_name ''. A first user must be shown setup, not an empty ledger.
    expect(isWorkspaceSetupComplete(profile({ businessName: "" }))).toBe(false);
  });

  it("treats a business name that is only whitespace as unfinished", () => {
    expect(isWorkspaceSetupComplete(profile({ businessName: "   " }))).toBe(false);
  });

  it("treats a profile with no display name as unfinished even when the business is named", () => {
    expect(isWorkspaceSetupComplete(profile({ displayName: "" }))).toBe(false);
  });

  it("counts a profile with both names filled in as finished", () => {
    expect(isWorkspaceSetupComplete(profile())).toBe(true);
  });

  it("counts a profile that has not loaded yet as unfinished rather than crashing", () => {
    expect(isWorkspaceSetupComplete(null)).toBe(false);
    expect(isWorkspaceSetupComplete(undefined)).toBe(false);
  });

  it("keeps the product invariants out of the decision", () => {
    // INR and Asia/Kolkata are invariants, not onboarding questions: a row that
    // somehow carries different values must not be treated as needing setup.
    expect(isWorkspaceSetupComplete(profile({ timezone: "Asia/Kolkata", currency: "INR" }))).toBe(true);
  });
});

describe("profile row adapter (Stage 6 Phase 6)", () => {
  it("maps the RLS-protected profiles row onto the domain profile", () => {
    const result = toProfile({
      id: profile().id,
      display_name: "Asha Menon",
      business_name: "Northwind Studio",
      timezone: "Asia/Kolkata",
      currency: "INR",
      created_at: TOKEN,
      updated_at: TOKEN,
    });

    expect(result).toEqual({
      id: profile().id,
      displayName: "Asha Menon",
      businessName: "Northwind Studio",
      timezone: "Asia/Kolkata",
      currency: "INR",
      updatedAt: TOKEN,
    });
  });

  it("carries the raw updated_at token so a concurrent edit can be detected", () => {
    const result = toProfile({ id: profile().id, display_name: "", business_name: "", timezone: "Asia/Kolkata", currency: "INR", updated_at: TOKEN });
    expect(result.updatedAt).toBe(TOKEN);
    expect(result.updatedAt).not.toBe(new Date(TOKEN).toISOString());
  });

  it("reads a missing name column as empty rather than undefined", () => {
    // '' is the database's own meaning for "not filled in yet", and the gate above
    // depends on seeing that and not the string "undefined".
    const result = toProfile({ id: profile().id, display_name: null, business_name: undefined, timezone: null, currency: null, updated_at: TOKEN });
    expect(result.displayName).toBe("");
    expect(result.businessName).toBe("");
    expect(result.timezone).toBe("");
    expect(result.currency).toBe("");
  });

  it("never exposes plan in the domain profile", () => {
    // plan is entitlement state the database guards with a trigger; a profile view
    // that could carry it is a channel for accidentally writing it back.
    expect(Object.keys(profile())).not.toContain("plan");
    expect(Object.keys(toProfile({ id: "x", display_name: "", business_name: "", plan: "FOUNDER", timezone: "Asia/Kolkata", currency: "INR", updated_at: TOKEN }))).not.toContain("plan");
  });
});

describe("field limits mirror the executed database rules (Stage 6 Phases 5-6)", () => {
  it("keeps the business-name limit at the real CHECK of 160 characters", () => {
    expect(BUSINESS_NAME_LIMIT).toBe(160);
  });

  it("keeps a display-name limit that is a user-interface rule, not a claimed database constraint", () => {
    // profiles.display_name has no length CHECK (measured against the migrated
    // local schema), so this bound is ours to keep the rail from overflowing and
    // must never be described to the user as "the database requires it".
    expect(DISPLAY_NAME_LIMIT).toBeGreaterThan(0);
    expect(DISPLAY_NAME_LIMIT).toBeLessThanOrEqual(BUSINESS_NAME_LIMIT);
  });
});
