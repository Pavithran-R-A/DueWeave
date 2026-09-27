// Quiet Ledger style reminder: a hand-off to WhatsApp is only honest if the number is
// the number the owner meant, and a follow-up note is only honest if it says what the
// owner actually saw. Everything below is pure so the rules can be read as tests.

import { describe, expect, it } from "vitest";
import { whatsappActionLabel, whatsappRecipient, whatsappUrl } from "@/lib/whatsapp";
import { contactNote, followUpDraft, messageValues, templateLabels, TEMPLATE_ORDER } from "@/lib/follow-up";
import { formatDate, getContactStaleness, getSuggestion, priorityBreakdown, timelineEvents } from "@/lib/finance";
import type { Activity, Client, LedgerState, Payment, PromiseRecord, Receivable } from "@/types/domain";

const client = (overrides: Partial<Client> = {}): Client => ({
  id: "client-1",
  name: "Nalini Ramesh",
  company: "Nalini Films",
  createdAt: "2026-09-01T09:00:00+00:00",
  updatedAt: "2026-09-01T09:00:00+00:00",
  ...overrides,
});

const receivable = (overrides: Partial<Receivable> = {}): Receivable => ({
  id: "receivable-1",
  clientId: "client-1",
  title: "Weddy teaser",
  amountDuePaise: 2800000,
  outstandingPaise: 2800000,
  dueDate: "2026-09-10",
  createdAt: "2026-09-01T09:00:00+00:00",
  updatedAt: "2026-09-01T09:00:00+00:00",
  status: "OPEN",
  ...overrides,
});

const promise = (overrides: Partial<PromiseRecord> = {}): PromiseRecord => ({
  id: "promise-1",
  receivableId: "receivable-1",
  sequenceNo: 1,
  promisedAmountPaise: 2800000,
  madeOn: "2026-09-02",
  promisedDate: "2026-09-20",
  source: "WhatsApp",
  status: "BROKEN",
  createdAt: "2026-09-02T09:00:00+00:00",
  resolvedAt: "2026-09-21T09:00:00+00:00",
  ...overrides,
});

const emptyState = (overrides: Partial<LedgerState> = {}): LedgerState => ({
  clients: [client()],
  receivables: [receivable()],
  promises: [],
  payments: [] as Payment[],
  activities: [] as Activity[],
  ...overrides,
});

const clock = { now: () => new Date("2026-09-27T10:00:00+05:30") };

describe("WhatsApp recipient rules (Stage 7 Phase 9)", () => {
  it("reads a bare ten-digit Indian mobile as the trunk number it is", () => {
    expect(whatsappRecipient("9876543210")).toEqual({ kind: "direct", internationalDigits: "919876543210" });
  });

  it("drops the trunk zero from a zero-prefixed mobile", () => {
    expect(whatsappRecipient("09876543210")).toEqual({ kind: "direct", internationalDigits: "919876543210" });
  });

  it("reads display punctuation and spacing as display only", () => {
    expect(whatsappRecipient("+91 98765 43210")).toEqual({ kind: "direct", internationalDigits: "919876543210" });
    expect(whatsappRecipient("91-98765-43210")).toEqual({ kind: "direct", internationalDigits: "919876543210" });
    expect(whatsappRecipient("  +91 (98765) 43210 ")).toEqual({ kind: "direct", internationalDigits: "919876543210" });
  });

  it("leaves a number already written internationally exactly as it is", () => {
    expect(whatsappRecipient("919876543210")).toEqual({ kind: "direct", internationalDigits: "919876543210" });
    expect(whatsappRecipient("+919876543210")).toEqual({ kind: "direct", internationalDigits: "919876543210" });
  });

  it("refuses to invent a country code for anything it cannot place", () => {
    for (const value of ["", " ", "not-a-number", "12345", "1234567890", "99876543210", "1-800-555-0100", "00919876543210", "9198765432101", "555-0100"]) {
      expect(whatsappRecipient(value), value).toEqual({ kind: "choose-contact" });
    }
  });

  it("treats a missing phone as a choice the human has to make", () => {
    expect(whatsappRecipient(undefined)).toEqual({ kind: "choose-contact" });
    expect(whatsappRecipient(null)).toEqual({ kind: "choose-contact" });
  });
});

