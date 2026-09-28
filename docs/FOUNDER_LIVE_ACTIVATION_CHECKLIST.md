# Founder Live-Activation Checklist

A person answers this list. Nothing in the product answers it for them, and no item
here can be cleared from a browser, an admin screen, or a one-click control. The
customer payment surface opens only when every item is cleared, because the
readiness conjunction in `FOUNDER_PAYMENT_READINESS.md` is a conjunction: one
missing term blocks the QR, the UPI link, claim creation, and payment submission.

The repository ships NOT READY. `tests/stage8-founder-contracts.test.ts` pins the
item list below to the gap kinds `client/src/lib/founder-readiness.ts` actually
reports, so this document cannot drift away from the code that gates the workflow.
The conjunction itself belongs to the database: `public.founder_offer_payment_ready()`
evaluates these twelve terms and both claim RPCs refuse on its answer, so the reads
in this file describe the same rule the server enforces rather than a copy of it.

## How to read an item

| Field | Meaning |
|---|---|
| `id` | The gap kind the readiness evaluator reports when the term is unmet |
| `term` | What must be true |
| `query` | Run it in an owner-controlled SQL session and read the result |
| `pass_when` | The value that clears the term |
| `default_state` | `clear`, `placeholder`, `gap`, or `not-applicable` in the delivered local state |
| `cleared_by` | Who has to act; `owner` means a deliberate decision, not a step in a script |

`placeholder` means the term reads as satisfied only because a non-usable sentence
sits in the column: it must be replaced, not merely confirmed. No delivered item is
labelled that way, because the shipped row fails the support-status term before the
contact itself is ever reached — `support-contact-unusable` is enumerated as a gap.
It still deserves the label in substance: after the readiness-parity repair the
authority counts the shipped sentence as a missing term even with
`support_contact_status` set to `CONFIGURED`, which a length-only rule used to read
as configured.

`not-applicable` means the term cannot be answered until an earlier term is cleared.

One normalization caveat. "Blank" for the authority means blank after the character
class JavaScript's `trim()` removes — the ASCII spaces and controls, the Unicode
space separators such as U+00A0 and U+2000–U+200A, and the byte-order mark. The
queries below spell that class out as `btrim(x, ' ' || chr(9) || … )`; a plain
Postgres `trim()` strips only the ordinary space, so it can read a value that is
blank to the customer surface as configured.

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
    pass_when: "an address that is not blank"
    default_state: gap
    cleared_by: owner

  - id: vpa-malformed
    term: The configured VPA parses as a UPI address
    column: upi_id
    query: "select trim(coalesce(upi_id, '')) ~* '^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$' from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "t"
    default_state: not-applicable
    cleared_by: owner, plus an independent check against the business bank account

  - id: payee-missing
    term: A payee display name is configured
    column: payee_name
    query: "select payee_name from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "a name that is not blank"
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
    query: "select support_contact, length(trim(coalesce(support_contact, ''))) >= 3, support_contact is distinct from 'Support contact not configured' from public.founder_offer_config where offer_key = 'FOUNDER_V1';"
    pass_when: "a monitored address: at least 3 characters, and not the shipped sentence"
    default_state: gap
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
`OPERATOR_BOOTSTRAP.md` carries the same statement. The class literal below is the
characters the authority strips — the ASCII space and controls, the Unicode space
separators and the byte-order mark — spelled out with `chr()` so a copy-paste into
psql cannot lose an invisible character; it matches the class inside
`public.founder_offer_payment_ready()`.

```sql
with ws(c) as (values(
  ' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(160)||chr(5760)
     ||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)
     ||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)) ),
rd as (
  select coalesce(public.founder_offer_payment_ready(offer), false) as ready,
         offer.*,
         ws.c as ws_chars
    from public.founder_offer_config offer
     cross join ws
   where offer.offer_key = 'FOUNDER_V1'
)
select g.ord,
       case when g.missing then 'GAP' else 'ok' end as state,
       g.gap_kind
  from rd
 cross join lateral (values
    (1,'offer-disabled',              not rd.enabled),
    (2,'destination-not-live',        rd.payment_destination_status <> 'LIVE'),
    (3,'price-not-canonical',         rd.amount_paise <> 49900),
    (4,'vpa-missing',                 btrim(coalesce(rd.upi_id, ''), rd.ws_chars) = ''),
    (5,'vpa-malformed',               btrim(coalesce(rd.upi_id, ''), rd.ws_chars) <> ''
                                       and btrim(rd.upi_id, rd.ws_chars) !~* '^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$'),
    (6,'payee-missing',               btrim(coalesce(rd.payee_name, ''), rd.ws_chars) = ''),
    (7,'support-pending',             rd.support_contact_status <> 'CONFIGURED'),
    (8,'support-contact-unusable',    length(btrim(coalesce(rd.support_contact, ''), rd.ws_chars)) < 3
                                       or btrim(rd.support_contact, rd.ws_chars) = 'Support contact not configured'),
    (9,'refund-policy-pending',       rd.refund_policy_status <> 'APPROVED'),
    (10,'refund-policy-text-missing', btrim(coalesce(rd.refund_policy_text, ''), rd.ws_chars) = ''),
    (11,'refund-policy-text-too-short', length(btrim(rd.refund_policy_text, rd.ws_chars)) between 1 and 39),
    (12,'disclosures-pending',        rd.disclosures_status <> 'APPROVED')
  ) as g(ord, gap_kind, missing)
 order by g.ord;
```

Zero gaps means the conjunction holds. Seven is the delivered state, measured
against the row above: `destination-not-live`, `vpa-missing`, `support-pending`,
`support-contact-unusable`, `refund-policy-pending`, `refund-policy-text-missing`,
`disclosures-pending`. The fourth of those is the placeholder sentence, which a
length-only rule used to read as configured.

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
