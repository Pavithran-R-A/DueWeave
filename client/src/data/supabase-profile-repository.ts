import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/domain";
import { BUSINESS_NAME_LIMIT, DISPLAY_NAME_LIMIT } from "@/lib/profile";
import { toProfile, userFacingDataError } from "./supabase-adapters";

// Stage 6 asks the customer for two facts and nothing else, so this seam exposes
// exactly two writable columns. `plan` is refused by a database trigger, and
// `timezone` and `currency` are refused by real CHECK constraints, but the shape
// here is what stops an editable form from ever sending them. Row security already
// limits both statements to the caller's own row; the `id` filter is kept as a
// second, explicit statement of that intent.

const PROFILE_COLUMNS = "id, display_name, business_name, timezone, currency, updated_at";

export interface UpdateProfileInput {
  ownerId: string;
  displayName: string;
  businessName: string;
  // The `updated_at` value this row was read with. The write only lands while it
  // still matches, so a form left open on another device cannot overwrite a save.
  expectedUpdatedAt: string;
}

export class SupabaseProfileRepository {
  async read(ownerId: string): Promise<Profile | null> {
    await requireSession();
    const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", ownerId).maybeSingle();
    if (error) throw new Error(userFacingDataError(error.message, error.code));
    return data ? toProfile(data) : null;
  }

  async updateWorkspace(input: UpdateProfileInput): Promise<Profile> {
    const displayName = input.displayName.trim();
    const businessName = input.businessName.trim();
    if (!displayName) throw new Error("Add your name before continuing.");
    if (!businessName) throw new Error("Add a business or workspace name before continuing.");
    if (displayName.length > DISPLAY_NAME_LIMIT) throw new Error(`Keep your name under ${DISPLAY_NAME_LIMIT} characters.`);
    if (businessName.length > BUSINESS_NAME_LIMIT) throw new Error(`Keep your business name under ${BUSINESS_NAME_LIMIT} characters.`);
    if (!input.ownerId || !input.expectedUpdatedAt) throw new Error("Reopen this screen and save again.");
    await requireSession();
    const { data, error } = await supabase
      .from("profiles")
      .update({ display_name: displayName, business_name: businessName })
      .eq("id", input.ownerId)
      .eq("updated_at", input.expectedUpdatedAt)
      .select(PROFILE_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(userFacingDataError(error.message, error.code));
    // Row security means this statement can only ever match the owner's row, so no
    // row back can only mean the token stopped matching: something was saved after
    // this form was opened.
    if (!data) throw new Error(userFacingDataError("changed in another session"));
    return toProfile(data);
  }
}

async function requireSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Your session has ended. Please sign in again.");
}
