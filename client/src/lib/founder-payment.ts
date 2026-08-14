import type { FounderOffer } from "@/types/domain";

export function isFounderPaymentDestinationReady(offer: FounderOffer): boolean {
  return offer.enabled
    && offer.paymentDestinationStatus === "CONFIGURED"
    && Boolean(offer.upiId)
    && offer.supportContactStatus === "CONFIGURED"
    && offer.refundPolicyStatus === "APPROVED"
    && Boolean(offer.refundPolicyText);
}

export function buildFounderUpiPayload(offer: FounderOffer): string {
  if (!isFounderPaymentDestinationReady(offer) || !offer.upiId) return "";
  const parameters = new URLSearchParams({
    pa: offer.upiId,
    pn: offer.payeeName,
    am: (offer.amountPaise / 100).toFixed(2),
    cu: "INR",
    tn: "DueWeave Founder Lifetime",
  });
  return `upi://pay?${parameters.toString()}`;
}
