# Stage 4.2: Trusted Operator and One-Controlled-Payment Procedure

## Purpose and current state

This runbook prepares a **single, explicitly authorized controlled Founder-payment test**. It does not authorize a payment, a public sale, customer acquisition, deployment, or Stage 5.

At the start of Stage 4.2, the Founder offer is enabled only as a safe `PLACEHOLDER`: it has no UPI destination, no configured support contact, no approved refund-policy text, and no Founder-review operator. The database-enforced readiness gate prevents claim creation and payment-reference submission until all three trusted configuration conditions are satisfied.

## What the founder must provide before any trusted configuration

The founder must explicitly supply all of the following in the project conversation. Do not use personal, borrowed, or unverified payment details.

| Required item | Required form | How it is used |
|---|---|---|
| Reviewer account | The email address used for the normal DueWeave account sign-up | Resolves the immutable authenticated UUID for the one-account `founder_admins` allowlist. |
| Real payment VPA | A business-controlled UPI VPA, such as `business@bank` | Stored only in the server-controlled offer configuration and used in the UPI QR and intent. |
| Payee name | The name a payer should expect in their UPI app | Stored in the server-controlled offer configuration and displayed before payment. |
| Public support contact | A business email address intended for customer payment and refund questions | Stored in the server-controlled offer configuration and shown in the Founder terms surface. |
| Refund-policy decision | Explicit approval or rejection of the proposed policy below | The text is not published and payment remains blocked until explicitly approved. |

No UPI PIN, OTP, bank password, card number, bank login, service-role key, payment-gateway key, or other banking credential is ever requested or accepted.

## Founder sign-up and reviewer identity

1. Open the DueWeave preview and select **Create account** on the ordinary authentication surface.
2. Sign up with the email address that should become the one manual Founder reviewer. Use a normal email-and-password flow; do not create a browser-visible administrator flag.
3. Complete any normal email verification required by the authentication provider, then sign in successfully once.
4. Send the account email to the operator in the project conversation. The operator will resolve the immutable `auth.users.id` through an owner-controlled Supabase session and insert that UUID into the server-controlled `founder_admins` allowlist.
5. The reviewer then signs in normally and uses only `/admin/founder-claims` for manual review. A normal customer must continue to receive a denial from the same reviewer RPCs.

## Proposed refund policy — requires explicit founder approval

> **Proposed beta Founder refund policy.** A Founder customer may request a manual refund review within seven calendar days after Founder entitlement activation. A refund may be approved when the payment is confirmed, the request is made within that window, and Founder features have not been materially used. Requests are handled manually through the configured support contact and do not alter any applicable statutory consumer rights.

This is a proposed operating policy, not legal or tax advice. It remains hidden from the public Founder purchase surface until the founder explicitly approves the exact text. The operator must independently confirm any accounting, tax, consumer-protection, refund-processing, or business-registration obligations before enabling collection.

## Configuration and controlled-test sequence

1. The operator validates the founder-provided VPA, payee name, support address, and approved policy text for completeness. This does **not** verify underlying bank-account ownership or UPI routing.
2. Through the owner-controlled Supabase administrative path, the operator allowlists only the authenticated reviewer UUID and updates the one `FOUNDER_V1` offer to `CONFIGURED`, a configured support status, and an approved policy status/text.
3. The operator independently decodes the generated QR and UPI intent, then compares the VPA, payee name, amount **₹499.00**, currency `INR`, and note `DueWeave Founder Lifetime` with the founder-provided values. This verifies the generated payload only, not a bank account.
4. The operator verifies reviewer authorization, normal-user denial, Free-plan upgrade routing, duplicate-UTR rejection, and the restricted Founder review surface.
5. The operator runs the full release gates and confirms the exact branch head is green in GitHub Actions.
6. **Stop.** The founder must explicitly authorize the one payment immediately before any UPI action. Neither the application nor the operator initiates an external money transfer automatically.

## During and after the one controlled payment

The controlled customer creates a private claim, pays only after inspecting the UPI app’s own payee and amount, and submits the reference shown in their payment history. The reviewer compares the reference, payer details, and exact amount against business bank history outside DueWeave before approval. The reviewer records only the claim outcome and short factual review note; no banking credentials are entered into DueWeave.

After approval, verify that only that customer receives an active Founder entitlement and can create more than three active receivables. If the test is rejected or cancelled, preserve the immutable claim and audit history; do not delete evidence or reuse a UTR. Keep the configured destination disabled again unless the founder separately authorizes broader operation.
