// Quiet Ledger style reminder: these tests protect the money and date rules the ledger is judged by, independent of any seeded example data.

import { describe, expect, it } from "vitest";
import type { Activity, Client, LedgerState, Payment, PromiseRecord, Receivable } from "@/types/domain";
import {
  addIndiaBusinessDays,
  formatINR,
  getLatestPromise,
  getLastContacted,
  getOutstanding,
  getPaidAmount,
  getPromisesFor,
  getQueue,
  getReliability,
  getSnoozedUntil,
  getSuggestion,
  isBusinessDate,
  parseINRToPaise,
  priorityBreakdown,
  priorityReasons,
} from "@/lib/finance";
import { todayInIndia } from "@/lib/business-clock";

const TODAY = todayInIndia();

function receivable(overrides: Partial<Receivable> = {}): Receivable {
  const amountDuePaise = overrides.amountDuePaise ?? 500000;
  return {
    id: "recv-1",
    clientId: "client-1",
    title: "Brand film",
    amountDuePaise,
    outstandingPaise: amountDuePaise,
    dueDate: TODAY,
    createdAt: `${TODAY}T06:30:00Z`,
    updatedAt: `${TODAY}T06:30:00Z`,
    status: "OPEN",
    ...overrides,
  };
}

function payment(amountPaise: number, overrides: Partial<Payment> = {}): Payment {
  return { id: `pay-${amountPaise}`, receivableId: "recv-1", amountPaise, paidDate: TODAY, method: "UPI", createdAt: "2026-01-02T00:00:00Z", ...overrides };
}

function promise(sequenceNo: number, status: PromiseRecord["status"], overrides: Partial<PromiseRecord> = {}): PromiseRecord {
  return { id: `promise-${sequenceNo}`, receivableId: "recv-1", sequenceNo, promisedAmountPaise: 500000, promisedDate: TODAY, source: "WhatsApp", status, createdAt: `2026-01-0${sequenceNo}T00:00:00Z`, ...overrides };
}

function activity(overrides: Partial<Activity> = {}): Activity {
  return { id: "act-1", clientId: "client-1", receivableId: "recv-1", type: "contacted", occurredAt: TODAY, note: "Follow-up opened in WhatsApp.", ...overrides };
}

