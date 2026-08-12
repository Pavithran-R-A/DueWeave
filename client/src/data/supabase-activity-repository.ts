import { supabase } from "@/lib/supabase";
import { toActivity, userFacingDataError } from "./supabase-adapters";

export class SupabaseActivityRepository {
  async list() {
    const { data, error } = await supabase.from("activities").select("id, client_id, receivable_id, promise_id, type, occurred_at, note, amount_paise").order("occurred_at", { ascending: false });
    if (error) throw new Error(userFacingDataError(error.message));
    return (data ?? []).map((row) => toActivity(row));
  }

  async recordContacted(receivableId: string, note = "Follow-up marked as contacted.") {
    const { error } = await supabase.rpc("record_contacted", { p_receivable_id: receivableId, p_note: note });
    if (error) throw new Error(userFacingDataError(error.message));
  }

  async snooze(receivableId: string, until: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("Choose a valid snooze date.");
    const { error } = await supabase.rpc("snooze_receivable", { p_receivable_id: receivableId, p_until: until });
    if (error) throw new Error(userFacingDataError(error.message));
  }
}
