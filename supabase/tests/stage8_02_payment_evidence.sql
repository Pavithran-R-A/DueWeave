-- Stage 8 — what may claim that a payment happened (pgTAP).
--
-- Run with: pnpm test:db   (supabase test db)
--
-- The whole Stage 8 promise rests on one architecture: a UPI hand-off proves
-- nothing, a UTR/reference typed by a customer is only a claim, and the only
-- thing that says "paid" is a reviewer writing a decision after checking their
-- own bank history. The Node suite exercises that behaviour over the live API;
-- this file pins the database shapes that make it the only possibility, so a
-- later change cannot quietly open a second path to "approved":
--
--   * the claim vocabulary has no paid state at all,
--   * an approved claim cannot exist without a stored reference and payer,
--   * exactly two routines can write that state, and both are reviewer routines,
--   * the analytics and audit layers can only ever record bounded event names.
--
-- These are catalog facts, checked where a stored value would be a leak: no
-- claim, reviewer or customer row is created here, so the file runs identically
-- against a fresh replay and a working local database.

set search_path = public, extensions, tap, core;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- ---------------------------------------------------------------------------
-- A. PHASES 13 and 9: the claim state machine is closed. There is no PAID,
--    SETTLED, SUCCESS or CONFIRMED state to fall into, and the five states that
--    exist are the only vocabulary the table admits.
-- ---------------------------------------------------------------------------
select is(
    (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.purchase_claims'::regclass and conname = 'purchase_claims_status_check'),
    $q$CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PENDING_REVIEW'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])))$q$,
    'a claim can only ever be draft, pending review, approved, rejected or cancelled');

select ok(
    (select pg_get_constraintdef(oid) not ilike '%paid%'
       from pg_constraint
      where conrelid = 'public.purchase_claims'::regclass and conname = 'purchase_claims_status_check'),
    'no stored claim state spells a payment as made');

select is(
    (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.purchase_claims'::regclass and conname = 'purchase_claims_reference_state_check'),
    $q$CHECK ((((status = ANY (ARRAY['DRAFT'::text, 'CANCELLED'::text])) AND (utr_reference = ''::text) AND (payer_name = ''::text)) OR ((status = ANY (ARRAY['PENDING_REVIEW'::text, 'APPROVED'::text, 'REJECTED'::text])) AND ((char_length(utr_reference) >= 6) AND (char_length(utr_reference) <= 64)) AND ((char_length(payer_name) >= 2) AND (char_length(payer_name) <= 120)))))$q$,
    'a claim that has reached review carries a real reference and payer name, and an unsubmitted one carries neither');

-- ---------------------------------------------------------------------------
-- B. PHASE 25: only a reviewer decision can approve. Both approval writers are
--    reviewer routines, and the set of routines that can move a claim at all is
--    closed, so no customer call, trigger or default reaches APPROVED.
-- ---------------------------------------------------------------------------
select is(
    (select array_agg(proname::text order by proname::text) from (
       select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and pg_get_functiondef(p.oid) ~* $re$set[[:space:]]+status[[:space:]]*=[[:space:]]*'APPROVED'$re$
     ) approvals),
    array['approve_founder_claim', 'reconsider_founder_claim'],
    'only the reviewer approval and the reviewer reconsideration can mark a claim approved');

select is(
    (select array_agg(proname::text order by proname::text) from (
       select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and pg_get_functiondef(p.oid) ~* $re$public\.purchase_claims[[:space:]]+set$re$
     ) writers),
    array['approve_founder_claim', 'cancel_founder_claim', 'reconsider_founder_claim', 'reject_founder_claim', 'submit_founder_payment'],
    'the five claim routines are the only code that writes a claim row');

select is(
    (select count(*) from pg_trigger
      where not tgisinternal and tgrelid = 'public.purchase_claims'::regclass),
    2::bigint,
    'no third trigger was added to the claim table beside the timestamp and workflow guards');

select is(
    (select tgname from pg_trigger
      where not tgisinternal and tgrelid = 'public.purchase_claims'::regclass
        and tgname = 'purchase_claims_protect_workflow'),
    'purchase_claims_protect_workflow',
    'direct writes to a claim are refused by the workflow guard trigger');

-- ---------------------------------------------------------------------------
-- C. PHASE 9: recording that someone looked at the offer is a metric, not a
--    transition. The view recorder returns nothing and names none of the tables
--    a payment would have to touch.
-- ---------------------------------------------------------------------------
select is(
    (select pg_get_function_result(p.oid)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'record_founder_upgrade_view'),
    'void',
    'recording an upgrade view returns no claim, entitlement or status to the caller');

select ok(
    (select pg_get_functiondef(p.oid) not ilike '%purchase_claims%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'record_founder_upgrade_view'),
    'the upgrade-view recorder never writes a purchase claim');

select ok(
    (select pg_get_functiondef(p.oid) not ilike '%entitlements%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'record_founder_upgrade_view'),
    'the upgrade-view recorder never writes an entitlement');

-- ---------------------------------------------------------------------------
-- D. PHASES 55 and 56: history is recorded with bounded words. An invented
--    event name such as an auto-approval could not be stored, and neither audit
--    nor analytics metadata has a place to put a reference, a payer or a bank.
-- ---------------------------------------------------------------------------
select is(
    (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.founder_audit_events'::regclass and conname = 'founder_audit_events_event_type_check'),
    $q$CHECK ((event_type = ANY (ARRAY['CLAIM_CREATED'::text, 'CLAIM_SUBMITTED'::text, 'CLAIM_CANCELLED'::text, 'CLAIM_APPROVED'::text, 'CLAIM_REJECTED'::text, 'CLAIM_RECONSIDERED'::text, 'CLAIM_APPROVED_AFTER_REVIEW'::text, 'ENTITLEMENT_REVOKED'::text])))$q$,
    'Founder history holds exactly the eight reviewed event names');

select is(
    (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.founder_audit_events'::regclass and conname = 'founder_audit_events_metadata_check'),
    $q$CHECK (((jsonb_typeof(metadata) = 'object'::text) AND ((metadata - ARRAY['reason'::text, 'source'::text]) = '{}'::jsonb)))$q$,
    'audit metadata is limited to a reason and a source, so no payment evidence can be attached to history');

select is(
    (select array_agg(column_name::text order by column_name::text)
       from information_schema.columns
      where table_schema = 'public' and table_name = 'analytics_events'),
    array['entity_id', 'entity_type', 'event_name', 'id', 'metadata', 'occurred_at', 'owner_id'],
    'analytics has no column that could hold a reference, payer name or destination');

-- ---------------------------------------------------------------------------
-- E. PHASES 13 and 30: the entitlement a payment would grant is a closed set of
--    plan, status and origin values, so no invented "trial" or "auto" state can
--    carry Founder access.
-- ---------------------------------------------------------------------------
select is(
    (select array_agg(conname::text order by conname::text) from pg_constraint
      where conrelid = 'public.entitlements'::regclass and contype = 'c'),
    array['entitlements_source_check', 'entitlements_status_check', 'entitlements_tier_check'],
    'the entitlement table carries exactly the three vocabulary guards');

select is(
    (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.entitlements'::regclass and conname = 'entitlements_status_check'),
    $q$CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'PENDING_REVIEW'::text, 'REVOKED'::text])))$q$,
    'an entitlement is active, awaiting review, or revoked, with nothing between');

select is(
    (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.entitlements'::regclass and conname = 'entitlements_tier_check'),
    $q$CHECK ((plan = ANY (ARRAY['FREE'::text, 'FOUNDER'::text])))$q$,
    'the only tiers are Free and Founder, so no paid tier can be half-written');

-- ---------------------------------------------------------------------------
-- F. PHASES 34 and 37: the reviewer's own assertions are part of the signature.
--    Reconsideration cannot be called without stating that the bank history was
--    verified, and approval takes nothing but the claim it decides on.
-- ---------------------------------------------------------------------------
select is(
    (select pg_get_function_arguments(p.oid)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'reconsider_founder_claim'),
    'p_claim_id text, p_bank_history_verified boolean, p_note text DEFAULT NULL::text',
    'reconsideration demands an explicit bank-history verification argument, and only the note is optional');

select is(
    (select pg_get_function_arguments(p.oid)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'approve_founder_claim'),
    'p_claim_id text',
    'approval takes only the claim under review, so nothing can be attached to the decision');

select is(
    (select pg_get_function_arguments(p.oid)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_founder_claim'),
    ''::text,
    'a customer starts a claim with no arguments, so they cannot supply their own reference or amount');

-- ---------------------------------------------------------------------------
-- G. PHASES 14, 20 and 21: one open claim per account, and one reference can
--    buy exactly one approval, searched the way a bank statement is searched —
--    case-folded, and only while the claim is in a reviewed state.
-- ---------------------------------------------------------------------------
select is(
    (select indexdef from pg_indexes
      where schemaname = 'public' and indexname = 'purchase_claims_owner_open_unique'),
    $q$CREATE UNIQUE INDEX purchase_claims_owner_open_unique ON public.purchase_claims USING btree (owner_id) WHERE (status = ANY (ARRAY['DRAFT'::text, 'PENDING_REVIEW'::text]))$q$,
    'an account cannot hold two open claims at once, so a repeated start cannot queue two payments');

select is(
    (select indexdef from pg_indexes
      where schemaname = 'public' and indexname = 'purchase_claims_utr_reference_unique'),
    $q$CREATE UNIQUE INDEX purchase_claims_utr_reference_unique ON public.purchase_claims USING btree (upper(utr_reference)) WHERE (status = ANY (ARRAY['PENDING_REVIEW'::text, 'APPROVED'::text, 'REJECTED'::text]))$q$,
    'one submitted payment reference cannot be used by two claims, whatever case it was typed in');

select is(
    (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.purchase_claims'::regclass and conname = 'purchase_claims_claim_id_format_check'),
    $q$CHECK ((claim_id ~ '^DW-F-[A-Z0-9]{8,32}$'::text))$q$,
    'a claim id is a DueWeave-issued reference, not free text a customer can shape');
