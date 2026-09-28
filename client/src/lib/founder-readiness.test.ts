import { describe, expect, it } from "vitest";
import { buildFounderUpiPayload } from "./founder-payment";
import {
  FOUNDER_PRICE_PAISE,
  FOUNDER_READINESS_GAP_COPY,
  founderReadinessGaps,
  isFounderPaymentReady,
  isUsableVpa,
} from "./founder-readiness";
import type { FounderOffer } from "@/types/domain";

const SYNTHETIC_VPA = "dueweave-test@upi";

const readyOffer: FounderOffer = {
  amountPaise: 49_900,
  founderCap: 50,
  availableSpots: 49,
  payeeName: "DueWeave Test",
  upiId: SYNTHETIC_VPA,
  paymentDestinationStatus: "LIVE",
  supportContact: "support@example.invalid",
  supportContactStatus: "CONFIGURED",
  refundPolicyStatus: "APPROVED",
  refundPolicyText: "Founder purchases may be refunded on request within seven days of activation when paid features have not been materially used.",
  disclosuresStatus: "APPROVED",
  reviewWindowCopy: "Usually reviewed within 24 hours.",
  enabled: true,
};

// Exactly what `get_founder_offer()` returns against the delivered database row
// (PHASE 4 inventory): the offer is enabled and correctly priced, but the
// destination, support contact, refund policy and disclosures are all unset.
const deliveredOffer: FounderOffer = {
  amountPaise: FOUNDER_PRICE_PAISE,
  founderCap: 50,
  availableSpots: 50,
  payeeName: "DueWeave",
  upiId: undefined,
  paymentDestinationStatus: "PLACEHOLDER",
  supportContact: "",
  supportContactStatus: "PENDING",
  refundPolicyStatus: "PENDING_APPROVAL",
  refundPolicyText: undefined,
  disclosuresStatus: "PENDING",
  reviewWindowCopy: "Most claims are reviewed within one business day.",
  enabled: true,
};