function state(overrides: Partial<LedgerState> = {}): LedgerState {
  const client: Client = { id: "client-1", name: "Arjun Mehta", company: "Nova Media", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  return { clients: [client], receivables: [receivable()], promises: [], payments: [], activities: [], ...overrides };
}

describe("integer paise parsing", () => {
  it("accepts rupee and two-digit paise amounts as exact integers", () => {
    expect(parseINRToPaise("500")).toBe(50000);
    expect(parseINRToPaise("500.5")).toBe(50050);
    expect(parseINRToPaise("12,500.50")).toBe(1250050);
    expect(parseINRToPaise("  28000  ")).toBe(2800000);
    expect(Number.isInteger(parseINRToPaise("12,500.50"))).toBe(true);
  });

  it("rejects ambiguity instead of silently rounding", () => {
    expect(parseINRToPaise("")).toBeNull();
    expect(parseINRToPaise("   ")).toBeNull();
    expect(parseINRToPaise(".50")).toBeNull();
    expect(parseINRToPaise("500.")).toBeNull();
    expect(parseINRToPaise("500.123")).toBeNull();
    expect(parseINRToPaise("1_000")).toBeNull();
    expect(parseINRToPaise("1 000")).toBeNull();
    expect(parseINRToPaise("1e3")).toBeNull();
    expect(parseINRToPaise("+500")).toBeNull();
    expect(parseINRToPaise("-50")).toBeNull();
    expect(parseINRToPaise("NaN")).toBeNull();
  });

  it("rejects non-ASCII digits rather than coercing them", () => {
    expect(parseINRToPaise("१२३")).toBeNull();
    expect(parseINRToPaise("١٢٣")).toBeNull();
  });

  it("enforces the rupee ceiling that keeps paise a safe integer", () => {
    expect(parseINRToPaise("9000000000000")).toBe(900000000000000);
    expect(parseINRToPaise("9000000000001")).toBeNull();
    expect(parseINRToPaise("99999999999999")).toBeNull();
  });

  it("treats a zero amount as zero, which callers must reject explicitly", () => {
    expect(parseINRToPaise("0")).toBe(0);
    expect(parseINRToPaise("0.00")).toBe(0);
  });
});

describe("rupee display", () => {
  it("groups lakhs the Indian way", () => {
    expect(formatINR(1250000)).toBe("₹12,500");
    expect(formatINR(1)).toBe("₹0.01");
    expect(formatINR(101)).toBe("₹1.01");
    expect(formatINR(125050)).toBe("₹1,250.50");
    expect(formatINR(9900000)).toBe("₹99,000");
    expect(formatINR(12500000)).toBe("₹1,25,000");
  });

  it("switches to lakh shorthand only at or above one lakh", () => {
    expect(formatINR(9900000, true)).toBe("₹99,000");
    expect(formatINR(10000000, true)).toBe("₹1L");
    expect(formatINR(15000000, true)).toBe("₹1.5L");
    expect(formatINR(50000000, true)).toBe("₹5L");
  });
});

describe("outstanding balance authority", () => {
  it("uses the balance the database recorded instead of re-deriving it from the payment list", () => {
    const item = receivable({ amountDuePaise: 500000, outstandingPaise: 250000 });
    expect(getOutstanding(item)).toBe(250000);
  });

  it("reports a settled receivable as settled from the record itself", () => {
    expect(getOutstanding(receivable({ amountDuePaise: 500000, outstandingPaise: 0, status: "PAID" }))).toBe(0);
  });

  it("still totals payments for narrative use, without letting the total decide the balance", () => {
    expect(getPaidAmount("recv-1", [payment(100000), payment(150000)])).toBe(250000);
    expect(getPaidAmount("recv-1", [payment(100000, { receivableId: "recv-2" })])).toBe(0);
  });
});

describe("priority reasons state what the ledger actually witnessed", () => {
  it("does not treat a snooze as a conversation with the client", () => {
    const snoozed = [activity({ type: "snoozed", occurredAt: TODAY, note: "Follow-up snoozed", snoozedUntil: addIndiaBusinessDays(TODAY, 2) })];
    expect(getLastContacted("recv-1", snoozed), "a snooze records a decision to wait, not contact").toBeUndefined();
    const aged = receivable({ createdAt: `${addIndiaBusinessDays(TODAY, -20)}T06:30:00Z` });
    expect(priorityBreakdown(aged, state({ activities: snoozed })).contactStaleness).toBe(10);
  });

  it("invents no silence for a receivable that was recorded today", () => {
    const fresh = receivable();
    expect(priorityBreakdown(fresh, state()).contactStaleness).toBe(0);
    expect(priorityReasons(fresh, state()).map((reason) => reason.label).join(" ")).not.toMatch(/no contact/i);
  });

  it("measures an untouched receivable from the day it was recorded", () => {
    const aged = receivable({ createdAt: `${addIndiaBusinessDays(TODAY, -20)}T06:30:00Z` });
    expect(priorityReasons(aged, state())[0].label).toMatch(/20 days/);
  });

  it("counts a quiet fortnight from the last real contact", () => {
    const activities = [activity({ occurredAt: addIndiaBusinessDays(TODAY, -15) })];
    const aged = receivable({ createdAt: `${addIndiaBusinessDays(TODAY, -60)}T06:30:00Z` });
    expect(priorityBreakdown(aged, state({ activities })).contactStaleness).toBe(10);
    expect(priorityReasons(aged, state({ activities }))[0].label).toContain("15 days");
  });

  it("keeps the overdue reason to the invoice's own due date", () => {
    const overdue = receivable({ dueDate: addIndiaBusinessDays(TODAY, -4) });
    expect(priorityReasons(overdue, state())[0].label).toBe("4 days overdue");
  });
});

describe("reliability counts promises the customer answered", () => {
  it("ignores promises that were renegotiated or cancelled", () => {
    const promises = [promise(1, "RENEGOTIATED"), promise(2, "CANCELLED"), promise(3, "BROKEN")];
    const result = getReliability("client-1", state({ promises }));
    expect(result.enoughHistory, "two promises were never answered, so there is no score yet").toBe(false);
    expect(result.total).toBe(1);
  });

  it("measures delay in India business days from a database timestamp", () => {
    const promises = [
      promise(1, "KEPT", { promisedDate: "2026-08-10", resolvedAt: "2026-08-12T18:30:00.000Z" }),
      promise(2, "KEPT", { promisedDate: "2026-08-11", resolvedAt: "2026-08-11T06:00:00.000Z" }),
      promise(3, "KEPT", { promisedDate: "2026-08-12", resolvedAt: "2026-08-14T18:00:00.000Z" }),
    ];
    const result = getReliability("client-1", state({ promises }));
    expect(result.enoughHistory).toBe(true);
    expect(result.kept).toBe(3);
    // 12 Aug 18:30 UTC is already 13 Aug in Kolkata, so that promise was three
    // days late; 11 Aug 06:00 UTC was answered on the day it named; 14 Aug
    // 18:00 UTC is 23:30 the same IST day. Slicing the timestamp instead reads
    // each one a day early and parsing it as a calendar date yields NaN.
    expect(result.averageDelay).toBe(1.7);
  });
});

describe("India business dates", () => {
  it("accepts only real calendar dates in ISO form", () => {
    expect(isBusinessDate("2026-08-12")).toBe(true);
    expect(isBusinessDate("2024-02-29")).toBe(true);
    expect(isBusinessDate("2026-02-30")).toBe(false);
    expect(isBusinessDate("2026-02-31")).toBe(false);
    expect(isBusinessDate("2026-8-1")).toBe(false);
    expect(isBusinessDate("01-08-2026")).toBe(false);
    expect(isBusinessDate("2026-08-12T00:00:00Z")).toBe(false);
    expect(isBusinessDate("")).toBe(false);
  });

  it("rolls over month and year boundaries", () => {
    expect(addIndiaBusinessDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addIndiaBusinessDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addIndiaBusinessDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addIndiaBusinessDays(TODAY, 0)).toBe(TODAY);
  });

  it("falls back to today on unusable input rather than producing a bogus date", () => {
    expect(addIndiaBusinessDays("not-a-date", 2)).toBe(TODAY);
    expect(addIndiaBusinessDays("2026-02-30", 2)).toBe(TODAY);
    expect(addIndiaBusinessDays("2026-03-01", 1.5)).toBe(TODAY);
  });
});

describe("promise history and renegotiation", () => {
  it("orders renegotiated promises by sequence, not by arrival", () => {
    const renegotiated = [
      promise(3, "ACTIVE", { createdAt: "2026-01-01T00:00:00Z" }),
      promise(1, "RENEGOTIATED", { createdAt: "2026-01-09T00:00:00Z" }),
      promise(2, "BROKEN", { createdAt: "2026-01-05T00:00:00Z" }),
    ];
    expect(getPromisesFor("recv-1", renegotiated).map((item) => item.sequenceNo)).toEqual([1, 2, 3]);
    expect(getLatestPromise("recv-1", renegotiated)?.id).toBe("promise-3");
  });

  it("keeps superseded promises available to the timeline", () => {
    const renegotiated = [promise(1, "RENEGOTIATED"), promise(2, "ACTIVE")];
    expect(getPromisesFor("recv-1", renegotiated)).toHaveLength(2);
    expect(getPromisesFor("recv-1", renegotiated)[0].status).toBe("RENEGOTIATED");
  });

  it("leaves the latest promise undefined when a receivable has none", () => {
    expect(getLatestPromise("recv-1", [])).toBeUndefined();
  });
});

describe("snooze visibility", () => {
  function snoozedState(until: string): LedgerState {
    const item: Activity = { id: "act-snooze", clientId: "client-1", receivableId: "recv-1", type: "snoozed", occurredAt: TODAY, note: "Follow-up snoozed", snoozedUntil: until };
    return state({ activities: [item] });
  }

  it("hides a follow-up while its return date is still ahead", () => {
    const queue = getQueue(snoozedState(addIndiaBusinessDays(TODAY, 1)));
    expect(queue.map((item) => item.receivable.id)).not.toContain("recv-1");
  });

  it("brings the follow-up back on its recorded date", () => {
    const queue = getQueue(snoozedState(TODAY));
    expect(queue.map((item) => item.receivable.id)).toContain("recv-1");
  });

  it("keeps a stale snooze from hiding work forever", () => {
    const queue = getQueue(snoozedState(addIndiaBusinessDays(TODAY, -1)));
    expect(queue.map((item) => item.receivable.id)).toContain("recv-1");
  });

  it("honours the most recent snooze when a follow-up was postponed twice", () => {
    const later = addIndiaBusinessDays(TODAY, 1);
    const activities: Activity[] = [
      { id: "act-1", clientId: "client-1", receivableId: "recv-1", type: "snoozed", occurredAt: addIndiaBusinessDays(TODAY, -1), note: "First snooze", snoozedUntil: TODAY },
      { id: "act-2", clientId: "client-1", receivableId: "recv-1", type: "snoozed", occurredAt: TODAY, note: "Second snooze", snoozedUntil: later },
    ];
    expect(getSnoozedUntil("recv-1", activities)).toBe(later);
    expect(getQueue(state({ activities })).map((item) => item.receivable.id)).not.toContain("recv-1");
  });

  it("reports no snooze at all for a receivable that was never postponed", () => {
    expect(getSnoozedUntil("recv-1", state().activities)).toBeUndefined();
  });
});

describe("queue determinism", () => {
  const mixed = [
    receivable({ id: "recv-a", amountDuePaise: 500000, dueDate: addIndiaBusinessDays(TODAY, -9) }),
    receivable({ id: "recv-b", amountDuePaise: 1200000, dueDate: addIndiaBusinessDays(TODAY, -2) }),
    receivable({ id: "recv-c", amountDuePaise: 300000, dueDate: addIndiaBusinessDays(TODAY, 5) }),
    receivable({ id: "recv-d", amountDuePaise: 900000, dueDate: addIndiaBusinessDays(TODAY, -30) }),
  ];
  const clients = mixed.map((item, index) => ({ ...state().clients[0], id: item.clientId, name: `Client ${index}` }));

  function queueIds(receivables: Receivable[]) {
    return getQueue(state({ clients, receivables })).map((item) => item.receivable.id);
  }

  it("produces the same order regardless of input order", () => {
    const forward = queueIds(mixed);
    const reversed = queueIds([...mixed].reverse());
    expect(forward).toHaveLength(4);
    expect(reversed).toEqual(forward);
    expect(forward[0]).toBe("recv-d");
  });

  it("breaks a full tie by the larger outstanding balance", () => {
    const tied = [
      receivable({ id: "recv-small", amountDuePaise: 300000, dueDate: TODAY }),
      receivable({ id: "recv-large", amountDuePaise: 900000, dueDate: TODAY }),
    ];
    const ids = queueIds(tied);
    expect(ids).toEqual(["recv-large", "recv-small"]);
  });

  it("keeps an identical tie in stable input order", () => {
    const tied = [
      receivable({ id: "recv-x", amountDuePaise: 400000, dueDate: TODAY }),
      receivable({ id: "recv-y", amountDuePaise: 400000, dueDate: TODAY }),
    ];
    expect(queueIds(tied)).toEqual(["recv-x", "recv-y"]);
  });

  it("excludes settled receivables from today's follow-ups", () => {
    const settled = receivable({ id: "recv-paid", amountDuePaise: 500000, outstandingPaise: 0, status: "PAID" });
    const payments = [payment(500000, { receivableId: "recv-paid" })];
    expect(getQueue(state({ clients: [state().clients[0]], receivables: [settled], payments })).map((item) => item.receivable.id)).toEqual([]);
  });
});

describe("follow-up suggestion ladder", () => {
  it("prefers a partial payment signal", () => {
    expect(getSuggestion(receivable({ dueDate: addIndiaBusinessDays(TODAY, -5) }), state({ promises: [promise(1, "PARTIALLY_KEPT")] }))).toBe("partial");
  });

  it("escalates after two broken promises", () => {
    const promises = [promise(1, "BROKEN"), promise(2, "BROKEN")];
    expect(getSuggestion(receivable({ dueDate: addIndiaBusinessDays(TODAY, -5) }), state({ promises }))).toBe("repeated");
  });

  it("names a single broken promise before overdue", () => {
    expect(getSuggestion(receivable({ dueDate: addIndiaBusinessDays(TODAY, -5) }), state({ promises: [promise(1, "BROKEN")] }))).toBe("broken");
  });

  it("calls an untouched past-due invoice overdue", () => {
    expect(getSuggestion(receivable({ dueDate: addIndiaBusinessDays(TODAY, -1) }), state())).toBe("overdue");
  });

  it("stays friendly before the due date", () => {
    expect(getSuggestion(receivable({ dueDate: addIndiaBusinessDays(TODAY, 4) }), state())).toBe("friendly");
  });
});
