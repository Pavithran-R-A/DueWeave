-- Stage 4 corrective migration: Stage 2 renamed the legacy provider/external-reference pair
-- to payer_name/utr_reference. Its global uniqueness rule makes every DRAFT share the
-- same empty pair ('', ''), which conflicts with the Stage 4 status-aware draft model.
-- The partial unique index below remains the database-level UTR enforcement boundary.
alter table public.purchase_claims
  drop constraint if exists purchase_claims_provider_external_reference_key;

comment on index public.purchase_claims_utr_reference_unique is
  'Prevents duplicate normalized UTR references once a Founder payment reference is submitted or reviewed; drafts intentionally carry empty placeholder values.';
