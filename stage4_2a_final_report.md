# DueWeave Stage 4.2A Payment Infrastructure Final Report

**Date:** 14 August 2026  
**Branch:** `stage-4-2-operator-readiness`  
**Scope:** Stage 4.2A only — reusable payment infrastructure under a permanently non-live Founder offer.  
**Verdict:** **PASS — engineering readiness achieved; payment activation is intentionally blocked.**

> **Release boundary.** Stage 4.2A did not configure a merchant destination, trusted operator, public support address, approved refund policy, payment gateway, or live collection surface. It did not transfer money, accept a payment, deploy publicly, or begin Stage 4.2B or Stage 5.

## Executive result

DueWeave now has a reusable UPI payload, QR, and generic mobile-intent implementation, together with a database-enforced **live-only** payment guard. The deployed offer remains `PLACEHOLDER`: it has no UPI destination, no configured reviewer, no active Founder entitlement, and no payable customer action. A future real payment configuration must satisfy the complete server-side readiness contract and transition to an explicit `LIVE` status; neither `PLACEHOLDER` nor `TEST` can activate payment actions or Founder-claim creation. [1] [2]

| Area | Stage 4.2A result | Evidence |
|---|---|---|
| Live offer | `PLACEHOLDER`; UPI destination absent; Founder cap restored to 50 | Final bounded Supabase verification |
| Real money | **₹0 collected or transferred** | No live destination, no operator, zero approved claims and zero active Founder entitlements after fixture cleanup |
| Trusted operator | **None configured** | `founder_admins` count is zero after disposal cleanup |
| Payment gate | **Fail closed** | Only a complete future `LIVE` offer can create a Founder claim or display payment actions |
| Test payment data | Isolated from the live offer | Unit fixture only; never committed to `founder_offer_config` as a merchant destination |
| Services | No payment gateway, paid API, paid SMTP, or paid service added | Static Vite + Supabase Free architecture retained |

## Implemented payment infrastructure

The client payment helper now produces a canonical UPI URI with integer paise converted exactly to INR decimal text, generates a QR value from that URI, and exposes a generic platform-neutral mobile intent. Independent tests decode the generated test-fixture QR payload and verify payee, VPA, ₹499.00 amount, and transaction note. The fixture is deliberately non-production and does not represent a configured merchant destination. [3]

The new migration, `20260814110000_stage4_2a_live_payment_gate.sql`, establishes the server-side non-negotiable rule. The payment destination status is constrained to `PLACEHOLDER`, `TEST`, or `LIVE`; `create_founder_claim` rejects every status other than `LIVE` and additionally requires a valid VPA, payee, exact ₹499.00 offer amount, support contact, approved refund terms, and required disclosure text. The frontend independently applies the same readiness model only to suppress unsafe controls; the database remains the enforcement boundary. [1]

| Customer-facing state | QR / copy / intent | Claim form or submission | Interpretation |
|---|---|---|---|
| `PLACEHOLDER` | Hidden and disabled | Hidden and blocked | Do not send money yet |
| `TEST` | Hidden and disabled | Hidden and blocked | Test data never unlocks collection |
| Future complete `LIVE` | Available only after all checks | Available only after all checks | Requires a separate Stage 4.2B authorization |

## Truthful purchase, support, and refund disclosures

The Founder surface gives clear non-payable placeholder messaging, keeps payment controls absent rather than merely cosmetically disabled, and avoids fabricated support or refund promises. The new offer fields remain configurable only through the protected administrative data model. Until a founder supplies and approves the necessary private business inputs in a later task, the page uses safe setup-state copy and does not show a support address or refund promise as active terms. [2] [4]

The existing restricted Founder-admin review workflow remains server-controlled. Ordinary users cannot grant themselves reviewer access, read the review funnel, approve or reject claims, revoke entitlements, reconsider claims, or bypass the Founder limit. No client-editable administrative flag, browser UUID field, self-enrollment mechanism, secret, service-role key, payment gateway, or database password was added. [1] [5]

## Database and controlled-workflow validation

The committed migration sequence now contains **13** source migrations, including the Stage 4.2 support/refund readiness migration and the Stage 4.2A live-only payment migration. Both were applied through the authorized Supabase migration workflow. Post-migration bounded checks confirmed the offer is still non-payable. [1]

