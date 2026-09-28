import type { FounderOffer } from "@/types/domain";

export const FOUNDER_PRICE_PAISE = 49_900;

export type FounderReadinessGap =
  | "offer-disabled"
  | "destination-not-live"
  | "price-not-canonical"
  | "vpa-missing"
  | "vpa-malformed"
  | "payee-missing"
  | "support-pending"
  | "support-contact-unusable"
  | "refund-policy-pending"
  | "refund-policy-text-missing"
  | "refund-policy-text-too-short"
  | "disclosures-pending";

const VPA_PATTERN = /^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$/i;

const REFUND_POLICY_MINIMUM = 40;

function trimmedLength(value: string | undefined) {
  return value ? value.trim().length : 0;
}

/**
 * Missing prerequisites of the payment-readiness conjunction, in operator order.
 * Empty means ready. This is the only place the conjunction is written down, so
 * the customer boolean and the operator checklist cannot disagree. The database
 * re-checks every term inside the claim RPCs and stays authoritative.
 */
export function founderReadinessGaps(offer: FounderOffer): FounderReadinessGap[] {
  const gaps: FounderReadinessGap[] = [];
  if (!offer.enabled) gaps.push("offer-disabled");
  if (offer.paymentDestinationStatus !== "LIVE") gaps.push("destination-not-live");
  if (offer.amountPaise !== FOUNDER_PRICE_PAISE) gaps.push("price-not-canonical");
  if (trimmedLength(offer.upiId) === 0) gaps.push("vpa-missing");
  else if (!VPA_PATTERN.test(offer.upiId!.trim())) gaps.push("vpa-malformed");
  if (trimmedLength(offer.payeeName) === 0) gaps.push("payee-missing");
  if (offer.supportContactStatus !== "CONFIGURED") gaps.push("support-pending");
  if (trimmedLength(offer.supportContact) < 3) gaps.push("support-contact-unusable");
  if (offer.refundPolicyStatus !== "APPROVED") gaps.push("refund-policy-pending");
  if (trimmedLength(offer.refundPolicyText) === 0) gaps.push("refund-policy-text-missing");
  else if (trimmedLength(offer.refundPolicyText) < REFUND_POLICY_MINIMUM) gaps.push("refund-policy-text-too-short");
  if (offer.disclosuresStatus !== "APPROVED") gaps.push("disclosures-pending");
  return gaps;
}

export function isFounderPaymentReady(offer: FounderOffer): boolean {
  return founderReadinessGaps(offer).length === 0;
}

/**
 * Operator-facing wording for each gap, used by the live-activation checklist.
 * It names the prerequisite and who clears it, and deliberately never repeats a
 * stored value (support address, VPA, refund text) so a screenshot of the
 * checklist cannot leak configuration the customer surface must not show.
 */
export const FOUNDER_READINESS_GAP_COPY: Record<FounderReadinessGap, string> = {
  "offer-disabled": "Founder offer is disabled. An owner must enable it.",
  "destination-not-live": "Payment destination is not marked LIVE, so no payment instructions may be shown.",
  "price-not-canonical": "Offer price is not the approved 49900 paise authority.",
  "vpa-missing": "No UPI VPA is configured for the destination.",
  "vpa-malformed": "The configured VPA is not a parseable UPI address; verify it independently against the business bank account.",
  "payee-missing": "No payee display name is configured; verify it independently against the bank statement name.",
  "support-pending": "Public support contact is not marked CONFIGURED.",
  "support-contact-unusable": "Public support contact is present but too short to contact.",
  "refund-policy-pending": "Refund policy is not founder-approved.",
  "refund-policy-text-missing": "Refund policy has no published text.",
  "refund-policy-text-too-short": "Refund policy text is shorter than the reviewed minimum.",
  "disclosures-pending": "Consumer disclosures are not marked APPROVED.",
};

export function isUsableVpa(value: string | undefined): boolean {
  return Boolean(value && VPA_PATTERN.test(value.trim()));
}
