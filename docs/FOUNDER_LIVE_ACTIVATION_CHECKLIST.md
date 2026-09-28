# Founder Live-Activation Checklist

A person answers this list. Nothing in the product answers it for them, and no item
here can be cleared from a browser, an admin screen, or a one-click control. The
customer payment surface opens only when every item is cleared, because the
readiness conjunction in `FOUNDER_PAYMENT_READINESS.md` is a conjunction: one
missing term blocks the QR, the UPI link, claim creation, and payment submission.

The repository ships NOT READY. `tests/stage8-founder-contracts.test.ts` pins the
item list below to the gap kinds `client/src/lib/founder-readiness.ts` actually
reports, so this document cannot drift away from the code that gates the workflow.

## How to read an item

| Field | Meaning |
|---|---|
| `id` | The gap kind the readiness evaluator reports when the term is unmet |
| `term` | What must be true |
| `query` | Run it in an owner-controlled SQL session and read the result |
| `pass_when` | The value that clears the term |
| `default_state` | `clear`, `placeholder`, `gap`, or `not-applicable` in the delivered local state |
| `cleared_by` | Who has to act; `owner` means a deliberate decision, not a step in a script |

`placeholder` means the term reads as satisfied but only because a non-usable
sentence sits in the column. It must be replaced, not merely confirmed.
`not-applicable` means the term cannot be answered until an earlier term is cleared.

## The list

```yaml
offer: FOUNDER_V1
ready_when: every item clear and no independent verification outstanding
result: NOT READY
items:
  - id: offer-disabled
    term: The Founder offer is enabled
    column: enabled
    query: "select enabled from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "true"
    default_state: clear
    cleared_by: owner

  - id: destination-not-live
    term: The payment destination is marked LIVE
    column: payment_destination_status
    query: "select payment_destination_status from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "LIVE"
    default_state: gap
    cleared_by: owner, last, after the independent checks below

  - id: price-not-canonical
    term: The price is the approved amount
    column: amount_paise
    query: "select amount_paise from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "49900"
    default_state: clear
    cleared_by: owner

  - id: vpa-missing
    term: A UPI VPA is configured
    column: upi_id
    query: "select upi_id from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "a non-null address"
    default_state: gap
    cleared_by: owner

  - id: vpa-malformed
    term: The configured VPA parses as a UPI address
    column: upi_id
    query: "select upi_id ~ '^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$' from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "t"
    default_state: not-applicable
    cleared_by: owner, plus an independent check against the business bank account

  - id: payee-missing
    term: A payee display name is configured
    column: payee_name
    query: "select payee_name from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "a non-empty name"
    default_state: clear
    cleared_by: owner, plus an independent check against the bank statement name

  - id: support-pending
    term: The public support contact is marked configured
    column: support_contact_status
    query: "select support_contact_status from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "CONFIGURED"
    default_state: gap
    cleared_by: owner

  - id: support-contact-unusable
    term: A support address customers can actually use is published
    column: support_contact
    query: "select support_contact, length(trim(support_contact)) from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "a monitored address"
    default_state: placeholder
    cleared_by: owner

  - id: refund-policy-pending
    term: The refund policy is approved for publication
    column: refund_policy_status
    query: "select refund_policy_status from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "APPROVED"
    default_state: gap
    cleared_by: owner, with their own advice

  - id: refund-policy-text-missing
    term: The approved refund text is published
    column: refund_policy_text
    query: "select refund_policy_text from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "the approved text"
    default_state: gap
    cleared_by: owner

  - id: refund-policy-text-too-short
    term: The published refund text is at least the reviewed minimum length
    column: refund_policy_text
    query: "select length(trim(refund_policy_text)) from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "40 or more, and the wording the owner approved"
    default_state: not-applicable
    cleared_by: owner

  - id: disclosures-pending
    term: The consumer disclosures are approved
    column: disclosures_status
    query: "select disclosures_status from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "APPROVED"
    default_state: gap
    cleared_by: owner, with their own advice
```

## After the list is clear

The database answers in one query, and it is the answer the customer page acts on.
`OPERATOR_BOOTSTRAP.md` carries the full statement; the short form is:

```sql
select count(*) as gaps_outstanding
from public.founder_offer_config c
cross join lateral (values
  (1, not c.enabled),
  (2, c.payment_destination_status <> 'LIVE'),
  (3, c.amount_paise <> 49900),
  (4, trim(coalesce(c.upi_id, '')) = ''),
  (5, trim(coalesce(c.upi_id, '')) <> '' and c.upi_id !~ '^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$'),
  (6, trim(coalesce(c.payee_name, '')) = ''),
  (7, c.support_contact_status <> 'CONFIGURED'),
  (8, length(trim(coalesce(c.support_contact, ''))) < 3),
  (9, c.refund_policy_status <> 'APPROVED'),
  (10, trim(coalesce(c.refund_policy_text, '')) = ''),
  (11, length(trim(coalesce(c.refund_policy_text, ''))) between 1 and 39),
  (12, c.disclosures_status <> 'APPROVED')
) as g(ord, missing)
where g.missing;
```

Zero means ready. Six is the delivered state, measured against the row above.

Then, and only then, the two things no column can prove:

1. A reviewer account exists and its UUID is in `public.founder_admins`, confirmed by
   signing in as that account and reading the queue at `/admin/founder-claims`.
2. The generated QR and UPI link are decoded independently and compared, field for
   field, against the payment instructions the business publishes outside DueWeave.

Neither establishes bank-account ownership or routing, and neither makes a UPI
intent, a scan, or a returned app into payment evidence. Approval still requires a
human comparing a submitted reference against business bank history.

## What this checklist is not

It is not a runbook for a test payment, a migration, or a deployment, and clearing
every item does not authorize any of them. The order of configuration steps is in
`STAGE_4_2_OPERATOR_CONFIGURATION.md`; allowing a reviewer in is in
`OPERATOR_BOOTSTRAP.md`.
