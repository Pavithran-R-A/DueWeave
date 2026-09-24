// Quiet Ledger style reminder: tests protect the explainable money story so UI polish cannot hide broken arithmetic or state transitions.

import { describe, expect, it } from "vitest";
import { createDemoState, DEMO_TODAY } from "@/data/demo";
import { addIndiaBusinessDays, daysBetween, formatINR, getOutstanding, getQueue, getReliability, interpolateMessage, parseINRToPaise, priorityBreakdown, todayInIndia } from "@/lib/finance";

describe("finance helpers", () => {
  it("formats paise as Indian rupee amounts", () => {
    expect(formatINR(1200000)).toBe("₹12,000");
    expect(formatINR(1)).toBe("₹0");
    expect(formatINR(125050)).toBe("₹1,251");
  });

  it("returns a database-compatible India calendar date for live records", () => {
    expect(todayInIndia()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps partial payments visible as an outstanding balance", () => {
    const state = createDemoState();
    const orbit = state.receivables.find((item) => item.id === "recv-orbit")!;
    expect(getOutstanding(orbit, state.payments)).toBe(1490000);
  });

  it("recognizes a fully paid receivable", () => {
    const state = createDemoState();
    const kite = state.receivables.find((item) => item.id === "recv-kite")!;
    expect(getOutstanding(kite, state.payments)).toBe(0);
  });

  it("orders the deterministic queue by priority score", () => {
    const state = createDemoState();
    const queue = getQueue(state);
    expect(queue.length).toBe(5);
    expect(queue[0].receivable.id).toBe("recv-nova");
    expect(priorityBreakdown(queue[0].receivable, state).total).toBeGreaterThan(priorityBreakdown(queue[queue.length - 1].receivable, state).total);
  });

  it("parses money into integer paise without accepting float ambiguity or negatives", () => {
    expect(parseINRToPaise("12,500.50")).toBe(1250050);
    expect(parseINRToPaise("0.009")).toBeNull();
    expect(parseINRToPaise("-50")).toBeNull();
    expect(parseINRToPaise("1e3")).toBeNull();
  });

  it("keeps a snoozed receivable out of Today until its India business date", () => {
    const state = createDemoState();
    const snoozedId = state.receivables[0].id;
    state.activities.push({ id: "activity-snooze", clientId: state.receivables[0].clientId, receivableId: snoozedId, type: "follow_up", occurredAt: todayInIndia(), note: "Follow-up snoozed", snoozedUntil: addIndiaBusinessDays(todayInIndia(), 1) });
    expect(getQueue(state).some(({ receivable }) => receivable.id === snoozedId)).toBe(false);
  });

  it("keeps dates in the configured demo timeline", () => {
    expect(daysBetween("2026-08-09", DEMO_TODAY)).toBe(3);
  });

  it("only shows reliability after three resolved promises", () => {
    const state = createDemoState();
    expect(getReliability("client-pixel", state).enoughHistory).toBe(false);
    expect(getReliability("client-nova", state).enoughHistory).toBe(true);
  });

  it("interpolates editable follow-up message variables", () => {
    expect(interpolateMessage("Hi {{name}}, {{amount}} is due for {{title}} by {{date}}.", { name: "Arjun", amount: "₹15,000", title: "Brand film", date: "13 Aug" })).toBe("Hi Arjun, ₹15,000 is due for Brand film by 13 Aug.");
  });
});