Disposable users were used solely for validation and were removed afterward. The controlled database exercise verified duplicate-UTR rejection, one-open-claim protection, approval idempotence, atomic seat-cap denial, preservation of an approved claim after entitlement revocation, immutable outcome auditing, and activation analytics. It ended with no fixture users, no fixture claims, zero reviewer rows, zero active Founder entitlements, the Founder cap restored to 50, and the public offer returned to `PLACEHOLDER` with no UPI destination. [1] [5]

| Controlled security or workflow assertion | Result |
|---|---|
| Ordinary user attempts claim creation while offer is `PLACEHOLDER` | Denied; no claim created |
| Ordinary user attempts review, approval, rejection, revocation, reconsideration, or review-funnel access | Denied |
| Duplicate UTR submission | Rejected by database constraint |
| Second verified approval when seat cap is full | Denied atomically |
| Repeat approval of the same claim | Idempotent |
| Entitlement revocation | Blocks future privileged creation while preserving historical approved claim |
| Audit and activation analytics | Written during controlled lifecycle; disposable artifacts removed after verification |

## Browser and responsive verification

The controlled authenticated Founder browser suite passed after signing in only with a disposable ordinary-user account. It confirmed the live `PLACEHOLDER` offer shows setup-state copy, does not show a verified-payment section, QR image, payment intent, copy action, claim form, or payment-submission action, and safely returns to the ledger and signs out. The same assertions passed at **360px, 390px, 430px, 768px, and 1440px**. [2]

Free-plan conversion remains a route to the Founder information surface, not a path to payment or entitlement. Existing-client reuse continues to require explicit client selection. Privacy, terms, disclosure, and event-capture code paths remain present without collecting banking credentials or exposing secrets. [4] [5]

## Quality, security, and dependency gates

The final local release candidate completed a frozen install and the following gates with no suppressed failures: ESLint, TypeScript, **38 Vitest tests**, production build, and production dependency audit. The build succeeded; the existing Rollup large-chunk advisory remains a non-blocking performance observation and does not affect payment safety. The production audit reported no known vulnerabilities. [6]

A tracked-source credential scan and whitespace check found no service-role key, database credential, private key, or privileged runtime value. The only literal matching the phrase `service_role` was an intentional negative assertion in the security contract test and was excluded from the second, otherwise clean source scan. The application remains an independent static Vite frontend with only browser-safe Supabase variables. [5] [6]

## Remaining private inputs for Stage 4.2B only

Stage 4.2A intentionally does **not** request or persist live payment data. A later, separately authorized Stage 4.2B task would require all of the following before a `LIVE` transition can even be considered:

| Required item | Purpose | Must not include |
|---|---|---|
| Business-controlled UPI VPA | Customer payment destination | UPI PIN, OTP, banking password, account login, or card data |
| Payee name | Customer-visible payment identity | Banking credentials |
| Public support email | Payment/refund questions | Private mailbox credentials |
| Founder-approved refund-policy wording | Truthful customer disclosure | Fabricated legal or support claims |
| Operator account email after one normal sign-in | Resolve the authenticated UUID through the protected administrative path | Frontend UUID entry or browser self-enrollment |

Even with those future inputs, no payment should occur until a founder explicitly authorizes a controlled test after independently reviewing the UPI destination and live payload. A QR/URI payload confirms only what the app encodes; it cannot prove bank-account ownership or payment settlement.

## Final release status

**Stage 4.2A is ready for independent engineering review, not for payment collection.** The live configuration remains fail-closed and no customer can pay or self-activate Founder access. This branch may be committed, pushed, and CI-verified as a non-live infrastructure milestone. It must then stop: do not deploy publicly, take a payment, configure live operator or merchant data, begin Stage 4.2B, or begin Stage 5 without a new explicit founder instruction.

## References

[1]: supabase/migrations/20260814110000_stage4_2a_live_payment_gate.sql "Stage 4.2A live-only payment gate"
[2]: e2e/founder-purchase.spec.ts "Controlled responsive Founder placeholder browser verification"
[3]: client/src/lib/founder-payment.ts "Canonical UPI URI, QR, and mobile-intent helper"
[4]: client/src/pages/FounderPurchase.tsx "Founder customer purchase and disclosure surface"
[5]: tests/security-contract.test.ts "Database and browser security contract assertions"
[6]: package.json "Stage 4.2A release-gate scripts"
