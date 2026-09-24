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

The reviewer signs in normally and opens `/founder/admin`. Before approving or reconsidering a claim, independently match the submitted UTR/reference, amount, and payer details against the business bank-history source outside DueWeave. Do not request or enter UPI PINs, OTPs, bank passwords, card numbers, or other banking credentials.

For a previously rejected claim, use **Reconsider after bank verification** only after independently completing that recheck and entering a concise factual note. The server requires this confirmation, accepts only rejected claims, retains the original UTR and rejection history, records a reconsideration audit event, applies the existing atomic seat-cap lock, and is idempotent after approval.

## Verification and revocation

After allowlisting, verify that the reviewer can access only the restricted pending/rejected claim queues and that a normal authenticated account receives a denial from the same RPCs. Revoke Founder access through the restricted review flow when required; revocation preserves the user's existing records but restores the database-enforced Free-plan creation limit.

## Payment and release boundaries

The committed offer remains an enabled **PLACEHOLDER** with no UPI destination. The Stage 4.2 readiness gate additionally requires a trusted-operator-configured public support contact and an explicitly Founder-approved refund-policy text before `create_founder_claim()` or `submit_founder_payment()` can proceed. The browser cannot set those fields, write the allowlist, or activate entitlement.

Configure a genuine business destination only after separate operational, legal, support, and privacy review. A controlled test payment still requires an explicit founder authorization at the final payment gate. This repository change does not deploy the product, configure a reviewer, configure a payment destination, or merge the release branch.
