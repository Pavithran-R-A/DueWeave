import type { Activity, Client, Payment, PaymentMethod, PromiseRecord, PromiseSource, Receivable, ReceivableStatus } from "@/types/domain";
import { toIndiaBusinessDate } from "@/lib/business-clock";

type Row = Record<string, unknown>;

const paymentMethodByDatabaseValue: Record<string, PaymentMethod> = {
  UPI: "UPI",
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  OTHER: "Other",
};

const promiseSourceByDatabaseValue: Record<string, PromiseSource> = {
  WHATSAPP: "WhatsApp",
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  OTHER: "Other",
};

const activityTypeByDatabaseValue: Record<string, Activity["type"]> = {
  RECEIVABLE_CREATED: "created",
  PROMISE_CREATED: "promise",
  PROMISE_STATUS_CHANGED: "outcome",
  PROMISE_CORRECTED: "corrected",
  PROMISE_CANCELLED: "cancelled",
  RECEIVABLE_CANCELLED: "cancelled",
  PAYMENT_RECORDED: "payment",
  FOLLOW_UP_RECORDED: "contacted",
  SNOOZED: "snoozed",
  NOTE_ADDED: "note",
};

function string(value: unknown) { return typeof value === "string" ? value : ""; }
function optionalString(value: unknown) { const result = string(value); return result || undefined; }
function paise(value: unknown) { const result = Number(value); return Number.isSafeInteger(result) ? result : 0; }
function businessDate(value: unknown) { return toIndiaBusinessDate(string(value)); }

export function toClient(row: Row): Client {
  return { id: string(row.id), name: string(row.name), company: string(row.company), phone: optionalString(row.phone), email: optionalString(row.email), notes: optionalString(row.notes), createdAt: string(row.created_at), updatedAt: string(row.updated_at) };
}

export function toReceivable(row: Row): Receivable {
  return { id: string(row.id), clientId: string(row.client_id), title: string(row.label), invoiceRef: optionalString(row.invoice_ref), amountDuePaise: paise(row.amount_due_paise), outstandingPaise: paise(row.outstanding_paise), dueDate: string(row.due_date), createdAt: string(row.created_at), updatedAt: string(row.updated_at), notes: optionalString(row.notes), status: string(row.status) as ReceivableStatus };
}

export function toPromise(row: Row): PromiseRecord {
  const source = string(row.source).toUpperCase();
  return { id: string(row.id), receivableId: string(row.receivable_id), sequenceNo: Number(row.sequence_no) || 1, promisedAmountPaise: paise(row.promised_amount_paise), promisedDate: string(row.promised_date), source: promiseSourceByDatabaseValue[source] ?? "Other", note: optionalString(row.note), status: string(row.status) as PromiseRecord["status"], createdAt: string(row.created_at), resolvedAt: optionalString(row.resolved_at) };
}

export function toPayment(row: Row): Payment {
  const method = string(row.method).toUpperCase();
  return { id: string(row.id), receivableId: string(row.receivable_id), amountPaise: paise(row.amount_paise), paidDate: string(row.paid_on), method: paymentMethodByDatabaseValue[method] ?? "Other", reference: optionalString(row.reference), createdAt: string(row.created_at) };
}

export function toActivity(row: Row): Activity {
  const databaseType = string(row.type).toUpperCase();
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Row : {};
  return { id: string(row.id), clientId: string(row.client_id), receivableId: string(row.receivable_id), promiseId: optionalString(row.promise_id), type: activityTypeByDatabaseValue[databaseType] ?? "note", occurredAt: businessDate(row.occurred_at), note: string(row.note), amountPaise: typeof row.amount_paise === "undefined" || row.amount_paise === null ? undefined : paise(row.amount_paise), snoozedUntil: databaseType === "SNOOZED" ? optionalString(metadata.snoozed_until) : undefined };
}

export function promiseSourceToDatabase(source: PromiseSource) {
  return source === "WhatsApp" ? "WHATSAPP" : source.toUpperCase();
}

export function paymentMethodToDatabase(method: PaymentMethod) {
  return method === "Bank transfer" ? "BANK_TRANSFER" : method.toUpperCase();
}