describe("WhatsApp link builder (Stage 7 Phases 10 and 51)", () => {
  it("builds the official direct form with the message encoded once", () => {
    const url = whatsappUrl({ kind: "direct", internationalDigits: "919876543210" }, "Hi Nalini, ₹28,000 due");
    expect(url).toBe(`https://wa.me/919876543210?text=${encodeURIComponent("Hi Nalini, ₹28,000 due")}`);
    expect(url).not.toMatch(/[\s+()]/);
  });

  it("builds the choose-contact form with no number at all", () => {
    expect(whatsappUrl({ kind: "choose-contact" }, "Hello")).toBe("https://wa.me/?text=Hello");
  });

  it("encodes a multi-line, symbol-heavy message so nothing is read as URL structure", () => {
    const message = "Hi Nalini,\n\n₹28,000 is outstanding for \"Weddy teaser\" & friends.\nReply? a&b=c";
    const url = whatsappUrl(whatsappRecipient("9876543210"), message);
    const [head, query] = url.split("?");
    expect(head).toBe("https://wa.me/919876543210");
    expect(query.startsWith("text=")).toBe(true);
    expect(decodeURIComponent(query.slice(5))).toBe(message);
    expect(url).not.toMatch(/\n/);
  });

  it("keeps Tamil and accented text intact through the link", () => {
    const message = "வணக்கம் Nalini — José, ₹28,000";
    const url = whatsappUrl(whatsappRecipient("9876543210"), message);
    expect(decodeURIComponent(url.slice(url.indexOf("?text=") + 6))).toBe(message);
  });

  it("names the two actions differently so the person knows which one they are taking", () => {
    expect(whatsappActionLabel({ kind: "direct", internationalDigits: "919876543210" }, "Nalini Films")).toBe("Open WhatsApp for Nalini Films");
    expect(whatsappActionLabel({ kind: "choose-contact" }, "Nalini Films")).toBe("Choose contact in WhatsApp");
  });
});

