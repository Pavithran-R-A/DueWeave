import type { Activity, Client, Payment, PaymentMethod, PromiseRecord, PromiseSource, Receivable, ReceivableStatus } from "@/types/domain";

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
  PROMISE_STATUS_CHANGED: "note",
  PAYMENT_RECORDED: "payment",
  FOLLOW_UP_RECORDED: "contacted",
  SNOOZED: "follow_up",
  NOTE_ADDED: "note",
};

function string(value: unknown) { return typeof value === "string" ? value : ""; }
function optionalString(value: unknown) { const result = string(value); return result || undefined; }
function paise(value: unknown) { const result = Number(value); return Number.isSafeInteger(result) ? result : 0; }
function calendarDate(value: unknown) { const raw = string(value); return raw.includes("T") ? raw.slice(0, 10) : raw; }

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
  return { id: string(row.id), clientId: string(row.client_id), receivableId: string(row.receivable_id), promiseId: optionalString(row.promise_id), type: activityTypeByDatabaseValue[databaseType] ?? "note", occurredAt: calendarDate(row.occurred_at), note: string(row.note), amountPaise: typeof row.amount_paise === "undefined" || row.amount_paise === null ? undefined : paise(row.amount_paise), snoozedUntil: databaseType === "SNOOZED" ? optionalString(metadata.snoozed_until) : undefined };
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
  if (normalized.includes("private ledger")) return "That record is no longer available in your ledger.";
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
