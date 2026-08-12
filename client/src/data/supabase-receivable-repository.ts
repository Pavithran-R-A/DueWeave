import { supabase } from "@/lib/supabase";
import type { Receivable } from "@/types/domain";
import { toReceivable, userFacingDataError } from "./supabase-adapters";

export interface CreateReceivableInput {
  clientName: string; company: string; amountPaise: number; dueDate: string; invoiceRef: string; phone: string; email: string; notes: string;
}

export class SupabaseReceivableRepository {
  async list() {
    const { data, error } = await supabase.from("receivables").select("id, client_id, label, invoice_ref, amount_due_paise, outstanding_paise, due_date, notes, status, created_at").order("due_date", { ascending: true });
    if (error) throw new Error(userFacingDataError(error.message));
    return (data ?? []).map((row) => toReceivable(row));
  }

  async createWithClient(input: CreateReceivableInput): Promise<Receivable> {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new Error("Enter an amount greater than zero.");
    const { data, error } = await supabase.rpc("create_client_and_receivable", {
      p_client_name: input.clientName.trim() || input.company.trim(), p_company: input.company.trim(), p_phone: input.phone.trim(), p_email: input.email.trim(), p_client_notes: input.notes.trim(), p_label: input.invoiceRef.trim() || "New client work", p_invoice_ref: input.invoiceRef.trim(), p_amount_due_paise: input.amountPaise, p_due_date: input.dueDate, p_notes: input.notes.trim(),
    });
    if (error) throw new Error(userFacingDataError(error.message));
    return toReceivable(data);
  }
}
