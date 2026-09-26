// Quiet Ledger style reminder: seeded data should feel like a real service-business workday, not a generic finance demo.

import type { Activity, Client, LedgerState, Payment, PromiseRecord, Receivable } from "@/types/domain";

export const DEMO_TODAY = "2026-08-12";

const demoClients: Omit<Client, "updatedAt">[] = [
  { id: "client-nova", name: "Arjun Mehta", company: "Nova Media", phone: "919876543210", email: "arjun@novamedia.example", notes: "Retainer client. Usually pays after a short nudge.", createdAt: "2026-01-10" },
  { id: "client-rajesh", name: "Rajesh Malhotra", company: "Rajesh Studio", phone: "919810112233", email: "rajesh@rajeshstudio.example", notes: "Project photography and post-production.", createdAt: "2026-02-03" },
  { id: "client-pixel", name: "Ishita Rao", company: "PixelMint Studio", phone: "919811223344", email: "ishita@pixelmint.example", notes: "Small design studio. Newer relationship.", createdAt: "2026-06-15" },
  { id: "client-meridian", name: "Kavya Nair", company: "Meridian Events", phone: "919822334455", email: "kavya@meridian.example", notes: "Milestone-based event production work.", createdAt: "2026-03-22" },
  { id: "client-orbit", name: "Zubin Shah", company: "Orbit Interiors", phone: "919833445566", email: "zubin@orbitinteriors.example", notes: "Interior styling and procurement support.", createdAt: "2026-05-02" },
  { id: "client-kite", name: "Neel Bhatia", company: "Kite Labs", phone: "919844556677", email: "neel@kitelabs.example", notes: "Paid on time after one reminder.", createdAt: "2026-04-11" },
];

// Demo rows are drawn, never saved, so their concurrency token mirrors the date
// they were created with.
const clients: Client[] = demoClients.map((row) => ({ ...row, updatedAt: row.createdAt }));

const demoReceivables: Omit<Receivable, "updatedAt" | "outstandingPaise">[] = [
  { id: "recv-nova", clientId: "client-nova", title: "Brand film — final milestone", invoiceRef: "NM-042", amountDuePaise: 9500000, dueDate: "2026-07-24", createdAt: "2026-07-10", notes: "Final cut and social cut-downs delivered.", status: "PARTIALLY_PAID" },
  { id: "recv-rajesh", clientId: "client-rajesh", title: "Monsoon campaign photography", invoiceRef: "RS-118", amountDuePaise: 2800000, dueDate: "2026-07-18", createdAt: "2026-07-03", notes: "Gallery delivered. Two revised payment dates.", status: "OPEN" },
  { id: "recv-pixel", clientId: "client-pixel", title: "Packaging system — round 2", invoiceRef: "PM-019", amountDuePaise: 1800000, dueDate: "2026-08-13", createdAt: "2026-08-01", notes: "Client promised payment after internal sign-off.", status: "OPEN" },
  { id: "recv-meridian", clientId: "client-meridian", title: "Venue launch identity kit", invoiceRef: "ME-071", amountDuePaise: 3300000, dueDate: "2026-08-04", createdAt: "2026-07-18", notes: "Milestone invoice. First partial payment received.", status: "PARTIALLY_PAID" },
  { id: "recv-orbit", clientId: "client-orbit", title: "Apartment styling consultation", invoiceRef: "OI-033", amountDuePaise: 5540000, dueDate: "2026-07-31", createdAt: "2026-07-17", notes: "Scope completed and walkthrough shared.", status: "PARTIALLY_PAID" },
  { id: "recv-kite", clientId: "client-kite", title: "Product launch landing page", invoiceRef: "KL-054", amountDuePaise: 3600000, dueDate: "2026-08-07", createdAt: "2026-07-27", notes: "Paid in full after a single follow-up.", status: "PAID" },
];

