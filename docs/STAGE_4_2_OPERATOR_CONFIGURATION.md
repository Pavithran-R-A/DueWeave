# Founder Payment Configuration: Order of Work

This file keeps the route map written at Stage 4.2A and brings it up to date with
what Stage 8 actually measured. The file name is unchanged because other documents
and reports refer to it.

## What this repository delivers

Founder monetization is engineering only. Nothing in this repository authorizes a
payment, a public sale, customer acquisition, a deployment, a real Founder
activation, or the next roadmap stage.

The delivered `FOUNDER_V1` row is a non-payable placeholder:

| Column | Delivered value |
|---|---|
| `enabled` | `true` |
| `payment_destination_status` | `PLACEHOLDER` |
| `upi_id` | `NULL` |
| `payee_name` | `DueWeave` |
| `amount_paise` | `49900` |
| `founder_cap` | `50` |
| `support_contact_status` | `PENDING` |
| `support_contact` | `Support contact not configured` |
| `refund_policy_status` | `PENDING_APPROVAL` |
| `refund_policy_text` | `NULL` |
| `disclosures_status` | `PENDING` |

Against the twelve-term readiness conjunction in `FOUNDER_PAYMENT_READINESS.md`,
that row reports seven gaps, so a customer sees no payment instructions, no QR, no
UPI link, no copy action, and no claim button: the destination is not live, the VPA
is absent, support, refund and disclosures are unapproved, the refund text is absent,
and the shipped support sentence is not an address a customer can use. That last one
is the gap a length-only rule could not see, because the sentence is twenty-eight
characters long.

The database refuses the same way the browser does. `create_founder_claim()` and
`submit_founder_payment()` both evaluate
`public.founder_offer_payment_ready()` inside the transaction, so the UI is not the
gate and the two RPCs cannot drift into enforcing different rules from each other.

## Fixtures are not configuration

Stage 8's browser journeys temporarily write a payment-ready row to reach the parts
of the workflow that only open when ready. That fixture sets
`payment_destination_status = 'LIVE'` with `upi_id = 'dueweave-test@upi'`, payee
`DueWeave Test Fixture`, and support `founder-support+fixture@example.invalid`, and
the run restores the snapshot taken before it started, in an unconditional teardown.
The live suite does the same in `tests/stage8-local-founder-readiness.test.ts`.

A `TEST` destination status exists in the vocabulary so an engineering fixture can
exercise the URI builder, and customer claim RPCs reject it: only `LIVE` opens the
workflow. No fixture value is a production default, and none may be reused as one.

## Order of work for a future live configuration

The steps below are the safe order. This stage does not execute any of them.

1. The intended reviewer creates a normal account through the ordinary sign-up
   flow, and the owner reads that account's immutable `auth.users.id` UUID in the
   Supabase dashboard. An email address is never the authorization key.
2. The owner adds that UUID to the server-controlled `founder_admins` allowlist
   through an owner-controlled SQL session. See `OPERATOR_BOOTSTRAP.md`.
3. A public support address is chosen, published, and configured with
   `support_contact_status = 'CONFIGURED'`.
4. The owner approves the refund terms that will actually be published, writes the
   approved text, and sets `refund_policy_status = 'APPROVED'`.
5. The owner approves the consumer disclosures and sets
   `disclosures_status = 'APPROVED'`.
6. A business-controlled VPA is verified independently against the business bank
   account, outside DueWeave.
7. A truthful payee display name is verified independently against the name the
   bank statement shows.
8. The exact price is verified as `49900` paise, which is the only amount the
   product advertises.
9. Only then is `payment_destination_status` set to `LIVE`.
10. The operator reads back the readiness state and confirms zero gaps, using the
    diagnostics query in `OPERATOR_BOOTSTRAP.md` and
    `FOUNDER_LIVE_ACTIVATION_CHECKLIST.md`.
11. The operator generates the payment URI and QR for one claim and decodes the QR
    independently, comparing VPA, payee name, amount `499.00`, currency `INR`, and
    note against the founder-provided public instructions. This validates payload
    generation only; it does not establish bank-account ownership or routing.
12. Customer copy is read on the built page, and only then is a controlled test
    payment considered, and only with explicit founder authorization.

Steps 3 through 9 are direct writes to the single `FOUNDER_V1` row by a trusted
operator. There is no browser control, admin screen, or one-click toggle that
performs them, and Stage 8 adds none.

Nothing in this order requests or accepts a UPI PIN, OTP, banking password,
internet-banking login, card number, CVV, payment-gateway key, or service-role key.
The application never stores any of those.

## Review and customer boundaries

A customer signs in normally, reaches `/founder` from the Free-plan active-receivable
limit, and creates a private claim only while payment instructions are live. The
restricted reviewer works in `/admin/founder-claims` and compares a submitted
reference against business bank history held outside DueWeave. An ordinary account
is denied by the same reviewer RPCs.

A UPI intent, a scanned QR, a returned app, a focus change, or a page reload is not
payment evidence. Every outcome the product reports comes from a customer-submitted
reference plus a reviewer's manual bank check. Claim outcomes are `Payment not
found`, `Duplicate reference`, `Reference could not be verified`, `Rejected`,
`Under review`, or `Founder activated`; none of them is an automatic bank detection.

Refunds remain a manual operator decision recorded against the claim, and do not
change any statutory right. This document states the product's mechanics, not a
legal conclusion: the refund and disclosure text must be written and approved by the
owner with their own advice.

## Stop boundary

At the end of this stage the offer is still `PLACEHOLDER`, `upi_id` is `NULL` in the
delivered state, no reviewer is allowlisted, approved real Founder customers are
zero, and real money collected is ₹0. Do not deploy, collect payment, or start the
next stage from this document.
