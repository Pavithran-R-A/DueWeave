-- A cancellation may occur before a payer has any UTR or payer name to submit.
-- Preserve strict reference validation for every submitted/reviewed state while
-- allowing a cancelled private draft to retain its intentionally empty fields.
begin;

alter table public.purchase_claims
  drop constraint if exists purchase_claims_reference_state_check;

alter table public.purchase_claims
  add constraint purchase_claims_reference_state_check
  check (
    (status in ('DRAFT', 'CANCELLED') and utr_reference = '' and payer_name = '')
    or
    (status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')
      and char_length(utr_reference) between 6 and 64
      and char_length(payer_name) between 2 and 120)
  );

commit;
