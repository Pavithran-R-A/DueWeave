import { supabase } from "@/lib/supabase";
import type { PromiseRecord, PromiseSource } from "@/types/domain";
import { isUuid } from "@/lib/request-id";
import { promiseSourceToDatabase, toPromise, userFacingDataError } from "./supabase-adapters";

export interface CreatePromiseInput {
  receivableId: string;
  amountPaise: number;
  madeOn: string;
  promisedDate: string;
  source: PromiseSource;
  note: string;
  requestId: string;
}

export class SupabasePromiseRepository {
  async list() {
    const { data, error } = await supabase.from("promises").select("id, receivable_id, sequence_no, promised_amount_paise, made_on, promised_date, source, note, status, created_at, resolved_at").order("created_at", { ascending: true });
    if (error) throw new Error(userFacingDataError(error.message));
    return (data ?? []).map((row) => toPromise(row));
  }

  async create(input: CreatePromiseInput): Promise<PromiseRecord> {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new Error("Enter a promise amount greater than zero.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.madeOn)) throw new Error("Choose the date the promise was made.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.promisedDate)) throw new Error("Choose a valid business date.");
    if (!isUuid(input.requestId)) throw new Error("This change could not be recorded safely. Please try again.");
    const { data, error } = await supabase.rpc("create_promise", {
      p_receivable_id: input.receivableId,
      p_promised_amount_paise: input.amountPaise,
      p_made_on: input.madeOn,
      p_promised_date: input.promisedDate,
      p_source: promiseSourceToDatabase(input.source),
      p_note: input.note.trim(),
      p_request_id: input.requestId,
    });
    if (error) throw new Error(userFacingDataError(error.message, error.code));
    return toPromise(data);
  }

  // Withdrawing a promise is the only promise edit offered: the commitment and
  // its outcome stay in the timeline either way.
  async cancel(promiseId: string, reason: string): Promise<void> {
    if (!promiseId) throw new Error("Choose the promise you want to withdraw.");
    if (!reason.trim()) throw new Error("Add a short reason before withdrawing this promise.");
    const { error } = await supabase.rpc("cancel_promise", { p_promise_id: promiseId, p_reason: reason.trim() });
    if (error) throw new Error(userFacingDataError(error.message, error.code));
  }

  async markDuePromisesBroken() {
    const { error } = await supabase.rpc("mark_due_promises_broken");
    if (error) throw new Error(userFacingDataError(error.message));
  }
}
