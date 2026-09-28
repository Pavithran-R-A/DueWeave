# Trusted Operator Bootstrap

This runbook is for the account owner who will later perform **manual Founder payment review**. It does not create an operator account, configure a payment destination, or provide an application-visible administrator flag.

## Preconditions

The intended reviewer must first have a verified DueWeave account created through the normal Supabase Auth flow. Confirm the account's immutable `auth.users.id` through the Supabase dashboard. Do not use an email address as the authorization key, and never expose a service-role credential to the browser, source tree, Git history, CI logs, or support channels.

## Allowlisting

Using an owner-controlled, audited Supabase SQL session, insert that verified UUID into `public.founder_admins`. This table is server-controlled: the browser has no write policy and ordinary users cannot add themselves. Use a one-account, least-privilege allowlist; do not create a general `admin` flag on a user profile.

```sql
insert into public.founder_admins (user_id)
values ('<verified-auth-user-uuid>');
```

Record the business reason, the reviewer identity, and the date in the operator's internal record. If the reviewer changes, remove the old UUID before allowlisting a replacement.

## Operational review procedure

The reviewer signs in normally and opens `/admin/founder-claims`. Before approving or reconsidering a claim, independently match the submitted UTR/reference, amount, and payer details against the business bank-history source outside DueWeave. Do not request or enter UPI PINs, OTPs, bank passwords, card numbers, or other banking credentials.

Approval is the "Approve after bank check" action on a pending claim. It writes the claim decision, the entitlement, the audit event and the funnel event in one transaction, holds the transaction-scoped advisory lock on the seat cap so two simultaneous reviews cannot both take the same seat, and is idempotent when the claim is already approved. It carries no verification argument: the reviewer's own action is the assertion, recorded as `manual_bank_review`.

A previously rejected claim appears in a separate section with the heading "Reconsider after bank-history recheck". The button "Approve after recheck" stays disabled until the reviewer ticks "I independently verified this payment in business bank history." That tick is what supplies the required `p_bank_history_verified` argument; the server refuses the call without it, accepts only rejected claims, keeps the original UTR and rejection history, records a reconsideration audit event, applies the same seat-cap lock, and is idempotent after approval.

## Revoking Founder access

The review screen carries no revoke control: removing a paid entitlement is not a queue action, and there is no browser button, admin flag or one-click switch that performs it. Revoke from an authenticated reviewer session by calling the routine directly, or from the owner's audited SQL session:

```sql
select public.revoke_founder_entitlement('<verified-user-uuid>', 'Refund settled outside DueWeave');
```

The caller must already be allowlisted, or the call is refused. Revocation marks the entitlement revoked, writes an audit event with the reason, and restores the database-enforced Free-plan creation limit. It does not delete the claim, the payment reference, the audit history or the receivables the customer recorded while they had access.

## Reading the readiness state

One query reports every prerequisite, satisfied or not, in the same order the application's readiness model uses, together with the authority's own verdict. The whitespace class below is the set of characters the customer surface treats as blank — the ASCII space and controls, the Unicode space separators and the byte-order mark — so a value that looks configured through a plain `trim()` is not necessarily configured; it is spelled out with `chr()` so a copy-paste into psql cannot lose an invisible character. `ready` is `public.founder_offer_payment_ready()`'s answer, the same conjunction both claim RPCs evaluate before they let a customer start or submit a claim, and the per-term rows explain which line of that answer a person has to clear.

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
       g.gap_kind,
       rd.ready
  from rd
 cross join lateral (values
    (1,'offer-disabled',               not rd.enabled),
    (2,'destination-not-live',         rd.payment_destination_status <> 'LIVE'),
    (3,'price-not-canonical',          rd.amount_paise <> 49900),
    (4,'vpa-missing',                  btrim(coalesce(rd.upi_id, ''), rd.ws_chars) = ''),
    (5,'vpa-malformed',                btrim(coalesce(rd.upi_id, ''), rd.ws_chars) <> ''
                                       and btrim(rd.upi_id, rd.ws_chars) !~* '^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$'),
    (6,'payee-missing',                btrim(coalesce(rd.payee_name, ''), rd.ws_chars) = ''),
    (7,'support-pending',              rd.support_contact_status <> 'CONFIGURED'),
    (8,'support-contact-unusable',     length(btrim(coalesce(rd.support_contact, ''), rd.ws_chars)) < 3
                                       or btrim(rd.support_contact, rd.ws_chars) = 'Support contact not configured'),
    (9,'refund-policy-pending',        rd.refund_policy_status <> 'APPROVED'),
    (10,'refund-policy-text-missing',  btrim(coalesce(rd.refund_policy_text, ''), rd.ws_chars) = ''),
    (11,'refund-policy-text-too-short', btrim(coalesce(rd.refund_policy_text, ''), rd.ws_chars) <> ''
                                       and length(btrim(rd.refund_policy_text, rd.ws_chars)) < 40),
    (12,'disclosures-pending',         rd.disclosures_status <> 'APPROVED')
  ) as g(ord, gap_kind, missing)
 order by g.ord;
```

Seven rows come back labelled `GAP` on the delivered database — `destination-not-live`, `vpa-missing`, `support-pending`, `support-contact-unusable`, `refund-policy-pending`, `refund-policy-text-missing`, `disclosures-pending` — and every row carries `ready` as `f`. The offer is payable only when no row is `GAP` and `ready` is `t`; `ready` is coalesced, so an absent `FOUNDER_V1` row or a null verdict answers `f` instead of reading as an answer.

Two companion reads settle who can review and how many seats are taken:

```sql
select count(*) as reviewers from public.founder_admins;
select count(*) as active_founder_seats
  from public.entitlements where plan = 'FOUNDER' and status = 'ACTIVE';
```

## What each refusal means

Every message below is the whole of what the reviewer sees; none of them name a
constraint, an SQLSTATE, a policy or a database role.

| Reviewer sees | What happened | What the reviewer does |
| --- | --- | --- |
| `Founder review access is not available for this account.` | The signed-in account is not on `founder_admins`. | Ask the owner to allowlist the account's UUID; do not share a reviewer session. |
| `This Founder claim is not available` | The claim id is not one this deployment holds. | Refresh the queue and work from the re-read list. |
| `Only a pending Founder claim can be approved` | Another review already decided this claim. | Refresh; the claim is in the approved or rejected history. |
| `This Founder claim no longer matches the configured offer` | The stored claim amount or plan is not the current offer. | Stop and re-check the offer before approving anything. |
| `The verified Founder offer is currently full.` | The seat cap is reached; the claim stays pending and reviewable. | Raise the cap deliberately, or reject the claim with a reason. |
| `Founder access approved` / `Founder access approved after recheck` | The decision was written atomically. | Nothing further; the customer's own screen now says the same thing. |

A refused decision never leaves a half-written record: the claim stays in the
state it was in, and the refusal is the only change the reviewer observes.

## Payment and release boundaries

The committed offer remains an enabled **PLACEHOLDER** with no UPI destination. The Stage 4.2 readiness gate additionally requires a trusted-operator-configured public support contact and an explicitly Founder-approved refund-policy text before `create_founder_claim()` or `submit_founder_payment()` can proceed. The browser cannot set those fields, write the allowlist, or activate entitlement.

Configure a genuine business destination only after separate operational, legal, support, and privacy review. A controlled test payment still requires an explicit founder authorization at the final payment gate. This repository change does not deploy the product, configure a reviewer, configure a payment destination, or merge the release branch.
