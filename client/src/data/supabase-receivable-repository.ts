import { supabase } from "@/lib/supabase";
import { collectAllRows } from "./pagination";
import type { Receivable } from "@/types/domain";
import { toReceivable, userFacingDataError } from "./supabase-adapters";

export interface CreateReceivableInput {
  clientName: string; company: string; receivableLabel?: string; amountPaise: number; dueDate: string; invoiceRef: string; phone: string; email: string; notes: string;
}

function assertValidAmount(amountPaise: number) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > 900_000_000_000_000) throw new Error("Enter an amount greater than zero.");
}

function assertBusinessDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a valid business date.");
}

export interface UpdateReceivableDetailsInput {
  id: string;
  label: string;
  invoiceRef?: string;
  notes?: string;
  // Read this row with its `updatedAt`, and send that value back unchanged: the
  // database refuses the edit if the row has moved on since.
  expectedUpdatedAt: string;
}

export class SupabaseReceivableRepository {
  async list() {
    const rows = await collectAllRows((from, to) => supabase.from("receivables")
      .select("id, client_id, label, invoice_ref, amount_due_paise, outstanding_paise, due_date, notes, status, created_at, updated_at")
      .order("due_date", { ascending: true }).order("id", { ascending: true }).range(from, to));
    return rows.map((row) => toReceivable(row));
  }

  async createWithClient(input: CreateReceivableInput): Promise<Receivable> {
    assertValidAmount(input.amountPaise);
    assertBusinessDate(input.dueDate);
    const clientName = input.clientName.trim() || input.company.trim();
    const label = input.receivableLabel?.trim() || input.invoiceRef.trim() || "Client work";
    if (!clientName) throw new Error("Add a client name before saving.");
    const { data, error } = await supabase.rpc("create_client_and_receivable", {
      p_client_name: clientName, p_company: input.company.trim(), p_phone: input.phone.trim(), p_email: input.email.trim(), p_client_notes: input.notes.trim(), p_label: label, p_invoice_ref: input.invoiceRef.trim(), p_amount_due_paise: input.amountPaise, p_due_date: input.dueDate, p_notes: input.notes.trim(),
    });
    if (error) throw new Error(userFacingDataError(error.message));
    return toReceivable(data);
  }

  async createForClient(input: { clientId: string; label: string; invoiceRef?: string; amountPaise: number; dueDate: string; notes?: string; }): Promise<Receivable> {
    assertValidAmount(input.amountPaise);
    assertBusinessDate(input.dueDate);
    if (!input.clientId || !input.label.trim()) throw new Error("Choose a client and add a receivable label.");
    const { data, error } = await supabase.rpc("create_receivable", {
      p_client_id: input.clientId,
      p_label: input.label.trim(),
      p_invoice_ref: input.invoiceRef?.trim() ?? "",
      p_amount_due_paise: input.amountPaise,
      p_due_date: input.dueDate,
      p_notes: input.notes?.trim() ?? "",
    });
    if (error) throw new Error(userFacingDataError(error.message));
    return toReceivable(data);
  }

  // Cancellation is offered only while nothing has been received: the amount
  // due and the whole payment history stay on the row, and the database refuses
  // the call the moment there is money to account for.
  async cancel(receivableId: string, reason: string): Promise<void> {
    if (!receivableId) throw new Error("Choose the receivable you want to close.");
    if (!reason.trim()) throw new Error("Add a short reason before closing this receivable.");
    const { error } = await supabase.rpc("cancel_receivable", { p_receivable_id: receivableId, p_reason: reason.trim() });
    if (error) throw new Error(userFacingDataError(error.message, error.code));
  }

  // Only the descriptive columns travel; the amount, outstanding balance, status
  // and owning client are refused by the database itself, so an edit can clarify
  // what an invoice was for but never what is owed.
  async updateDetails(input: UpdateReceivableDetailsInput): Promise<Receivable> {
    if (!input.id) throw new Error("Choose the receivable you want to edit.");
    if (!input.expectedUpdatedAt) throw new Error("Reopen this receivable and save again with the latest version.");
    if (!input.label.trim()) throw new Error("Add a short label for this receivable.");
    const { data, error } = await supabase.rpc("update_receivable_details", {
      p_receivable_id: input.id,
      p_label: input.label.trim(),
      p_invoice_ref: input.invoiceRef?.trim() ?? "",
      p_notes: input.notes?.trim() ?? "",
      p_expected_updated_at: input.expectedUpdatedAt,
    });
    if (error) throw new Error(userFacingDataError(error.message, error.code));
    return toReceivable(data);
  }
}
