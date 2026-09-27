// Quiet Ledger style reminder: this file decides one product question from persisted
// data only — has this workspace been set up yet? No browser storage is consulted.

import type { Profile } from "@/types/domain";

// `profiles.business_name` carries `check (char_length(business_name) <= 160)`,
// so this is the database's own limit mirrored here to fail early and calmly.
export const BUSINESS_NAME_LIMIT = 160;

// `profiles.display_name` has no length CHECK. This bound is a user-interface rule
// that keeps the rail and headings from breaking, and is never presented to the
// customer as something the database requires.
export const DISPLAY_NAME_LIMIT = 80;

// A workspace is ready when its owner and its business both have a name in the
// persisted profile. A brand-new account arrives with `display_name` seeded from
// Supabase Auth and `business_name` as an empty string, which is exactly the state
// onboarding exists to end; `timezone` and `currency` are product invariants and
// are therefore not part of the decision.
export function isWorkspaceSetupComplete(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  return Boolean(profile.displayName.trim() && profile.businessName.trim());
}

// The setup screen and the later edit share these words on purpose: the same two
// facts are collected the same way, whether it is the first time or the fifth.
export function validateDisplayName(value: string) {
  if (!value.trim()) return "Add your name so the ledger knows who it is greeting.";
  if (value.trim().length > DISPLAY_NAME_LIMIT) return `Keep your name under ${DISPLAY_NAME_LIMIT} characters.`;
  return "";
}

export function validateBusinessName(value: string) {
  if (!value.trim()) return "Add a business or workspace name.";
  if (value.trim().length > BUSINESS_NAME_LIMIT) return `Keep your business name under ${BUSINESS_NAME_LIMIT} characters.`;
  return "";
}