const promises: PromiseRecord[] = [
  { id: "promise-nova-1", receivableId: "recv-nova", sequenceNo: 1, promisedAmountPaise: 500000, promisedDate: "2026-03-18", source: "Email", note: "Small deposit received after the first cut.", madeOn: "2026-03-15", status: "KEPT", createdAt: "2026-03-15", resolvedAt: "2026-03-18" },
  { id: "promise-nova-2", receivableId: "recv-nova", sequenceNo: 2, promisedAmountPaise: 2000000, promisedDate: "2026-05-21", source: "Meeting", note: "Milestone payment after internal review.", madeOn: "2026-05-18", status: "KEPT", createdAt: "2026-05-18", resolvedAt: "2026-05-21" },
  { id: "promise-nova-3", receivableId: "recv-nova", sequenceNo: 3, promisedAmountPaise: 2500000, promisedDate: "2026-06-12", source: "WhatsApp", note: "Payment landed after a two-day delay.", madeOn: "2026-06-09", status: "KEPT", createdAt: "2026-06-09", resolvedAt: "2026-06-14" },
  { id: "promise-nova-4", receivableId: "recv-nova", sequenceNo: 4, promisedAmountPaise: 1000000, promisedDate: "2026-06-30", source: "WhatsApp", note: "Balance from an earlier milestone.", madeOn: "2026-06-27", status: "KEPT", createdAt: "2026-06-27", resolvedAt: "2026-07-02" },
  { id: "promise-nova-5", receivableId: "recv-nova", sequenceNo: 5, promisedAmountPaise: 3000000, promisedDate: "2026-08-02", source: "WhatsApp", note: "No payment after the first Friday commitment.", madeOn: "2026-07-30", status: "BROKEN", createdAt: "2026-07-30", resolvedAt: "2026-08-03" },
  { id: "promise-nova-6", receivableId: "recv-nova", sequenceNo: 6, promisedAmountPaise: 3000000, promisedDate: "2026-08-09", source: "Call", note: "Second commitment was not met.", madeOn: "2026-08-04", status: "BROKEN", createdAt: "2026-08-04", resolvedAt: "2026-08-10" },
  { id: "promise-nova-7", receivableId: "recv-nova", sequenceNo: 7, promisedAmountPaise: 1500000, promisedDate: "2026-08-13", source: "WhatsApp", note: "Client says transfer is scheduled tomorrow.", madeOn: "2026-08-11", status: "ACTIVE", createdAt: "2026-08-11" },
  { id: "promise-rajesh-1", receivableId: "recv-rajesh", sequenceNo: 1, promisedAmountPaise: 2200000, promisedDate: "2026-08-01", source: "WhatsApp", note: "First revised payment date.", madeOn: "2026-07-29", status: "BROKEN", createdAt: "2026-07-29", resolvedAt: "2026-08-02" },
  { id: "promise-rajesh-2", receivableId: "recv-rajesh", sequenceNo: 2, promisedAmountPaise: 2800000, promisedDate: "2026-08-11", source: "Call", note: "Second revised date. Follow up today.", madeOn: "2026-08-07", status: "BROKEN", createdAt: "2026-08-07", resolvedAt: "2026-08-12" },
  { id: "promise-pixel-1", receivableId: "recv-pixel", sequenceNo: 1, promisedAmountPaise: 1800000, promisedDate: "2026-08-13", source: "WhatsApp", note: "Payment after client sign-off.", madeOn: "2026-08-10", status: "ACTIVE", createdAt: "2026-08-10" },
  { id: "promise-meridian-1", receivableId: "recv-meridian", sequenceNo: 1, promisedAmountPaise: 2000000, promisedDate: "2026-08-10", source: "Email", note: "First milestone partly received.", madeOn: "2026-08-06", status: "PARTIALLY_KEPT", createdAt: "2026-08-06", resolvedAt: "2026-08-10" },
  { id: "promise-orbit-1", receivableId: "recv-orbit", sequenceNo: 1, promisedAmountPaise: 1490000, promisedDate: "2026-08-08", source: "WhatsApp", note: "Balance promised after walkthrough.", madeOn: "2026-08-05", status: "BROKEN", createdAt: "2026-08-05", resolvedAt: "2026-08-09" },
  { id: "promise-kite-1", receivableId: "recv-kite", sequenceNo: 1, promisedAmountPaise: 3600000, promisedDate: "2026-08-07", source: "Email", note: "Paid on the promised date.", madeOn: "2026-08-04", status: "KEPT", createdAt: "2026-08-04", resolvedAt: "2026-08-07" },
];

