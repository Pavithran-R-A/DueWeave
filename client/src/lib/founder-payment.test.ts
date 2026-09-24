import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { buildFounderUpiPayload, buildUpiPaymentUri, isFounderPaymentDestinationReady } from "./founder-payment";
import type { FounderOffer } from "@/types/domain";

const liveOffer: FounderOffer = {
  amountPaise: 49_900,
  founderCap: 50,
  availableSpots: 49,
  payeeName: "DueWeave Test",
  upiId: "dueweave-test@upi",
  paymentDestinationStatus: "LIVE",
  supportContact: "support@example.invalid",
  supportContactStatus: "CONFIGURED",
  refundPolicyStatus: "APPROVED",
  refundPolicyText: "Founder purchases may be refunded on request within seven days of activation when paid features have not been materially used.",
  disclosuresStatus: "APPROVED",
  reviewWindowCopy: "Usually reviewed within 24 hours.",
  enabled: true,
};

describe("Founder UPI payment payload", () => {
  it("creates and decodes a QR with the exact configured ₹499.00 UPI payment data", async () => {
    const payload = buildUpiPaymentUri({ vpa: "dueweave-test@upi", payeeName: "DueWeave TEST fixture", amountPaise: 49_900, note: "DueWeave Founder Lifetime / TEST" });
    const parsed = new URL(payload);
    expect(parsed.protocol).toBe("upi:");
    expect(parsed.hostname).toBe("pay");
    expect(parsed.searchParams.get("pa")).toBe("dueweave-test@upi");
    expect(parsed.searchParams.get("pn")).toBe("DueWeave TEST fixture");
    expect(parsed.searchParams.get("am")).toBe("499.00");
    expect(parsed.searchParams.get("cu")).toBe("INR");
    expect(parsed.searchParams.get("tn")).toBe("DueWeave Founder Lifetime / TEST");

    const dataUrl = await QRCode.toDataURL(payload, { width: 280, margin: 1, color: { dark: "#162823", light: "#fbfaf5" } });
    const image = PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
    const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    expect(decoded?.data).toBe(payload);
  });

  it("does not expose a UPI intent while the server-controlled destination is a placeholder or disabled", () => {
    expect(isFounderPaymentDestinationReady(liveOffer)).toBe(true);
    expect(buildFounderUpiPayload(liveOffer)).toContain("pa=dueweave-test%40upi");
    expect(isFounderPaymentDestinationReady({ ...liveOffer, paymentDestinationStatus: "TEST" })).toBe(false);
    expect(isFounderPaymentDestinationReady({ ...liveOffer, paymentDestinationStatus: "PLACEHOLDER" })).toBe(false);
    expect(buildFounderUpiPayload({ ...liveOffer, paymentDestinationStatus: "PLACEHOLDER" })).toBe("");
    expect(isFounderPaymentDestinationReady({ ...liveOffer, supportContactStatus: "PENDING" })).toBe(false);
    expect(isFounderPaymentDestinationReady({ ...liveOffer, refundPolicyStatus: "PENDING_APPROVAL", refundPolicyText: undefined })).toBe(false);
    expect(isFounderPaymentDestinationReady({ ...liveOffer, disclosuresStatus: "PENDING" })).toBe(false);
    expect(isFounderPaymentDestinationReady({ ...liveOffer, enabled: false })).toBe(false);
    expect(buildFounderUpiPayload({ ...liveOffer, enabled: false })).toBe("");
  });
});
