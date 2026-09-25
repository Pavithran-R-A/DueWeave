import { supabase } from "@/lib/supabase";
import type { Payment, PaymentMethod } from "@/types/domain";
import { paymentMethodToDatabase, toPayment, userFacingDataError } from "./supabase-adapters";

export class SupabasePaymentRepository {
  async list() {
    const { data, error } = await supabase.from("payments").select("id, receivable_id, amount_paise, paid_on, method, reference, created_at").order("paid_on", { ascending: false });
    if (error) throw new Error(userFacingDataError(error.message));
    return (data ?? []).map((row) => toPayment(row));
  }

  async record(receivableId: string, amountPaise: number, paidOn: string, method: PaymentMethod, reference: string): Promise<Payment> {
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new Error("Enter a payment amount greater than zero.");
    const { data, error } = await supabase.rpc("record_payment", { p_receivable_id: receivableId, p_amount_paise: amountPaise, p_paid_on: paidOn, p_method: paymentMethodToDatabase(method), p_reference: reference.trim() });
    if (error) throw new Error(userFacingDataError(error.message));
    return toPayment(data);
  }
}
