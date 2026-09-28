import type { FounderOffer } from "@/types/domain";
import { isFounderPaymentReady, isUsableVpa } from "./founder-readiness";

export type UpiPaymentConfiguration = {
  vpa: string;
  payeeName: string;
  amountPaise: number;
  note: string;
};

function hasText(value: string | undefined, minLength = 1) {
  return Boolean(value && value.trim().length >= minLength);
}

// Integer-only paise → rupees: `(paise / 100).toFixed(2)` drifts on large safe
// integers, and a payment URI must never guess the amount.
const PAISE_PER_RUPEE = BigInt(100);

function rupeeAmountText(paise: number) {
  const total = BigInt(paise);
  return `${total / PAISE_PER_RUPEE}.${(total % PAISE_PER_RUPEE).toString().padStart(2, "0")}`;
}

export function buildUpiPaymentUri(configuration: UpiPaymentConfiguration): string {
  if (!isUsableVpa(configuration.vpa)) return "";
  if (!hasText(configuration.payeeName) || !hasText(configuration.note)) return "";
  if (!Number.isSafeInteger(configuration.amountPaise) || configuration.amountPaise <= 0) return "";
  const parameters = new URLSearchParams({
    pa: configuration.vpa.trim(),
    pn: configuration.payeeName.trim(),
    am: rupeeAmountText(configuration.amountPaise),
    cu: "INR",
    tn: configuration.note.trim(),
  });
  return `upi://pay?${parameters.toString()}`;
}

export function buildFounderUpiPayload(offer: FounderOffer): string {
  if (!isFounderPaymentReady(offer) || !offer.upiId) return "";
  return buildUpiPaymentUri({ vpa: offer.upiId, payeeName: offer.payeeName, amountPaise: offer.amountPaise, note: "DueWeave Founder Lifetime" });
}
