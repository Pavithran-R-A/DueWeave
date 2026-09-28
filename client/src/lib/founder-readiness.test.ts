import { describe, expect, it } from "vitest";
import { buildFounderUpiPayload } from "./founder-payment";
import {
  FOUNDER_PRICE_PAISE,
  FOUNDER_READINESS_GAP_COPY,
  FOUNDER_SUPPORT_PLACEHOLDER,
  founderReadinessGaps,
  isFounderPaymentReady,
  isUsableSupportContact,
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
// (PHASE 4 inventory, re-read for the parity repair): the offer is enabled and
// correctly priced, the destination and refund text and disclosures are unset, and
// `support_contact` holds the column default sentence rather than an address. Every
// field below is the stored value, not a stand-in for it.
const deliveredOffer: FounderOffer = {
  amountPaise: FOUNDER_PRICE_PAISE,
  founderCap: 50,
  availableSpots: 50,
  payeeName: "DueWeave",
  upiId: undefined,
  paymentDestinationStatus: "PLACEHOLDER",
  supportContact: FOUNDER_SUPPORT_PLACEHOLDER,
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

  it("reports no gap when a complete offer is padded with characters this engine trims", () => {
    const padded = {
      ...readyOffer,
      upiId: `\u00A0${readyOffer.upiId}\u00A0`,
      payeeName: `\u3000${readyOffer.payeeName}\u2000`,
      supportContact: `\uFEFF${readyOffer.supportContact}\u2028`,
    };
    expect(founderReadinessGaps(padded)).toEqual([]);
    expect(isFounderPaymentReady(padded)).toBe(true);
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
    ["support address is only whitespace", { ...readyOffer, supportContact: " \t " }, ["support-contact-unusable"]],
    // D-S8-6: the sentence the column ships with is thirty characters long, so a
    // length rule accepted it as a contact address the moment the status flipped.
    ["support address is the shipped placeholder", { ...readyOffer, supportContact: FOUNDER_SUPPORT_PLACEHOLDER }, ["support-contact-unusable"]],
    ["support address is the padded placeholder", { ...readyOffer, supportContact: `  ${FOUNDER_SUPPORT_PLACEHOLDER}  ` }, ["support-contact-unusable"]],
    // The blank-detection rule is "blank to this engine", not "blank to a SQL
    // whitespace class". A value of nothing but non-breaking spaces has to report the
    // same gap, because the database now normalises with this same set of characters.
    ["support address is five non-breaking spaces", { ...readyOffer, supportContact: "\u00A0\u00A0\u00A0\u00A0\u00A0" }, ["support-contact-unusable"]],
    ["payee name is ideographic spaces", { ...readyOffer, payeeName: "\u3000\u3000" }, ["payee-missing"]],
    ["refund text is only non-breaking spaces", { ...readyOffer, refundPolicyText: "\u00A0".repeat(40) }, ["refund-policy-text-missing"]],
    // And not one character further: U+200B is not whitespace to JavaScript, so an
    // address carrying it is malformed rather than blank, exactly as the database
    // reads it. tests/stage8-founder-contracts.test.ts pins the two classes together.
    ["VPA carries a zero-width space", { ...readyOffer, upiId: "\u200Bdueweave-test@upi" }, ["vpa-malformed"]],
    ["refund policy awaiting approval", { ...readyOffer, refundPolicyStatus: "PENDING_APPROVAL" }, ["refund-policy-pending"]],
    ["refund policy approved without text", { ...readyOffer, refundPolicyText: undefined }, ["refund-policy-text-missing"]],
    ["refund text shorter than the reviewed minimum", { ...readyOffer, refundPolicyText: "Refunds on request." }, ["refund-policy-text-too-short"]],
    ["disclosures not approved", { ...readyOffer, disclosuresStatus: "PENDING" }, ["disclosures-pending"]],
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
    // Every character this engine trims counts as padding, not as part of the address.
    expect(isUsableVpa("\u00A0dueweave-test@upi\u00A0"), "non-breaking space").toBe(true);
    expect(isUsableVpa("\u3000dueweave-test@upi\u2000"), "ideographic and en quad").toBe(true);
    expect(isUsableVpa("\uFEFFdueweave-test@upi\u2028"), "byte-order mark and line separator").toBe(true);
  });

  it("refuses missing, blank and structurally broken addresses", () => {
    for (const value of [undefined, "", "   ", "\u00A0\u00A0\u00A0", "no-at-sign", "@upi", "merchant@", "a@b", "two @ signs@upi", "spaced handle@upi", "\u200Bdueweave-test@upi"]) {
      expect(isUsableVpa(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe("Support contact usability", () => {
  // The term asks one question: did a person publish something a customer could use?
  // It deliberately does not ask what kind of contact that is, because nothing in the
  // product contract requires an email specifically and the value is rendered as text.
  it("accepts whatever an owner publishes, in any contact form", () => {
    for (const value of ["support@example.invalid", "+91 98765 43210", "DueWeave on X", "ask us from the profile page", "\u00A0ask us from the profile page\u3000"]) {
      expect(isUsableSupportContact(value), JSON.stringify(value)).toBe(true);
    }
  });

  it("refuses blank, whitespace-only, too short, and the sentence the column ships with", () => {
    for (const value of [undefined, "", " \t\n ", "\u00A0\u00A0\u00A0", "\u2028\u2029\u202F", "ab", FOUNDER_SUPPORT_PLACEHOLDER, `  ${FOUNDER_SUPPORT_PLACEHOLDER}\t`]) {
      expect(isUsableSupportContact(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("keeps the customer copy gate and the readiness term answering the same way", () => {
    for (const value of ["support@example.invalid", FOUNDER_SUPPORT_PLACEHOLDER, "", "ab", "  padded contact  "]) {
      const offer = { ...readyOffer, supportContact: value };
      expect(founderReadinessGaps(offer).includes("support-contact-unusable"), JSON.stringify(value))
        .toBe(!isUsableSupportContact(value));
    }
  });
});
