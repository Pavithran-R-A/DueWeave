# Founder payment readiness model

Stage 8. Written before the readiness code was changed, and kept as the
authority for what "PAYMENT-READY" means. Code: `client/src/lib/founder-readiness.ts`.
Database authority: the `founder_offer_config` checks, the destination gate
inside `create_founder_claim` and `submit_founder_payment`, and the reviewer
allowlist assertion made by each of the seven reviewer routines (pinned by
`supabase/tests/stage8_03_reviewer_boundaries.sql`).

## Configuration states

| Dimension | Column | States | Default in delivered local state |
| --- | --- | --- | --- |
| Offer enabled | `enabled` | true / false | true |
| Payment destination | `payment_destination_status` | `PLACEHOLDER` / `TEST` / `LIVE` | `PLACEHOLDER`, `upi_id` null |
| Support contact | `support_contact_status` | `PENDING` / `CONFIGURED` | `PENDING`, `support_contact` holds the literal "Support contact not configured" |
| Refund policy | `refund_policy_status` | `PENDING_APPROVAL` / `APPROVED` | `PENDING_APPROVAL`, `refund_policy_text` null |
| Disclosures | `disclosures_status` | `PENDING` / `APPROVED` | `PENDING` |
| Payee display name | `payee_name` | free text, non-empty | `DueWeave` |
| Review window copy | `review_window_copy` | free text | `Usually reviewed within 24 hours.` |
| Price | `amount_paise` | integer, single allowed value | `49900` (₹499.00 one-time) |

## PAYMENT-READY

True only when every term holds:

1. offer enabled
2. destination `LIVE`
3. `amount_paise = 49900`
4. non-empty, well-formed VPA
5. payee display name present
6. support status `CONFIGURED`
7. support contact present
8. refund policy `APPROVED`
9. refund policy text present
10. disclosures `APPROVED`

This is a conjunction, not a score. Missing any single term blocks the customer
payment surface, the UPI URI/QR payload, and the claim RPCs. `founderReadinessGaps()`
returns the missing terms in the order above so an operator can see which one is
left; `isFounderPaymentReady()` is the same list tested for emptiness. The
delivered row satisfies the enable and payee terms, so it reports six gaps.

Whether the page is payable is decided from the boolean alone. The only offer
fields the customer copy renders are the ones written for customers — the price,
the support and refund disclosure text, and the review-window line — and no VPA,
QR or UPI intent appears until the conjunction holds.

## Destination states

- `PLACEHOLDER` — nothing configured. `upi_id` must be null (DB check).
- `TEST` — synthetic destination for local fixtures only. Accepts a VPA so the
  URI builder can be exercised, and is refused by every customer claim RPC.
  Never used in the delivered row, never labelled live.
- `LIVE` — requires a VPA of 3–160 trimmed characters and a payee name.
  Reachable only by a trusted operator writing the table directly; no browser
  RPC, admin screen or one-click control changes this column.

A destination status outside this vocabulary fails closed: the repository maps
unknown values to `PLACEHOLDER`, and both the readiness conjunction and the RPC
gates refuse them.

## Price

49900 paise is the only approved amount, pinned by a DB check, by the RPC gate,
and by tests at the domain, URI and UI layers. Rupee text is derived with integer
arithmetic; there is no floating-point price authority, no discount, and no
coupon path.

## Opening UPI is not payment

`upi://pay?...` is an intent handed to the operating system. The app treats
invoking it, returning from it, a QR scan, a visibility change, a focus return,
or `window.location` changing as no evidence at all. None of them may:

- submit a claim
- mark anything paid
- approve a claim
- activate an entitlement
- write an approval audit event
- record a payment-success metric

Claim state moves only on an explicit customer UTR/reference submission, and
approval only on a reviewer action. Proof:
`supabase/tests/stage8_02_payment_evidence.sql` pins that only
`approve_founder_claim` and `reconsider_founder_claim` can write an approved
claim, `supabase/tests/stage8_03_reviewer_boundaries.sql` pins that both are
reviewer-allowlist routines, and the Stage 8 browser journeys intercept the
intent and then re-read claim, entitlement and audit state.

## Asymmetry to keep in mind

`approve_founder_claim` takes only the claim it decides on; the reviewer's
bank-history verification is stated by the action itself ("Approve after bank
check") and recorded as `manual_bank_review`. `reconsider_founder_claim`
additionally takes a required `p_bank_history_verified` boolean with no
default, so the review screen can only reach it through the explicit
"I independently verified this payment in business bank history" checkbox. The
database cannot tell an honest reviewer from a careless one; it can only refuse
a decision made by someone not on the allowlist, and it refuses a
reconsideration whose caller did not assert the recheck.

## Customer surface while not ready

With the delivered defaults the page shows "Payment instructions are being set
up." and "Do not send money yet." and renders no QR, no `Open UPI`, no
`Copy UPI link`, no payable VPA, and no working claim action.

## Live activation

Changing `FOUNDER_V1` to `LIVE` is an operator/database task, ordered by
`STAGE_4_2_OPERATOR_CONFIGURATION.md` and gated by the checklist in
`FOUNDER_LIVE_ACTIVATION_CHECKLIST.md`. This repository ships NOT READY.
