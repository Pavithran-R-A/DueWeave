// Quiet Ledger style reminder: tests protect the explainable money story so UI polish cannot hide broken arithmetic or state transitions.

import { describe, expect, it } from "vitest";
import { createDemoState, DEMO_TODAY } from "@/data/demo";
import { daysBetween, formatINR, getOutstanding, getQueue, getReliability, interpolateMessage, priorityBreakdown } from "@/lib/finance";

describe("finance helpers", () => {
  it("formats paise as Indian rupee amounts", () => {
    expect(formatINR(1200000)).toBe("₹12,000");
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