describe("Follow-up drafts (Stage 7 Phases 15, 16 and 18)", () => {
  it("offers every built-in template with words a person can choose from", () => {
    expect(TEMPLATE_ORDER).toEqual(["friendly", "overdue", "broken", "repeated", "partial"]);
    expect(Object.keys(templateLabels).sort()).toEqual([...TEMPLATE_ORDER].sort());
    for (const key of TEMPLATE_ORDER) {
      expect(templateLabels[key].trim().length).toBeGreaterThan(3);
    }
  });

  it("fills a template from the ledger facts the sheet is standing on", () => {
    const values = messageValues(client(), receivable(), emptyState());
    expect(values).toEqual({ name: "Nalini", amount: "₹28,000", title: "Weddy teaser", date: formatDate("2026-09-10") });
  });

  it("quotes the promise date a customer actually gave, not the original due date", () => {
    const values = messageValues(client(), receivable(), emptyState({ promises: [promise()] }));
    expect(values.date).toBe(formatDate("2026-09-20"));
  });

  it("uses the first word of a full name and copes with a name that is one word", () => {
    expect(messageValues(client({ name: "Aarthi Subramanian Iyer" }), receivable(), emptyState()).name).toBe("Aarthi");
    expect(messageValues(client({ name: "Anu" }), receivable(), emptyState()).name).toBe("Anu");
    expect(messageValues(client({ name: "   " }), receivable(), emptyState()).name).toBe("there");
  });

  it("keeps a receivable title that carries punctuation and braces exactly as written", () => {
    const values = messageValues(client(), receivable({ title: "Shoot #3 (2 days) — {{amount}} & more" }), emptyState());
    expect(values.title).toBe("Shoot #3 (2 days) — {{amount}} & more");
    expect(followUpDraft("overdue", values)).toContain("{{amount}} & more");
  });

  it("never re-interprets what a customer typed as another placeholder", () => {
    const values = messageValues(client({ name: "Ravi$&" }), receivable({ title: "{{name}} & {{amount}}" }), emptyState());
    const draft = followUpDraft("friendly", values);
    expect(draft).toContain("Ravi$&");
    expect(draft).toContain("{{name}} & {{amount}}");
    expect(draft.match(/\{\{name\}\}/g)).toHaveLength(1);
    expect(draft.match(/\$&/g)).toHaveLength(1);
  });

  it("produces no placeholder, undefined, NaN or object text in any template", () => {
    const awkward = messageValues(client({ name: "சரவணகுமார்" }), receivable({ title: "", outstandingPaise: 0 }), emptyState());
    for (const key of TEMPLATE_ORDER) {
      const draft = followUpDraft(key, awkward);
      expect(draft, key).toBeTruthy();
      expect(draft, key).not.toMatch(/undefined|NaN|\[object Object\]|\{\{/);
    }
  });

  it("suggests the deterministic family for the ledger as it stands", () => {
    const state = emptyState({ promises: [promise(), promise({ id: "promise-2", sequenceNo: 2, promisedDate: "2026-09-25", status: "BROKEN", resolvedAt: "2026-09-26T09:00:00+00:00" })] });
    expect(getSuggestion(receivable(), state, clock)).toBe("repeated");
    expect(templateLabels[getSuggestion(receivable(), state, clock)]).toBe("Repeated missed promise");
  });
});

describe("Contact notes (Stage 7 Phase 7)", () => {
  it("records the channel and the context the owner confirmed, not the message body", () => {
    expect(contactNote({ channel: "whatsapp", template: "broken" })).toBe("WhatsApp follow-up sent · Broken promise");
    expect(contactNote({ channel: "whatsapp", template: "friendly" })).toBe("WhatsApp follow-up sent · Friendly reminder");
  });

  it("keeps a generic, truthful note for contact made outside WhatsApp", () => {
    expect(contactNote({ channel: "other" })).toBe("Follow-up marked as contacted.");
  });

  it("never carries the draft text into the note", () => {
    const draft = "Hi Nalini, ₹28,000 is outstanding for the Weddy teaser. Please pay.";
    expect(contactNote({ channel: "whatsapp", template: "overdue" })).not.toContain(draft);
    expect(contactNote({ channel: "other" })).not.toContain(draft);
    expect(contactNote({ channel: "whatsapp", template: "overdue" }).length).toBeLessThan(80);
  });
});

describe("Contact truth and queue staleness (Stage 7 Phase 20)", () => {
  const ten = receivable({ createdAt: "2026-09-17T09:00:00+00:00" });
  // Activity dates arrive from the adapter already as business dates, so the
  // fixtures below carry the same shape the product can actually hold.
  const contactedToday: Activity = { id: "act-1", clientId: "client-1", receivableId: ten.id, type: "contacted", occurredAt: "2026-09-27", note: contactNote({ channel: "whatsapp", template: "overdue" }) };
  const contactedLastWeek: Activity = { ...contactedToday, id: "act-0", occurredAt: "2026-09-20" };

  it("anchors the wait to the recorded contact, not to the day the receivable was made", () => {
    expect(getContactStaleness(ten, [], clock)).toEqual({ contacted: false, days: 10 });
    expect(getContactStaleness(ten, [contactedLastWeek], clock)).toEqual({ contacted: true, days: 7 });
  });

  it("counts a confirmed contact as the last touch and drops the staleness weight", () => {
    const before = priorityBreakdown(ten, emptyState({ receivables: [ten] }), clock);
    const after = priorityBreakdown(ten, emptyState({ receivables: [ten], activities: [contactedToday] }), clock);
    expect(before.contactStaleness).toBe(7);
    expect(after.contactStaleness).toBe(0);
    expect(after.total).toBeLessThan(before.total);
  });

  it("ignores every other history event when it decides who was last contacted", () => {
    const notContact: Activity[] = [
      { id: "a1", clientId: "client-1", receivableId: ten.id, type: "created", occurredAt: "2026-09-26", note: "Receivable created" },
      { id: "a2", clientId: "client-1", receivableId: ten.id, type: "note", occurredAt: "2026-09-26", note: "Draft prepared" },
      { id: "a3", clientId: "client-1", receivableId: ten.id, type: "snoozed", occurredAt: "2026-09-26", note: "Snoozed", snoozedUntil: "2026-09-30" },
    ];
    // Prepared, copied and opened are all invisible to the wait: only a recorded
    // contact moves the anchor, which stays on the day the amount was made.
    expect(getContactStaleness(ten, notContact, clock)).toEqual({ contacted: false, days: 10 });
  });

  it("keeps Stage 5's other weights untouched by a confirmed contact", () => {
    const state = emptyState({ receivables: [ten], promises: [promise({ receivableId: ten.id, status: "BROKEN" })] });
    const before = priorityBreakdown(ten, state, clock);
    const after = priorityBreakdown(ten, { ...state, activities: [contactedToday] }, clock);
    expect(after.brokenPromises).toBe(before.brokenPromises);
    expect(after.daysOverdue).toBe(before.daysOverdue);
    expect(after.outstanding).toBe(before.outstanding);
    expect(after.promiseUrgency).toBe(before.promiseUrgency);
  });
});

describe("Timeline chronology (Stage 7 Phase 20)", () => {
  // The activity read reaches the client newest-first and every exact timestamp is
  // flattened to a business date, so within one day that arrival order is the only
  // chronology the product holds. The timeline must not silently invert it.
  const createdToday: Activity = { id: "act-2", clientId: "client-1", receivableId: "receivable-1", type: "created", occurredAt: "2026-09-27", note: "Receivable created" };
  const contactedToday: Activity = { id: "act-3", clientId: "client-1", receivableId: "receivable-1", type: "contacted", occurredAt: "2026-09-27", note: contactNote({ channel: "whatsapp", template: "overdue" }) };
  const promisedEarlier: Activity = { id: "act-1", clientId: "client-1", receivableId: "receivable-1", type: "promise", occurredAt: "2026-09-20", note: "Promise made" };
  const otherReceivable: Activity = { ...promisedEarlier, id: "act-9", receivableId: "receivable-2" };

  it("shows a confirmed contact after the older event it followed on the same day", () => {
    const events = timelineEvents([contactedToday, createdToday, promisedEarlier], "receivable-1");
    expect(events.map((event) => event.id)).toEqual(["act-1", "act-2", "act-3"]);
  });

  it("keeps another receivable's history out of this timeline", () => {
    const events = timelineEvents([contactedToday, otherReceivable, createdToday], "receivable-1");
    expect(events.map((event) => event.id)).toEqual(["act-2", "act-3"]);
  });

  it("reads the caller's activities without rearranging them", () => {
    const activities = [contactedToday, createdToday, promisedEarlier];
    timelineEvents(activities, "receivable-1");
    expect(activities.map((event) => event.id)).toEqual(["act-3", "act-2", "act-1"]);
  });
});
