// Quiet Ledger style reminder: these domain types keep financial state exact and the UI language factual, calm, and human.

export type PromiseStatus =
  | "ACTIVE"
  | "KEPT"
  | "PARTIALLY_KEPT"
  | "BROKEN"
  | "RENEGOTIATED"
  | "CANCELLED";

export type ReceivableStatus = "OPEN" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
export type PaymentMethod = "UPI" | "Bank transfer" | "Cash" | "Other";
export type PromiseSource = "WhatsApp" | "Call" | "Email" | "Meeting" | "Other";
export type ActivityType = "created" | "due" | "follow_up" | "contacted" | "promise" | "broken" | "payment" | "note";

export interface Client {
  id: string;
  name: string;
  company: string;
  phone?: string;
  email?: string;
  notes?: string;
  createdAt: string;
}

export interface Receivable {
  id: string;
  clientId: string;
  title: string;
  invoiceRef?: string;
  amountDuePaise: number;
  dueDate: string;
  createdAt: string;
  notes?: string;
  status: ReceivableStatus;
}

export interface PromiseRecord {
  id: string;
  receivableId: string;
  sequenceNo: number;
  promisedAmountPaise: number;
  promisedDate: string;
  source: PromiseSource;
  note?: string;
  status: PromiseStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface Payment {
  id: string;
  receivableId: string;
  amountPaise: number;
  paidDate: string;
  method: PaymentMethod;
  reference?: string;
  createdAt: string;
}

export interface Activity {
  id: string;
  clientId: string;
  receivableId: string;
  type: ActivityType;
  occurredAt: string;
  note: string;
  amountPaise?: number;
  promiseId?: string;
}

export interface DemoState {
  clients: Client[];
  receivables: Receivable[];
  promises: PromiseRecord[];
  payments: Payment[];
  activities: Activity[];
}

export type AppSection = "today" | "receivables" | "clients" | "more" | "empty" | "loading" | "error";