describe("Founder readiness is one written-down conjunction", () => {
  it("reports no gap for a fully configured offer", () => {
    expect(founderReadinessGaps(readyOffer)).toEqual([]);
    expect(isFounderPaymentReady(readyOffer)).toBe(true);
  });

  // Each row changes exactly one stored field from the ready offer, so the
  // reported gap set proves that single term is load-bearing.
  const cases: Array<[string, FounderOffer, string[]]> = [
    ["offer disabled", { ...readyOffer, enabled: false }, ["offer-disabled"]],
    ["destination still PLACEHOLDER", { ...readyOffer, paymentDestinationStatus: "PLACEHOLDER" }, ["destination-not-live"]],
    ["destination in synthetic TEST mode", { ...readyOffer, paymentDestinationStatus: "TEST" }, ["destination-not-live"]],
    ["destination status outside the vocabulary", { ...readyOffer, paymentDestinationStatus: "CONFIGURED" as FounderOffer["paymentDestinationStatus"] }, ["destination-not-live"]],
    ["price is not the canonical amount", { ...readyOffer, amountPaise: 49_901 }, ["price-not-canonical"]],
    ["price arrived unparseable", { ...readyOffer, amountPaise: 0 }, ["price-not-canonical"]],
    ["VPA missing", { ...readyOffer, upiId: undefined }, ["vpa-missing"]],
    ["VPA blank after trimming", { ...readyOffer, upiId: "   " }, ["vpa-missing"]],
    ["VPA malformed", { ...readyOffer, upiId: "not a vpa" }, ["vpa-malformed"]],
    ["payee name missing", { ...readyOffer, payeeName: "  " }, ["payee-missing"]],
    ["support status pending", { ...readyOffer, supportContactStatus: "PENDING" }, ["support-pending"]],
    ["support address unusable", { ...readyOffer, supportContact: "ab" }, ["support-contact-unusable"]],
    ["refund policy awaiting approval", { ...readyOffer, refundPolicyStatus: "PENDING_APPROVAL" }, ["refund-policy-pending"]],
    ["refund policy approved without text", { ...readyOffer, refundPolicyText: undefined }, ["refund-policy-text-missing"]],
    ["refund text shorter than the reviewed minimum", { ...readyOffer, refundPolicyText: "Refunds on request." }, ["refund-policy-text-too-short"]],
    ["disclosures not approved", { ...readyOffer, disclosuresStatus: "PENDING" }, ["disclosures-pending"]],
    // The delivered row fails four gates at once; the destination and support
    // fields are blank for the same reason, so the pair is expected together.
    ["support address blank though status says CONFIGURED", { ...readyOffer, supportContact: "" }, ["support-contact-unusable"]],
  ];

  for (const [label, offer, expected] of cases) {
    it(`names ${expected.join(" and ")} when ${label}`, () => {
      expect(founderReadinessGaps(offer)).toEqual(expected);
      expect(isFounderPaymentReady(offer)).toBe(false);
    });
  }

  it("lists the delivered repository default as NOT READY, never an accidental pass", () => {
    expect(founderReadinessGaps(deliveredOffer)).toEqual([
      "destination-not-live",
      "vpa-missing",
      "support-pending",
      "support-contact-unusable",
      "refund-policy-pending",
      "refund-policy-text-missing",
      "disclosures-pending",
    ]);
    expect(isFounderPaymentReady(deliveredOffer)).toBe(false);
    expect(buildFounderUpiPayload(deliveredOffer)).toBe("");
  });

  it("reports every gap category the operator runbook has to clear", () => {
    const categories = new Set(founderReadinessGaps({
      ...deliveredOffer,
      amountPaise: 1,
      payeeName: "",
      refundPolicyText: "short",
      refundPolicyStatus: "PENDING_APPROVAL",
      enabled: false,
    }).map((gap) => gap.split("-")[0]));
    // destination, price, payee (vpa/payee), support, refund, disclosures — the
    // six prerequisites the brief requires the diagnostics to enumerate.
    expect([...categories].sort()).toEqual(["destination", "disclosures", "offer", "payee", "price", "refund", "support", "vpa"]);
  });

  it("gives every gap operator copy that names no stored value", () => {
    const gaps = founderReadinessGaps({ ...deliveredOffer, upiId: "leak-me@upi", supportContact: "leak-me@example.invalid", refundPolicyText: "leaked refund wording" });
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      const copy = FOUNDER_READINESS_GAP_COPY[gap];
      expect(copy, gap).toBeTruthy();
      expect(copy).not.toContain("leak-me@upi");
      expect(copy).not.toContain("leak-me@example.invalid");
      expect(copy).not.toContain("leaked refund wording");
    }
  });

  it("agrees with the customer payment surface for every offer shape", () => {
    const shapes: FounderOffer[] = [
      readyOffer,
      deliveredOffer,
      ...cases.map(([, offer]) => offer),
      { ...readyOffer, paymentDestinationStatus: "TEST", amountPaise: 1, upiId: undefined, enabled: false },
    ];
    for (const offer of shapes) {
      // The URI helper is the only thing the pay button and QR are built from,
      // so a payload can exist if and only if the readiness list is empty.
      const hasGap = founderReadinessGaps(offer).length > 0;
      expect(hasGap, JSON.stringify(offer)).toBe(!isFounderPaymentReady(offer));
      if (hasGap) expect(buildFounderUpiPayload(offer)).toBe("");
    }
    expect(buildFounderUpiPayload(readyOffer)).toContain("am=499.00");
  });
});

describe("VPA shape validation", () => {
  it("accepts a well-formed address and ignores surrounding space", () => {
    expect(isUsableVpa("dueweave-test@upi")).toBe(true);
    expect(isUsableVpa("  synthetic-merchant@dueweave.invalid  ")).toBe(true);
  });

  it("refuses missing, blank and structurally broken addresses", () => {
    for (const value of [undefined, "", "   ", "no-at-sign", "@upi", "merchant@", "a@b", "two @ signs@upi", "spaced handle@upi"]) {
      expect(isUsableVpa(value), String(value)).toBe(false);
    }
  });
});