const payments: Payment[] = [
  { id: "pay-nova-1", receivableId: "recv-nova", amountPaise: 500000, paidDate: "2026-03-18", method: "Bank transfer", reference: "NOVA-MAR", createdAt: "2026-03-18" },
  { id: "pay-nova-2", receivableId: "recv-nova", amountPaise: 2000000, paidDate: "2026-05-21", method: "UPI", reference: "NOVA-521", createdAt: "2026-05-21" },
  { id: "pay-nova-3", receivableId: "recv-nova", amountPaise: 2500000, paidDate: "2026-06-14", method: "UPI", reference: "NOVA-614", createdAt: "2026-06-14" },
  { id: "pay-nova-4", receivableId: "recv-nova", amountPaise: 1000000, paidDate: "2026-07-02", method: "Bank transfer", reference: "NOVA-702", createdAt: "2026-07-02" },
  { id: "pay-meridian-1", receivableId: "recv-meridian", amountPaise: 800000, paidDate: "2026-08-10", method: "UPI", reference: "MER-810", createdAt: "2026-08-10" },
  { id: "pay-orbit-1", receivableId: "recv-orbit", amountPaise: 4050000, paidDate: "2026-08-05", method: "Bank transfer", reference: "ORB-805", createdAt: "2026-08-05" },
  { id: "pay-kite-1", receivableId: "recv-kite", amountPaise: 3600000, paidDate: "2026-08-07", method: "UPI", reference: "KITE-807", createdAt: "2026-08-07" },
];

// The drawn balance is the drawn payment history, so the fixture cannot drift
// into a state the database would reject.
const receivables: Receivable[] = demoReceivables.map((row) => ({
  ...row,
  updatedAt: row.createdAt,
  outstandingPaise: Math.max(0, row.amountDuePaise - payments.filter((payment) => payment.receivableId === row.id).reduce((sum, payment) => sum + payment.amountPaise, 0)),
}));

const activities: Activity[] = [
  { id: "act-nova-created", clientId: "client-nova", receivableId: "recv-nova", type: "created", occurredAt: "2026-07-10", note: "Receivable created for Brand film — final milestone." },
  { id: "act-nova-follow-1", clientId: "client-nova", receivableId: "recv-nova", type: "contacted", occurredAt: "2026-08-06", note: "Friendly follow-up opened in WhatsApp." },
  { id: "act-nova-broken-6", clientId: "client-nova", receivableId: "recv-nova", type: "outcome", occurredAt: "2026-08-10", note: "Promise broken — no payment recorded.", promiseId: "promise-nova-6" },
  { id: "act-nova-promise-7", clientId: "client-nova", receivableId: "recv-nova", type: "promise", occurredAt: "2026-08-11", note: "Arjun promised ₹15,000 by 13 August.", amountPaise: 1500000, promiseId: "promise-nova-7" },
  { id: "act-rajesh-created", clientId: "client-rajesh", receivableId: "recv-rajesh", type: "created", occurredAt: "2026-07-03", note: "Receivable created for Monsoon campaign photography." },
  { id: "act-rajesh-follow", clientId: "client-rajesh", receivableId: "recv-rajesh", type: "contacted", occurredAt: "2026-08-06", note: "Second follow-up opened in WhatsApp." },
  { id: "act-rajesh-broken", clientId: "client-rajesh", receivableId: "recv-rajesh", type: "outcome", occurredAt: "2026-08-12", note: "Second revised promise broken.", promiseId: "promise-rajesh-2" },
  { id: "act-pixel-created", clientId: "client-pixel", receivableId: "recv-pixel", type: "created", occurredAt: "2026-08-01", note: "Receivable created for Packaging system — round 2." },
  { id: "act-meridian-payment", clientId: "client-meridian", receivableId: "recv-meridian", type: "payment", occurredAt: "2026-08-10", note: "₹8,000 partial payment recorded by UPI.", amountPaise: 800000 },
  { id: "act-orbit-payment", clientId: "client-orbit", receivableId: "recv-orbit", type: "payment", occurredAt: "2026-08-05", note: "₹40,500 payment recorded by bank transfer.", amountPaise: 4050000 },
  { id: "act-kite-paid", clientId: "client-kite", receivableId: "recv-kite", type: "payment", occurredAt: "2026-08-07", note: "₹36,000 collected in full by UPI.", amountPaise: 3600000 },
];

export function createDemoState(): LedgerState {
  return { clients: structuredClone(clients), receivables: structuredClone(receivables), promises: structuredClone(promises), payments: structuredClone(payments), activities: structuredClone(activities) };
}
