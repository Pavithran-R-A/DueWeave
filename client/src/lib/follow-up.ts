// The five message families were always in the product; Stage 7 made them a surface
// a person can choose from. Everything here is pure so the words can be read as
// tests: the ledger facts go in, a draft comes out, and nothing is sent or recorded.

import { formatDate, formatINR, getLatestPromise, getOutstanding, getSuggestion, interpolateMessage, messageTemplates, type TemplateKey } from "@/lib/finance";
import { systemClock, type BusinessClock } from "@/lib/business-clock";
import type { Client, LedgerState, Receivable } from "@/types/domain";

export const TEMPLATE_ORDER = ["friendly", "overdue", "broken", "repeated", "partial"] as const satisfies readonly TemplateKey[];

export type FollowUpTemplate = (typeof TEMPLATE_ORDER)[number];

export const templateLabels: Record<FollowUpTemplate, string> = {
  friendly: "Friendly reminder",
  overdue: "Overdue reminder",
  broken: "Broken promise",
  repeated: "Repeated missed promise",
  partial: "Partial payment",
};

export interface MessageValues {
  name: string;
  amount: string;
  title: string;
  date: string;
}

/**
 * The facts the sheet is standing on. A customer who gave a date is quoted that
 * date, not the one originally printed on the invoice.
 */
export function messageValues(client: Client, receivable: Receivable, state: LedgerState): MessageValues {
  const [firstWord] = client.name.trim().split(/\s+/);
  const promised = getLatestPromise(receivable.id, state.promises)?.promisedDate;
  return {
    name: firstWord || "there",
    amount: formatINR(getOutstanding(receivable)),
    title: receivable.title,
    date: formatDate(promised ?? receivable.dueDate),
  };
}

export function followUpDraft(template: FollowUpTemplate, values: MessageValues) {
  return interpolateMessage(messageTemplates[template], values);
}

export function suggestedTemplate(receivable: Receivable, state: LedgerState, clock: BusinessClock = systemClock): FollowUpTemplate {
  return getSuggestion(receivable, state, clock);
}

/**
 * What the ledger remembers is the fact, the channel and the context — never the
 * draft. A follow-up note is only honest if it says what the owner confirmed.
 */
export function contactNote(confirmation: { channel: "whatsapp"; template: FollowUpTemplate } | { channel: "other" }) {
  return confirmation.channel === "whatsapp" ? `WhatsApp follow-up sent · ${templateLabels[confirmation.template]}` : "Follow-up marked as contacted.";
}
