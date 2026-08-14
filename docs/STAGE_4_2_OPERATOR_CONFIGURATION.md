# Stage 4.2A: Fail-Closed Founder Payment Engineering

## Purpose and current state

Stage 4.2A delivers payment **infrastructure only**. It authorizes neither a payment, public sale, customer acquisition, deployment, real Founder activation, nor Stage 5. The live `FOUNDER_V1` offer remains `PLACEHOLDER`, has no UPI destination, has no configured support contact, has no approved public refund terms, and has no Founder-review operator.

The database and browser both fail closed. A customer cannot start a claim, submit a payment reference, see a payable QR, open a UPI app, or copy a UPI intent unless a future trusted operator has explicitly configured every live prerequisite. A `TEST` status is allowed only in isolated engineering fixtures and is never accepted by customer claim RPCs.

| Control | Stage 4.2A state | Future live prerequisite |
|---|---|---|
| Payment destination | `PLACEHOLDER`; VPA is `NULL` | A business-controlled VPA and `LIVE` status |
| Price | ₹499.00 data contract | Exact integer amount `49900` paise |
| Payee | Not publicly configured | Truthful display name |
| Support | Not publicly configured | Public support address |
| Refund terms | Draft only; not published as a promise | Founder-approved publication text |
| Disclosures | Pending | Trusted approval of required disclosures |
| Reviewer | No allowlisted operator | Normal signed-in reviewer UUID allowlisted server-side |

## Stage 4.2A payment-readiness evaluator

Payment is ready only when all of the following are true: the offer is enabled, `payment_destination_status = 'LIVE'`, a valid VPA and payee name exist, the price equals `49900` paise, support is configured, refund terms are approved and present, and disclosures are approved. Any missing or malformed value results in no QR, no mobile intent, no copy action, no claim creation, and no payment-reference submission.

The reusable URI layer is deliberately generic. Its isolated test fixture uses `dueweave-test@upi` with an explicit TEST note; it is not stored in the live offer and can never become a production fallback.

## Future operator path — not authorized in Stage 4.2A

Only a separately authorized **Stage 4.2B** may accept the following inputs: a real reviewer account, a business-controlled VPA, a payee display name, a public support address, and final founder-approved refund terms. It must not request or accept a UPI PIN, OTP, banking password, bank login, card number, payment-gateway key, service-role key, or any other banking credential.

When that authorization exists, the owner-controlled administrative path must resolve a normal authenticated reviewer account to its immutable UUID, add it to the server-controlled `founder_admins` allowlist, and configure the single `FOUNDER_V1` record to `LIVE` only after independently checking completeness. The operator must independently decode the generated QR and compare the VPA, payee name, exact amount **₹499.00**, currency `INR`, and note against founder-provided public payment instructions. This validates payload generation only; it does not establish bank-account ownership or routing.

## Review and customer boundaries

If a later authorized live test is approved, a customer must sign in normally, be redirected from the Free-plan active-receivable limit to `/founder`, and create a private claim only after visible payment instructions are live. The restricted reviewer uses `/admin/founder-claims` and manually compares a submitted reference with business bank history outside DueWeave. An ordinary user must remain denied by the same reviewer RPCs. A claim outcome may be `Payment not found`, `Duplicate reference`, `Reference could not be verified`, `Rejected`, `Under review`, or `Founder activated`; none are automatic bank-detection outcomes.

The application stores only the payer name and payment reference supplied, configured offer amount, verification status, and review timestamps. It never stores UPI PINs, OTPs, bank passwords, internet-banking logins, or card credentials. Any refund decision remains a manual operator outcome and does not alter applicable statutory rights.

## Stage 4.2A stop boundary

At the end of this stage, the offer must still be `PLACEHOLDER`, `upi_id` must be `NULL`, no reviewer may be allowlisted, approved real Founder customers must be zero, and real money collected must be **₹0**. Do not deploy, collect payment, start Stage 4.2B, or start Stage 5.
