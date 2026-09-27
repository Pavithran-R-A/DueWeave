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
export type ActivityType = "created" | "promise" | "outcome" | "corrected" | "cancelled" | "payment" | "contacted" | "snoozed" | "note";

export interface Client {
  id: string;
  name: string;
  company: string;
  phone?: string;
  email?: string;
  notes?: string;
  createdAt: string;
  // Optimistic-concurrency token, kept as the database's own string because
  // re-parsing through a Date would round away the microseconds it compares on.
  updatedAt: string;
}

export interface Receivable {
  id: string;
  clientId: string;
  title: string;
  invoiceRef?: string;
  amountDuePaise: number;
  // The database owns this balance: it is recomputed from the whole payment
  // history inside the same transaction that accepts a payment, and the status
  // check below is written against it. Nothing on this side re-derives it.
  outstandingPaise: number;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  status: ReceivableStatus;
}

export interface PromiseRecord {
  id: string;
  receivableId: string;
  sequenceNo: number;
  promisedAmountPaise: number;
  /** Business date the customer made the commitment. */
  madeOn: string;
  /** Business date the customer committed to pay by. */
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
  snoozedUntil?: string;
}

export interface LedgerState {
  clients: Client[];
  receivables: Receivable[];
  promises: PromiseRecord[];
  payments: Payment[];
  activities: Activity[];
}

// The signed-in owner's own row in `public.profiles`. `plan` is deliberately
// absent: it is entitlement state the database guards with a trigger, and a view
// type that can carry it is a channel for writing it back by accident. Email is
// not here either — Supabase Auth owns it and the app reads it from there.
export interface Profile {
  id: string;
  displayName: string;
  businessName: string;
  timezone: string;
  currency: string;
  // The database's own microsecond timestamp, kept as a raw string so a
  // concurrent edit can be detected instead of silently overwritten.
  updatedAt: string;
}

export type AppSection = "today" | "receivables" | "clients" | "more" | "empty" | "loading" | "error";

export type FounderClaimStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "CANCELLED";
export type FounderEntitlementStatus = "ACTIVE" | "PENDING_REVIEW" | "REVOKED";

export interface FounderOffer {
  amountPaise: number;
  founderCap: number;
  availableSpots: number;
  payeeName: string;
  upiId?: string;
  paymentDestinationStatus: "PLACEHOLDER" | "TEST" | "LIVE";
  supportContact: string;
  supportContactStatus: "PENDING" | "CONFIGURED";
  refundPolicyStatus: "PENDING_APPROVAL" | "APPROVED";
  refundPolicyText?: string;
  disclosuresStatus: "PENDING" | "APPROVED";
  reviewWindowCopy: string;
  enabled: boolean;
}

export interface FounderClaim {
  id: string;
  claimId: string;
  plan: "FOUNDER";
  amountPaise: number;
  payerName: string;
  utrReference: string;
  status: FounderClaimStatus;
  submittedAt?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface FounderEntitlement {
  plan: "FREE" | "FOUNDER";
  status: FounderEntitlementStatus;
  activatedAt?: string;
  reviewedAt?: string;
}

export interface PendingFounderClaim {
  claimId: string;
  ownerId: string;
  ownerEmail: string;
  payerName: string;
  utrReference: string;
  amountPaise: number;
  submittedAt: string;
}

export interface RejectedFounderClaim extends PendingFounderClaim {
  rejectedAt?: string;
  rejectionNote?: string;
}

export interface FounderFunnelEvent {
  eventName: "upgrade_viewed" | "founder_claim_created" | "founder_payment_submitted" | "founder_activated" | "founder_rejected";
  eventCount: number;
}