export function userFacingDataError(message?: string, code?: string) {
  const normalized = (message ?? "").toLowerCase();
  if (code === "40001" || normalized.includes("changed in another session")) return "This record changed while you were editing. Reopen it and save again with the latest version.";
  // A retry that carries the same request id returns the original result, so a
  // mismatch here means two genuinely different writes were attempted.
  if (normalized.includes("already recorded a different")) return "That change does not match what was already saved. Reload to see the current state before trying again.";
  if (normalized.includes("larger than dueweave can record")) return "That amount is larger than DueWeave can record. Split it into smaller entries.";
  if (normalized.includes("dated in the future")) return "A payment cannot be dated in the future. Choose today or an earlier date.";
  if (normalized.includes("how the money arrived")) return "Choose how the money arrived.";
  if (normalized.includes("how the promise was made")) return "Choose how the promise was made.";
  if (normalized.includes("the date the money arrived")) return "Choose the date the money arrived.";
  if (normalized.includes("the date the customer promised")) return "Choose the date the customer promised.";
  if (normalized.includes("already settled")) return "This receivable is fully paid, so there is nothing left to record against it.";
  if (normalized.includes("promise is already cancelled")) return "That promise has already been withdrawn.";
  if (normalized.includes("already cancelled") || normalized.includes("cancelled receivable does not accept")) return "This receivable is already closed.";
  if (normalized.includes("with recorded payments cannot be cancelled")) return "Payments have been recorded against this receivable, so it stays open with its remaining balance.";
  if (normalized.includes("cancel the promise instead")) return "This receivable is fully paid. Withdraw the promise instead if it was recorded by mistake.";
  if (normalized.includes("short reason for")) return "Add a short reason before closing this.";
  if (normalized.includes("already has a recorded outcome") || normalized.includes("is final") || normalized.includes("has not reached its outcome")) return "That promise already has its outcome recorded, so it cannot be changed again.";
  if (normalized.includes("up to 2,000 characters")) return "Keep that note under 2,000 characters.";
  if (normalized.includes("up to 160 characters")) return "Keep that reference under 160 characters.";
  if (normalized.includes("one business calendar")) return "DueWeave keeps a single working calendar for the ledger.";
  if (normalized.includes("inr only")) return "DueWeave records amounts in rupees.";
  if (normalized.includes("protected workflow") || normalized.includes("needs a request id")) return "That change could not be recorded safely. Please try again.";
  if (normalized.includes("founder review access")) return "Founder review access is not available for this account.";
  if (normalized.includes("already active")) return "Founder access is already active for this account.";
  if (normalized.includes("offer is currently full")) return "The verified Founder offer is currently full.";
  if (normalized.includes("payment instructions are not ready")) return "UPI instructions are not ready for payment submission yet.";
  if (normalized.includes("payment reference has already")) return "That payment reference has already been submitted.";
  if (normalized.includes("payment claim")) return "This Founder payment claim is not available in this account.";
  if (normalized.includes("payer name")) return "Enter the payer name used for the payment.";
  if (normalized.includes("payment reference with")) return "Enter a valid UTR or payment reference.";
  if (normalized.includes("founder access is not available")) return "The Founder offer is unavailable right now.";
  if (normalized.includes("review note") || normalized.includes("revocation reason")) return "Add a short review reason before continuing.";
  if (normalized.includes("free plan allows")) return "Your Free plan allows up to three active receivables. Close or settle one before adding another.";
  if (normalized.includes("within the remaining balance")) return "The amount must be greater than zero and no more than the remaining balance.";
  if (normalized.includes("valid positive receivable amount") || normalized.includes("amount greater than zero")) return "Enter a valid amount greater than zero.";
  if (normalized.includes("client name") || normalized.includes("business name")) return "Add a short client or business name before saving.";
  if (normalized.includes("valid email")) return "Enter a valid email address or leave it blank.";
  if (normalized.includes("valid phone")) return "Enter a valid phone number or leave it blank.";
  if (normalized.includes("due date") || normalized.includes("business date")) return "Choose a valid business date.";
  if (normalized.includes("receivable label")) return "Add a short label for this receivable.";
  if (normalized.includes("snooze date")) return "Choose today or a future date to snooze this follow-up.";
  if (normalized.includes("closed receivable")) return "This receivable is already closed, so it cannot receive a new promise.";
  if (normalized.includes("not available for this account")) return "That item is not available in this private ledger.";
  if (normalized.includes("authentication")) return "Your session has expired. Please sign in again.";
  if (normalized.includes("network") || normalized.includes("fetch")) return "We could not reach DueWeave. Check your connection and try again.";
  return "We could not save that change. Please try again.";
}
