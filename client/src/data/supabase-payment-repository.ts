import { supabase } from "@/lib/supabase";
import type { Payment, PaymentMethod } from "@/types/domain";
import { isUuid } from "@/lib/request-id";
import { paymentMethodToDatabase, toPayment, userFacingDataError } from "./supabase-adapters";

export interface RecordPaymentInput {
  receivableId: string;
  amountPaise: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string;
  // The database replays a request id it has already used, so a double click or
  // a retried request cannot record the same money twice.
  requestId: string;
}

export class SupabasePaymentRepository {
  async list() {
    const { data, error } = await supabase.from("payments").select("id, receivable_id, amount_paise, paid_on, method, reference, created_at").order("paid_on", { ascending: false });
    if (error) throw new Error(userFacingDataError(error.message));
    return (data ?? []).map((row) => toPayment(row));
  }

  async record(input: RecordPaymentInput): Promise<Payment> {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new Error("Enter a payment amount greater than zero.");
    if (!isUuid(input.requestId)) throw new Error("This change could not be recorded safely. Please try again.");
    const { data, error } = await supabase.rpc("record_payment", {
      p_receivable_id: input.receivableId,
      p_amount_paise: input.amountPaise,
      p_paid_on: input.paidOn,
      p_method: paymentMethodToDatabase(input.method),
      p_reference: input.reference.trim(),
      p_request_id: input.requestId,
    });
    if (error) throw new Error(userFacingDataError(error.message, error.code));
    return toPayment(data);
  }
}
