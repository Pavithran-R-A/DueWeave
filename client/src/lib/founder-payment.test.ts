import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { formatINR } from "./finance";
import {
  buildFounderUpiPayload,
  buildUpiPaymentUri,
} from "./founder-payment";
import { FOUNDER_PRICE_PAISE, isFounderPaymentReady } from "./founder-readiness";
import type { FounderOffer } from "@/types/domain";

// A synthetic, clearly-fake destination. Phase 12 allows it here and in local
// fixtures only: it is not a real VPA, and nothing in this file treats an
// encoded URI as proof that money moved.
const SYNTHETIC_VPA = "dueweave-test@upi";

const liveOffer: FounderOffer = {
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

// Exact paise -> rupee text, computed with integers only. This is the reference
// the production helper is measured against; it deliberately shares no code
// with it so a rounding bug on one side cannot agree with itself.
function exactRupees(paise: number) {
  const total = BigInt(paise);
  const whole = total / 100n;
  const fraction = total % 100n;
  return `${whole}.${fraction.toString().padStart(2, "0")}`;
}

function amountParameterOf(uri: string) {
  if (!uri) return null;
  return new URL(uri).searchParams.get("am");
}

describe("Founder price contract", () => {
  it("pins the canonical price to 49900 paise everywhere the customer sees it", () => {
    expect(FOUNDER_PRICE_PAISE).toBe(49_900);
    expect(liveOffer.amountPaise).toBe(FOUNDER_PRICE_PAISE);
    expect(formatINR(FOUNDER_PRICE_PAISE)).toBe("₹499");
    expect(amountParameterOf(buildFounderUpiPayload(liveOffer))).toBe("499.00");
  });

  it("refuses to encode an amount that a number cannot carry exactly instead of emitting a different price", () => {
    // 45035996273704960 is representable as a double but is above
    // Number.MAX_SAFE_INTEGER, so `/100` and `toFixed(2)` round it to a rupee
    // value nobody asked for. A payment URI must never guess.
    const unsafe = 45_035_996_273_704_960;
    expect(Number.isSafeInteger(unsafe)).toBe(false);
    expect(buildUpiPaymentUri({ vpa: SYNTHETIC_VPA, payeeName: "DueWeave Test", amountPaise: unsafe, note: "Founder Lifetime" })).toBe("");
  });

  it("converts every safe paise value to the exact rupee amount, with no floating-point drift", () => {
    const samples = [
      1, 9, 10, 99, 100, 101, 499, 500, 49_900, 49_999, 50_000, 999_999,
      1_000_000, 12_345_678_901_234, 33_333_333, 88_888_888,
      Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER - 99,
    ];
    for (const paise of samples) {
      const uri = buildUpiPaymentUri({ vpa: SYNTHETIC_VPA, payeeName: "DueWeave Test", amountPaise: paise, note: "Founder Lifetime" });
      expect(uri, `paise ${paise} produced no URI`).not.toBe("");
      expect(amountParameterOf(uri), `paise ${paise}`).toBe(exactRupees(paise));
    }
  });

  it("refuses a non-integer, zero, negative or NaN amount", () => {
    for (const amountPaise of [0, -49_900, 49_900.5, Number.NaN]) {
      expect(buildUpiPaymentUri({ vpa: SYNTHETIC_VPA, payeeName: "DueWeave Test", amountPaise, note: "Founder Lifetime" }), `amount ${amountPaise}`).toBe("");
    }
  });
});

describe("UPI payment URI truth", () => {
  it("builds a upi://pay intent carrying exactly pa, pn, am, cu and tn", () => {
    const payload = buildUpiPaymentUri({ vpa: SYNTHETIC_VPA, payeeName: "DueWeave TEST fixture", amountPaise: 49_900, note: "DueWeave Founder Lifetime / TEST" });
    const parsed = new URL(payload);
    expect(parsed.protocol).toBe("upi:");
    expect(parsed.hostname).toBe("pay");
    expect(parsed.searchParams.get("pa")).toBe(SYNTHETIC_VPA);
    expect(parsed.searchParams.get("pn")).toBe("DueWeave TEST fixture");
    expect(parsed.searchParams.get("am")).toBe("499.00");
    expect(parsed.searchParams.get("cu")).toBe("INR");
    expect(parsed.searchParams.get("tn")).toBe("DueWeave Founder Lifetime / TEST");
  });

  it("percent-encodes payee and note so a separator cannot inject another parameter", () => {
    const payload = buildUpiPaymentUri({ vpa: SYNTHETIC_VPA, payeeName: "A & B Ltd?pn=victim", amountPaise: 49_900, note: "Founder&am=1 Lifetime" });
    expect(payload).not.toContain("&pn=victim&");
    expect(payload).not.toContain("&am=1&");
    const parsed = new URL(payload);
    expect(parsed.searchParams.getAll("pn")).toEqual(["A & B Ltd?pn=victim"]);
    expect(parsed.searchParams.getAll("am")).toEqual(["499.00"]);
    expect(parsed.searchParams.getAll("tn")).toEqual(["Founder&am=1 Lifetime"]);
  });

  it("trims surrounding space but refuses a blank payee, blank note or malformed VPA", () => {
    expect(buildUpiPaymentUri({ vpa: `  ${SYNTHETIC_VPA}  `, payeeName: "  DueWeave Test  ", amountPaise: 49_900, note: "  Founder Lifetime  " })).toContain("pa=dueweave-test%40upi");
    expect(buildUpiPaymentUri({ vpa: SYNTHETIC_VPA, payeeName: "   ", amountPaise: 49_900, note: "Founder Lifetime" })).toBe("");
    expect(buildUpiPaymentUri({ vpa: SYNTHETIC_VPA, payeeName: "DueWeave Test", amountPaise: 49_900, note: "   " })).toBe("");
    for (const vpa of ["", "   ", "no-at-sign", "@upi", "dueweave@", "a@b", "due weave@upi"]) {
      expect(buildUpiPaymentUri({ vpa, payeeName: "DueWeave Test", amountPaise: 49_900, note: "Founder Lifetime" }), `vpa ${vpa}`).toBe("");
    }
  });
});

describe("payment readiness is a conjunction, not a collection of flags", () => {
  // The fully-ready fixture is the only starting point; each row breaks exactly
  // one precondition, so a pass proves that single term is load-bearing.
  const cases: Array<[string, FounderOffer]> = [
    ["offer disabled", { ...liveOffer, enabled: false }],
    ["destination still PLACEHOLDER", { ...liveOffer, paymentDestinationStatus: "PLACEHOLDER", upiId: undefined }],
    ["destination in synthetic TEST mode", { ...liveOffer, paymentDestinationStatus: "TEST" }],
    ["price is not the canonical amount", { ...liveOffer, amountPaise: 49_901 }],
    ["VPA missing entirely", { ...liveOffer, upiId: undefined }],
    ["VPA blank after trimming", { ...liveOffer, upiId: "   " }],
    ["VPA malformed", { ...liveOffer, upiId: "not a vpa" }],
    ["payee name missing", { ...liveOffer, payeeName: "   " }],
    ["support still pending", { ...liveOffer, supportContactStatus: "PENDING" }],
    ["support contact too short to use", { ...liveOffer, supportContact: "ab" }],
    ["refund policy awaiting approval", { ...liveOffer, refundPolicyStatus: "PENDING_APPROVAL" }],
    ["refund policy approved without text", { ...liveOffer, refundPolicyText: undefined }],
    ["refund text shorter than the stored minimum", { ...liveOffer, refundPolicyText: "Refunds on request." }],
    ["disclosures not approved", { ...liveOffer, disclosuresStatus: "PENDING" }],
  ];

  it("accepts only the complete conjunction", () => {
    expect(isFounderPaymentReady(liveOffer)).toBe(true);
    expect(buildFounderUpiPayload(liveOffer)).toContain(`pa=${encodeURIComponent(SYNTHETIC_VPA)}`);
  });

  for (const [label, offer] of cases) {
    it(`blocks the payment action when ${label}`, () => {
      expect(isFounderPaymentReady(offer)).toBe(false);
      expect(buildFounderUpiPayload(offer)).toBe("");
    });
  }

  it("keeps an unknown destination status fail-closed rather than assuming it is live", () => {
    expect(isFounderPaymentReady({ ...liveOffer, paymentDestinationStatus: "CONFIGURED" as FounderOffer["paymentDestinationStatus"] })).toBe(false);
    expect(buildFounderUpiPayload({ ...liveOffer, paymentDestinationStatus: "CONFIGURED" as FounderOffer["paymentDestinationStatus"] })).toBe("");
  });
});

describe("synthetic TEST mode never reaches a customer", () => {
  it("lets the URI helper produce a correct intent for a synthetic destination", () => {
    const payload = buildUpiPaymentUri({ vpa: SYNTHETIC_VPA, payeeName: "DueWeave Test", amountPaise: 49_900, note: "DueWeave Founder Lifetime" });
    expect(payload).toContain("am=499.00");
    expect(payload).toContain("cu=INR");
  });

  it("refuses the customer payment surface for TEST and for PLACEHOLDER alike", () => {
    for (const status of ["TEST", "PLACEHOLDER"] as const) {
      const offer = { ...liveOffer, paymentDestinationStatus: status };
      expect(isFounderPaymentReady(offer), status).toBe(false);
      expect(buildFounderUpiPayload(offer), status).toBe("");
    }
  });

  it("never stores or emits the synthetic VPA from a delivered placeholder offer", () => {
    const placeholder: FounderOffer = { ...liveOffer, paymentDestinationStatus: "PLACEHOLDER", upiId: undefined };
    expect(buildFounderUpiPayload(placeholder)).toBe("");
    expect(buildFounderUpiPayload(placeholder)).not.toContain(SYNTHETIC_VPA);
  });
});

describe("Founder QR payload", () => {
  it("encodes and decodes the same UPI URI the payment button would open", async () => {
    const payload = buildFounderUpiPayload(liveOffer);
    const dataUrl = await QRCode.toDataURL(payload, { width: 280, margin: 1, color: { dark: "#162823", light: "#fbfaf5" } });
    const image = PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
    const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    expect(decoded?.data).toBe(payload);

    const parsed = new URL(decoded?.data ?? "");
    expect(parsed.searchParams.get("pa")).toBe(SYNTHETIC_VPA);
    expect(parsed.searchParams.get("pn")).toBe("DueWeave Test");
    expect(parsed.searchParams.get("am")).toBe("499.00");
    expect(parsed.searchParams.get("cu")).toBe("INR");
    expect(parsed.searchParams.get("tn")).toBe("DueWeave Founder Lifetime");
  });

  it("renders no QR payload at all while the destination is not ready", async () => {
    const payload = buildFounderUpiPayload({ ...liveOffer, paymentDestinationStatus: "PLACEHOLDER", upiId: undefined });
    expect(payload).toBe("");
    // The page only rasterises a non-empty payload; an empty one must not be
    // turned into a scannable "pay nothing" code.
    await expect(QRCode.toDataURL(payload)).rejects.toThrow();
  });
});
