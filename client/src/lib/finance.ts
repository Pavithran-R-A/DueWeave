// Quiet Ledger style reminder: deterministic scoring and state transitions stay pure, explainable, and testable.

import type { Activity, Client, LedgerState, Payment, PromiseRecord, PromiseStatus, Receivable } from "@/types/domain";
import { systemClock, todayInIndia, type BusinessClock } from "@/lib/business-clock";

export function isBusinessDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00+05:30`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addIndiaBusinessDays(value: string, days: number, clock: BusinessClock = systemClock) {
  if (!isBusinessDate(value) || !Number.isInteger(days)) return todayInIndia(clock);
  const parsed = new Date(`${value}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Parses an INR decimal string without using floating-point arithmetic. */
export function parseINRToPaise(value: string) {
  const normalized = value.trim().replace(/,/g, "");
  const match = normalized.match(/^(\d{1,13})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const rupees = Number(match[1]);
  const fractionalPaise = Number((match[2] ?? "").padEnd(2, "0") || "0");
  const paise = rupees * 100 + fractionalPaise;
  return Number.isSafeInteger(paise) && paise <= 900_000_000_000_000 ? paise : null;
}

export function formatINR(amountPaise: number, compact = false) {
  const amount = amountPaise / 100;
  if (compact && Math.abs(amount) >= 100000) {
    const lakh = amount / 100000;
    return `₹${lakh.toFixed(lakh % 1 === 0 ? 0 : 1)}L`;
  }
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(value: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("en-IN", options).format(new Date(`${value}T12:00:00+05:30`));
}

export function daysBetween(from: string, to: string) {
  const start = new Date(`${from}T12:00:00Z`).getTime();
  const end = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((end - start) / 86400000);
}

export function getPaymentsFor(receivableId: string, payments: Payment[]) {
  return payments.filter((payment) => payment.receivableId === receivableId);
}

export function getPaidAmount(receivableId: string, payments: Payment[]) {
  return getPaymentsFor(receivableId, payments).reduce((sum, payment) => sum + payment.amountPaise, 0);
}

export function getOutstanding(receivable: Receivable, payments: Payment[]) {
  return Math.max(0, receivable.amountDuePaise - getPaidAmount(receivable.id, payments));
}

export function getPromisesFor(receivableId: string, promises: PromiseRecord[]) {
  return promises.filter((promise) => promise.receivableId === receivableId).sort((a, b) => a.sequenceNo - b.sequenceNo);
}

export function getLatestPromise(receivableId: string, promises: PromiseRecord[]) {
  return getPromisesFor(receivableId, promises).at(-1);
}

export function getLastContacted(receivableId: string, activities: Activity[]) {
  return activities.filter((activity) => activity.receivableId === receivableId && ["follow_up", "contacted"].includes(activity.type)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]?.occurredAt;
}

/** The latest explicit snooze controls queue visibility until its business date. */
export function getSnoozedUntil(receivableId: string, activities: Activity[]) {
  return activities.filter((activity) => activity.receivableId === receivableId && activity.snoozedUntil).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]?.snoozedUntil;
}

export interface PriorityBreakdown {
  brokenPromises: number;
  promiseUrgency: number;
  daysOverdue: number;
  outstanding: number;
  contactStaleness: number;
  recentPartialAdjustment: number;
  total: number;
}

function breakdownFor(receivable: Receivable, state: LedgerState, today: string): PriorityBreakdown {
  const openReceivables = state.receivables.filter((item) => getOutstanding(item, state.payments) > 0);
  const outstanding = getOutstanding(receivable, state.payments);
  const maxOutstanding = Math.max(...openReceivables.map((item) => getOutstanding(item, state.payments)), 1);
  const brokenCount = getPromisesFor(receivable.id, state.promises).filter((promise) => promise.status === "BROKEN").length;
  const latest = getLatestPromise(receivable.id, state.promises);
  const overdueDays = Math.max(0, daysBetween(receivable.dueDate, today));
  const daysToPromise = latest?.status === "ACTIVE" ? daysBetween(today, latest.promisedDate) : null;
  const lastContacted = getLastContacted(receivable.id, state.activities);
  const contactDays = lastContacted ? Math.max(0, daysBetween(lastContacted, today)) : 30;
  const fiveDaysAgo = new Date(`${today}T12:00:00Z`); fiveDaysAgo.setUTCDate(fiveDaysAgo.getUTCDate() - 7);
  const recentThreshold = fiveDaysAgo.toISOString().slice(0, 10);
  const recentPartial = getPaymentsFor(receivable.id, state.payments).some((payment) => payment.paidDate >= recentThreshold && payment.amountPaise < receivable.amountDuePaise);
  const brokenPromises = Math.min(25, brokenCount * 10);
  const promiseUrgency = daysToPromise === null ? 0 : daysToPromise <= 0 ? 20 : daysToPromise <= 3 ? 12 : daysToPromise <= 7 ? 6 : 0;
  const daysOverdue = Math.min(20, overdueDays * 2);
  const outstandingPoints = Math.round((outstanding / maxOutstanding) * 20);
  const contactStaleness = contactDays >= 14 ? 10 : contactDays >= 7 ? 7 : contactDays >= 3 ? 3 : 0;
  const recentPartialAdjustment = recentPartial ? -5 : 0;
  const total = Math.max(0, Math.min(100, brokenPromises + promiseUrgency + daysOverdue + outstandingPoints + contactStaleness + recentPartialAdjustment));
  return { brokenPromises, promiseUrgency, daysOverdue, outstanding: outstandingPoints, contactStaleness, recentPartialAdjustment, total };
}

export function priorityBreakdown(receivable: Receivable, state: LedgerState, clock: BusinessClock = systemClock): PriorityBreakdown {
  return breakdownFor(receivable, state, todayInIndia(clock));
}

export function priorityReasons(receivable: Receivable, state: LedgerState, clock: BusinessClock = systemClock) {
  const today = todayInIndia(clock);
  const breakdown = breakdownFor(receivable, state, today);
  const reasons: { label: string; value: number }[] = [];
  const brokenCount = getPromisesFor(receivable.id, state.promises).filter((promise) => promise.status === "BROKEN").length;
  const overdueDays = Math.max(0, daysBetween(receivable.dueDate, today));
  const lastContacted = getLastContacted(receivable.id, state.activities);
  const contactDays = lastContacted ? Math.max(0, daysBetween(lastContacted, today)) : 30;
  if (brokenCount > 0) reasons.push({ label: `${brokenCount} promise${brokenCount > 1 ? "s" : ""} broken`, value: breakdown.brokenPromises });
  if (overdueDays > 0) reasons.push({ label: `${overdueDays} day${overdueDays > 1 ? "s" : ""} overdue`, value: breakdown.daysOverdue });
  if (contactDays >= 3) reasons.push({ label: `No contact for ${contactDays} days`, value: breakdown.contactStaleness });
  if (breakdown.promiseUrgency > 0) reasons.push({ label: breakdown.promiseUrgency >= 20 ? "Promise due today" : "Promise due soon", value: breakdown.promiseUrgency });
  if (breakdown.recentPartialAdjustment < 0) reasons.push({ label: "Recent partial payment", value: Math.abs(breakdown.recentPartialAdjustment) });
  if (reasons.length === 0) reasons.push({ label: "No action needed yet", value: 0 });
  return reasons.sort((a, b) => b.value - a.value).slice(0, 2);
}

export function getQueue(state: LedgerState, clock: BusinessClock = systemClock) {
  const today = todayInIndia(clock);
  return state.receivables.filter((receivable) => getOutstanding(receivable, state.payments) > 0 && (getSnoozedUntil(receivable.id, state.activities) ?? today) <= today).map((receivable) => ({ receivable, score: breakdownFor(receivable, state, today).total })).sort((a, b) => b.score - a.score || getOutstanding(b.receivable, state.payments) - getOutstanding(a.receivable, state.payments));
}

export function getReliability(clientId: string, state: LedgerState) {
  const clientReceivables = state.receivables.filter((receivable) => receivable.clientId === clientId);
  const resolved = state.promises.filter((promise) => clientReceivables.some((receivable) => receivable.id === promise.receivableId) && promise.status !== "ACTIVE");
  if (resolved.length < 3) return { enoughHistory: false, total: resolved.length, kept: 0, broken: 0, partial: 0, averageDelay: null as number | null };
  const kept = resolved.filter((promise) => promise.status === "KEPT").length;
  const broken = resolved.filter((promise) => promise.status === "BROKEN").length;
  const partial = resolved.filter((promise) => promise.status === "PARTIALLY_KEPT").length;
  const delays = resolved.filter((promise) => promise.resolvedAt).map((promise) => Math.max(0, daysBetween(promise.promisedDate, promise.resolvedAt!)));
  const averageDelay = delays.length ? Number((delays.reduce((sum, delay) => sum + delay, 0) / delays.length).toFixed(1)) : null;
  return { enoughHistory: true, total: resolved.length, kept, broken, partial, averageDelay };
}

export function getSuggestion(receivable: Receivable, state: LedgerState, clock: BusinessClock = systemClock) {
  const related = getPromisesFor(receivable.id, state.promises);
  const latest = related.at(-1);
  const brokenCount = related.filter((promise) => promise.status === "BROKEN").length;
  if (latest?.status === "PARTIALLY_KEPT") return "partial" as const;
  if (brokenCount >= 2) return "repeated" as const;
  if (latest?.status === "BROKEN") return "broken" as const;
  if (Math.max(0, daysBetween(receivable.dueDate, todayInIndia(clock))) > 0) return "overdue" as const;
  return "friendly" as const;
}

export const messageTemplates = {
  friendly: "Hi {{name}}, just checking in on the {{amount}} outstanding for {{title}}. You had mentioned payment by {{date}}, so I wanted to see whether it is scheduled. Please let me know if there is any issue from my side.",
  overdue: "Hi {{name}}, just following up on the {{amount}} outstanding for {{title}}. The payment was due on {{date}}, so I wanted to check whether it is scheduled this week. Please let me know if there is any issue from my side.",
  broken: "Hi {{name}}, I wanted to follow up on the {{amount}} outstanding for {{title}}. You had mentioned payment by {{date}}, but I cannot see it yet. Could you let me know the revised date that works for you?",
  repeated: "Hi {{name}}, I wanted to check in once more on the {{amount}} outstanding for {{title}}. We have missed the last two payment dates, so could you please confirm the next realistic date or let me know if anything is blocking it?",
  partial: "Hi {{name}}, thank you for the payment received toward {{title}}. The remaining {{amount}} is still outstanding. Could you please confirm when the balance is likely to be scheduled?",
} as const;

export type TemplateKey = keyof typeof messageTemplates;

export function interpolateMessage(template: string, values: { name: string; amount: string; title: string; date: string }) {
  return template.replace(/{{(name|amount|title|date)}}/g, (_, key: keyof typeof values) => values[key]);
}

export function getPromiseStatusLabel(status: PromiseStatus) {
  return { ACTIVE: "Active promise", KEPT: "Kept", PARTIALLY_KEPT: "Partially kept", BROKEN: "Promise broken", RENEGOTIATED: "Renegotiated", CANCELLED: "Cancelled" }[status];
}

export function getClient(clientId: string, clients: Client[]) {
  return clients.find((client) => client.id === clientId);
}
