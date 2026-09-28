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

/**
 * The sentence the support-contact column ships with as its default. It is long
 * enough to pass a length check and reaches no person, so it has to be named here:
 * `CONFIGURED` beside this string is a term still missing, not a term satisfied.
 * `tests/stage8-founder-contracts.test.ts` pins this literal against the copy in
 * the readiness function, so the two cannot disagree about what the default says.
 */
export const FOUNDER_SUPPORT_PLACEHOLDER = "Support contact not configured";

/**
 * Length after this engine's `String.prototype.trim()`. The database normalises with
 * the same character set written out explicitly, because a SQL whitespace class that
 * stops at ASCII would read a value the customer surface calls blank as configured.
 * `tests/stage8-founder-contracts.test.ts` pins both directions of that equality.
 */
function trimmedLength(value: string | undefined) {
  return value ? value.trim().length : 0;
}

/**
 * Missing prerequisites of the payment-readiness conjunction, in operator order.
 * Empty means ready. These twelve terms are the same twelve the database evaluates
 * in `public.founder_offer_payment_ready()` and refuses a claim with at call time,
 * which is what makes the customer boolean and the operator checklist unable to
 * disagree with the authority. `tests/stage8-founder-contracts.test.ts` pins the
 * term list, the VPA pattern text and the placeholder string across both sides, so
 * neither copy can drift into a different rule without a failing test.
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
  if (!isUsableSupportContact(offer.supportContact)) gaps.push("support-contact-unusable");
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
  "support-contact-unusable": "Public support contact is blank, too short to contact, or still the shipped placeholder sentence; an owner has to publish an address customers can use.",
  "refund-policy-pending": "Refund policy is not founder-approved.",
  "refund-policy-text-missing": "Refund policy has no published text.",
  "refund-policy-text-too-short": "Refund policy text is shorter than the reviewed minimum.",
  "disclosures-pending": "Consumer disclosures are not marked APPROVED.",
};

export function isUsableVpa(value: string | undefined): boolean {
  return Boolean(value && VPA_PATTERN.test(value.trim()));
}

/**
 * The support term, stated once. It is deliberately not an address-format check:
 * nothing in the product requires an email or a phone specifically, and the value
 * is rendered as plain text, so the only facts this side can settle are that
 * something was published and that what was published is not the shipped default.
 */
export function isUsableSupportContact(value: string | undefined): boolean {
  const trimmed = value ? value.trim() : "";
  return trimmed.length >= 3 && trimmed !== FOUNDER_SUPPORT_PLACEHOLDER;
}
