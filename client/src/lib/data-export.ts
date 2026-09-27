// Data portability has two halves that must never disagree: the complete JSON
// archive, which is the record a future tool can rebuild from, and the CSV sheets,
// which are for the spreadsheet someone already has open. Both are built here from
// the plain rows an owner is allowed to read, so what a person downloads is exactly
// what the ledger holds — integer paise, real timestamps, uuid links, and nothing
// that smells like a credential.

export const EXPORT_FORMAT = "dueweave-export";
export const EXPORT_VERSION = 1;
export const EXPORT_PRODUCT = "DueWeave";
export const EXPORT_CURRENCY = "INR";
export const EXPORT_CALENDAR = "Asia/Kolkata";
export const EXPORT_JSON_MIME = "application/json;charset=utf-8";
export const EXPORT_CSV_MIME = "text/csv;charset=utf-8";

export type ExportKind = "data" | "clients" | "receivables" | "payments" | "promises" | "activities";
type Json = Record<string, unknown>;

export interface ProfileRow {
  id: string;
  display_name: string;
  business_name: string;
  plan: string;
  timezone: string;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface ClientRow {
  id: string;
  owner_id: string;
  name: string;
  company: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReceivableRow {
  id: string;
  owner_id: string;
  client_id: string;
  label: string;
  invoice_ref: string | null;
  amount_due_paise: number;
  outstanding_paise: number;
  due_date: string;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PromiseRow {
  id: string;
  owner_id: string;
  receivable_id: string;
  sequence_no: number;
  promised_amount_paise: number;
  made_on: string;
  promised_date: string;
  source: string;
  note: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  updated_at: string;
  request_id: string | null;
}

export interface PaymentRow {
  id: string;
  owner_id: string;
  receivable_id: string;
  amount_paise: number;
  paid_on: string;
  method: string;
  reference: string | null;
  note: string | null;
  created_at: string;
  request_id: string | null;
}

export interface ActivityRow {
  id: string;
  owner_id: string;
  client_id: string | null;
  receivable_id: string | null;
  promise_id: string | null;
  type: string;
  occurred_at: string;
  note: string | null;
  amount_paise: number | null;
  created_at: string;
  metadata: Json | null;
}

export interface PromiseEventRow {
  id: string;
  owner_id: string;
  promise_id: string;
  receivable_id: string;
  from_status: string | null;
  to_status: string;
  reason: string;
  actor_type: string;
  occurred_at: string;
  created_at: string;
  metadata: Json | null;
}

export interface EntitlementRow {
  id: string;
  user_id: string;
  plan: string;
  status: string;
  source: string;
  activated_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  updated_at: string;
}

export interface PurchaseClaimRow {
  id: string;
  owner_id: string;
  claim_id: string;
  plan: string;
  payer_name: string;
  utr_reference: string;
  amount_paise: number;
  status: string;
  submitted_at: string | null;
  verified_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsEventRow {
  id: string;
  owner_id: string | null;
  event_name: string;
  entity_type: string | null;
  entity_id: string | null;
  occurred_at: string;
  metadata: Json | null;
}

export interface ExportSnapshot {
  profile: ProfileRow | null;
  email: string | null;
  clients: ClientRow[];
  receivables: ReceivableRow[];
  promises: PromiseRow[];
  payments: PaymentRow[];
  activities: ActivityRow[];
  promiseEvents: PromiseEventRow[];
  entitlement: EntitlementRow | null;
  purchaseClaims: PurchaseClaimRow[];
  analyticsEvents: AnalyticsEventRow[];
}

export interface ExportBundle {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  product: typeof EXPORT_PRODUCT;
  currency: typeof EXPORT_CURRENCY;
  businessCalendar: typeof EXPORT_CALENDAR;
  account: { displayName: string | null; businessName: string | null; email: string | null; timezone: string | null; currency: string | null };
  clients: ClientRow[];
  receivables: ReceivableRow[];
  promises: PromiseRow[];
  payments: PaymentRow[];
  activities: ActivityRow[];
  promiseEvents: PromiseEventRow[];
  entitlement: EntitlementRow | null;
  purchaseClaims: PurchaseClaimRow[];
  analyticsEvents: AnalyticsEventRow[];
}

export function buildExportBundle(snapshot: ExportSnapshot, exportedAt: string): ExportBundle {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt,
    product: EXPORT_PRODUCT,
    currency: EXPORT_CURRENCY,
    businessCalendar: EXPORT_CALENDAR,
    account: {
      displayName: snapshot.profile?.display_name ?? null,
      businessName: snapshot.profile?.business_name ?? null,
      email: snapshot.email,
      timezone: snapshot.profile?.timezone ?? null,
      currency: snapshot.profile?.currency ?? null,
    },
    clients: snapshot.clients,
    receivables: snapshot.receivables,
    promises: snapshot.promises,
    payments: snapshot.payments,
    activities: snapshot.activities,
    promiseEvents: snapshot.promiseEvents,
    entitlement: snapshot.entitlement,
    purchaseClaims: snapshot.purchaseClaims,
    analyticsEvents: snapshot.analyticsEvents,
  };
}

export function serializeExportBundle(bundle: ExportBundle) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function exportFilename(kind: ExportKind, businessDate: string) {
  return `dueweave-${kind}-${businessDate}.${kind === "data" ? "json" : "csv"}`;
}

export type CsvValue = string | number | null | undefined;

// A cell whose first meaningful character is one of these is executed by a
// spreadsheet instead of being read as the text the client typed.
const FORMULA_MARKERS = ["=", "+", "-", "@"];

function isFormulaRisk(value: string) {
  return FORMULA_MARKERS.includes(value.trimStart().charAt(0));
}

function needsQuoting(value: string) {
  return /[",\r\n]/.test(value) || value !== value.trim() || value.startsWith("'");
}

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = isFormulaRisk(value) ? `'${value}` : value;
  return needsQuoting(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function encodeCsv(rows: CsvValue[][]) {
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

// Excel on Windows reads a UTF-8 CSV as the local codepage unless the file says
// otherwise; the mark is what keeps a Tamil client name a Tamil client name.
export function withByteOrderMark(csv: string) {
  return "\uFEFF" + csv;
}

type Sheet = { columns: string[]; rows: (snapshot: ExportSnapshot) => CsvValue[][] };

function nameById(rows: { id: string; name?: string; company?: string; label?: string }[], id: string | null | undefined, field: "name" | "company" | "label") {
  const row = rows.find((item) => item.id === id);
  return row?.[field] ?? "";
}

function snoozedUntil(activity: ActivityRow) {
  const until = activity.type === "SNOOZED" ? activity.metadata?.snoozed_until : undefined;
  return typeof until === "string" ? until : null;
}

const sheets: Record<Exclude<ExportKind, "data">, Sheet> = {
  clients: {
    columns: ["client_id", "name", "company", "phone", "email", "notes", "archived_at", "created_at", "updated_at"],
    rows: (snapshot) => snapshot.clients.map((client) => [client.id, client.name, client.company, client.phone, client.email, client.notes, client.archived_at, client.created_at, client.updated_at]),
  },
  receivables: {
    columns: ["receivable_id", "client_id", "client_name", "company", "label", "invoice_ref", "amount_due_paise", "outstanding_paise", "due_date", "status", "notes", "created_at", "updated_at"],
    rows: (snapshot) => snapshot.receivables.map((receivable) => [receivable.id, receivable.client_id, nameById(snapshot.clients, receivable.client_id, "name"), nameById(snapshot.clients, receivable.client_id, "company"), receivable.label, receivable.invoice_ref, receivable.amount_due_paise, receivable.outstanding_paise, receivable.due_date, receivable.status, receivable.notes, receivable.created_at, receivable.updated_at]),
  },
  payments: {
    columns: ["payment_id", "receivable_id", "client_name", "receivable_label", "amount_paise", "paid_on", "method", "reference", "note", "created_at"],
    rows: (snapshot) => snapshot.payments.map((payment) => {
      const receivable = snapshot.receivables.find((item) => item.id === payment.receivable_id);
      return [payment.id, payment.receivable_id, nameById(snapshot.clients, receivable?.client_id, "name"), receivable?.label ?? "", payment.amount_paise, payment.paid_on, payment.method, payment.reference, payment.note, payment.created_at];
    }),
  },
  promises: {
    columns: ["promise_id", "receivable_id", "client_name", "receivable_label", "sequence_no", "promised_amount_paise", "made_on", "promised_date", "source", "status", "created_at", "resolved_at", "note"],
    rows: (snapshot) => snapshot.promises.map((promise) => {
      const receivable = snapshot.receivables.find((item) => item.id === promise.receivable_id);
      return [promise.id, promise.receivable_id, nameById(snapshot.clients, receivable?.client_id, "name"), receivable?.label ?? "", promise.sequence_no, promise.promised_amount_paise, promise.made_on, promise.promised_date, promise.source, promise.status, promise.created_at, promise.resolved_at, promise.note];
    }),
  },
  activities: {
    columns: ["activity_id", "client_id", "receivable_id", "promise_id", "type", "occurred_at", "amount_paise", "snoozed_until", "note"],
    rows: (snapshot) => snapshot.activities.map((activity) => [activity.id, activity.client_id, activity.receivable_id, activity.promise_id, activity.type, activity.occurred_at, activity.amount_paise, snoozedUntil(activity), activity.note]),
  },
};

export function csvFor(kind: Exclude<ExportKind, "data">, snapshot: ExportSnapshot) {
  const sheet = sheets[kind];
  return encodeCsv([sheet.columns, ...sheet.rows(snapshot)]);
}
