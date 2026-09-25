import { describe, expect, it } from "vitest";
import type { Activity, Client, LedgerState, Receivable } from "@/types/domain";
import { getQueue, getSuggestion, priorityReasons } from "@/lib/finance";
import { systemClock, todayInIndia, type BusinessClock } from "@/lib/business-clock";

// A test-only instant. Production never imports this: it keeps calling
// todayInIndia() with no argument and therefore reads the real system clock.
function clockAt(instant: string): BusinessClock {
  const fixed = new Date(instant);
  return { now: () => new Date(fixed.getTime()) };
}

const client: Client = { id: "client-1", name: "Leela", company: "Leela Films", createdAt: "2026-01-01", updatedAt: "2026-01-01" };

function receivable(overrides: Partial<Receivable> = {}): Receivable {
  return { id: "recv-1", clientId: "client-1", title: "Campaign film", amountDuePaise: 500000, dueDate: "2026-08-20", createdAt: "2026-01-01", updatedAt: "2026-01-01", status: "OPEN", ...overrides };
}

function ledger(overrides: Partial<LedgerState> = {}): LedgerState {
  return { clients: [client], receivables: [receivable()], promises: [], payments: [], activities: [], ...overrides };
}

describe("business clock seam", () => {
  it("names the India business date for an injected instant", () => {
    expect(todayInIndia(clockAt("2026-08-11T18:29:59.999Z"))).toBe("2026-08-11");
  });

  it("crosses into the next business date at India midnight", () => {
    expect(todayInIndia(clockAt("2026-08-11T18:30:00.000Z"))).toBe("2026-08-12");
  });

  it("rolls the business month at India midnight", () => {
    expect(todayInIndia(clockAt("2026-08-31T18:29:59Z"))).toBe("2026-08-31");
    expect(todayInIndia(clockAt("2026-08-31T18:30:00Z"))).toBe("2026-09-01");
  });

  it("rolls the business year at India midnight", () => {
    expect(todayInIndia(clockAt("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
  });

  it("handles a leap day without shifting it", () => {
    expect(todayInIndia(clockAt("2028-02-29T18:29:59Z"))).toBe("2028-02-29");
    expect(todayInIndia(clockAt("2028-02-29T18:30:00Z"))).toBe("2028-03-01");
    expect(todayInIndia(clockAt("2028-02-28T18:30:00Z"))).toBe("2028-02-29");
  });

  it("keeps production reading real time through the default clock", () => {
    expect(todayInIndia()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayInIndia(systemClock)).toBe(todayInIndia());
  });
});

describe("date-boundary queue behaviour under an injected instant", () => {
  const today = "2026-08-20";
  const clock = clockAt("2026-08-20T06:00:00Z");

  function queueIds(state: LedgerState) {
    return getQueue(state, clock).map((item) => item.receivable.id);
  }

  it("sees an invoice due later today as due today, not overdue", () => {
    const item = receivable({ id: "recv-due-today", dueDate: today });
    expect(queueIds(ledger({ receivables: [item] }))).toContain("recv-due-today");
    expect(priorityReasons(item, ledger({ receivables: [item] }), clock).map((reason) => reason.label)).not.toContain("1 day overdue");
    expect(getSuggestion(item, ledger(), clock)).toBe("friendly");
  });

  it("treats yesterday's due date as overdue by exactly one day", () => {
    const item = receivable({ id: "recv-late", dueDate: "2026-08-19" });
    expect(priorityReasons(item, ledger({ receivables: [item] }), clock).map((reason) => reason.label)).toContain("1 day overdue");
    expect(getSuggestion(item, ledger({ receivables: [item] }), clock)).toBe("overdue");
  });

  it("treats tomorrow's due date as not yet due", () => {
    expect(getSuggestion(receivable({ dueDate: "2026-08-21" }), ledger(), clock)).toBe("friendly");
  });

  it("keeps a follow-up snoozed until today out of the queue only until that day arrives", () => {
    const snoozedUntil = (until: string): LedgerState =>
      ledger({ activities: [{ id: "act-1", clientId: "client-1", receivableId: "recv-1", type: "follow_up", occurredAt: "2026-08-18", note: "Snoozed", snoozedUntil: until } as Activity] });
    expect(queueIds(snoozedUntil("2026-08-21"))).toEqual([]);
    expect(queueIds(snoozedUntil(today))).toEqual(["recv-1"]);
    expect(queueIds(snoozedUntil("2026-08-19"))).toEqual(["recv-1"]);
  });

  it("judges month-end work against the injected date, not the wall clock", () => {
    const monthEnd = clockAt("2026-08-31T18:29:59Z");
    expect(todayInIndia(monthEnd)).toBe("2026-08-31");
    expect(getSuggestion(receivable({ dueDate: "2026-08-31" }), ledger(), monthEnd)).toBe("friendly");
    const nextMonth = clockAt("2026-08-31T18:30:00Z");
    expect(todayInIndia(nextMonth)).toBe("2026-09-01");
    expect(getSuggestion(receivable({ dueDate: "2026-08-31" }), ledger(), nextMonth)).toBe("overdue");
  });

  it("scores the same state twice with one instant and gets an identical queue", () => {
    const state = ledger({ receivables: [receivable({ id: "r1", dueDate: "2026-08-01", amountDuePaise: 900000 }), receivable({ id: "r2", dueDate: "2026-08-19", amountDuePaise: 300000 })] });
    expect(getQueue(state, clock)).toEqual(getQueue(state, clock));
  });
});
