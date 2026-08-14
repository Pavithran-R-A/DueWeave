import type { FounderOffer } from "@/types/domain";

export type UpiPaymentConfiguration = {
  vpa: string;
  payeeName: string;
  amountPaise: number;
  note: string;
};

const FOUNDER_AMOUNT_PAISE = 49_900;
const VPA_PATTERN = /^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$/i;

function hasText(value: string | undefined, minLength = 1) {
  return Boolean(value && value.trim().length >= minLength);
}

export function buildUpiPaymentUri(configuration: UpiPaymentConfiguration): string {
  if (!VPA_PATTERN.test(configuration.vpa.trim())) return "";
  if (!hasText(configuration.payeeName) || !hasText(configuration.note) || !Number.isInteger(configuration.amountPaise) || configuration.amountPaise <= 0) return "";
  const parameters = new URLSearchParams({
    pa: configuration.vpa.trim(),
    pn: configuration.payeeName.trim(),
    am: (configuration.amountPaise / 100).toFixed(2),
    cu: "INR",
    tn: configuration.note.trim(),
  });
  return `upi://pay?${parameters.toString()}`;
}

export function isFounderPaymentDestinationReady(offer: FounderOffer): boolean {
  return offer.enabled
    && offer.paymentDestinationStatus === "LIVE"
    && offer.amountPaise === FOUNDER_AMOUNT_PAISE
    && Boolean(offer.upiId && VPA_PATTERN.test(offer.upiId.trim()))
    && hasText(offer.payeeName)
    && offer.supportContactStatus === "CONFIGURED"
    && hasText(offer.supportContact, 3)
    && offer.refundPolicyStatus === "APPROVED"
    && hasText(offer.refundPolicyText, 40)
    && offer.disclosuresStatus === "APPROVED";
}

export function buildFounderUpiPayload(offer: FounderOffer): string {
  if (!isFounderPaymentDestinationReady(offer) || !offer.upiId) return "";
  return buildUpiPaymentUri({ vpa: offer.upiId, payeeName: offer.payeeName, amountPaise: offer.amountPaise, note: "DueWeave Founder Lifetime" });
}
