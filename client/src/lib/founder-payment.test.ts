import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { buildFounderUpiPayload, isFounderPaymentDestinationReady } from "./founder-payment";
import type { FounderOffer } from "@/types/domain";

const configuredOffer: FounderOffer = {
  amountPaise: 49_900,
  founderCap: 50,
  availableSpots: 49,
  payeeName: "DueWeave Test",
  upiId: "dueweave-test@upi",
  paymentDestinationStatus: "TEST",
  supportContact: "support@example.invalid",
  reviewWindowCopy: "Usually reviewed within 24 hours.",
  enabled: true,
};

describe("Founder UPI payment payload", () => {
  it("creates and decodes a QR with the exact configured ₹499.00 UPI payment data", async () => {
    const payload = buildFounderUpiPayload(configuredOffer);
    const parsed = new URL(payload);
    expect(parsed.protocol).toBe("upi:");
    expect(parsed.hostname).toBe("pay");
    expect(parsed.searchParams.get("pa")).toBe("dueweave-test@upi");
    expect(parsed.searchParams.get("pn")).toBe("DueWeave Test");
    expect(parsed.searchParams.get("am")).toBe("499.00");
    expect(parsed.searchParams.get("cu")).toBe("INR");
    expect(parsed.searchParams.get("tn")).toBe("DueWeave Founder Lifetime");

    const dataUrl = await QRCode.toDataURL(payload, { width: 280, margin: 1, color: { dark: "#162823", light: "#fbfaf5" } });
    const image = PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
    const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    expect(decoded?.data).toBe(payload);
  });

  it("does not expose a UPI intent while the server-controlled destination is a placeholder or disabled", () => {
    expect(isFounderPaymentDestinationReady({ ...configuredOffer, paymentDestinationStatus: "PLACEHOLDER" })).toBe(false);
    expect(buildFounderUpiPayload({ ...configuredOffer, paymentDestinationStatus: "PLACEHOLDER" })).toBe("");
    expect(isFounderPaymentDestinationReady({ ...configuredOffer, enabled: false })).toBe(false);
    expect(buildFounderUpiPayload({ ...configuredOffer, enabled: false })).toBe("");
  });
});
