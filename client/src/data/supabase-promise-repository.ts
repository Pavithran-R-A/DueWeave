import { supabase } from "@/lib/supabase";
import type { PromiseRecord, PromiseSource } from "@/types/domain";
import { promiseSourceToDatabase, toPromise, userFacingDataError } from "./supabase-adapters";

export class SupabasePromiseRepository {
  async list() {
    const { data, error } = await supabase.from("promises").select("id, receivable_id, sequence_no, promised_amount_paise, promised_date, source, note, status, created_at, resolved_at").order("created_at", { ascending: true });
    if (error) throw new Error(userFacingDataError(error.message));
    return (data ?? []).map((row) => toPromise(row));
  }

  async create(receivableId: string, amountPaise: number, promisedDate: string, source: PromiseSource, note: string): Promise<PromiseRecord> {
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new Error("Enter a promise amount greater than zero.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(promisedDate)) throw new Error("Choose a valid business date.");
    const { data, error } = await supabase.rpc("create_promise", { p_receivable_id: receivableId, p_promised_amount_paise: amountPaise, p_promised_date: promisedDate, p_source: promiseSourceToDatabase(source), p_note: note.trim() });
    if (error) throw new Error(userFacingDataError(error.message));
    return toPromise(data);
  }

  async markDuePromisesBroken() {
    const { error } = await supabase.rpc("mark_due_promises_broken");
    if (error) throw new Error(userFacingDataError(error.message));
  }
}
