-- Stage 5 (current roadmap) — the money and promise lifecycle, pinned in the
-- database itself (pgTAP).
--
-- Run with: pnpm test:db   (supabase test db)
--
-- The live suite (tests/stage5-local-lifecycle.test.ts) proves what the ledger
-- does end to end: which outcome a payment produces, which retry replays instead
-- of writing twice, which race still ends exactly right. This file pins the
-- structures that make those answers the ONLY answers a browser can get — the
-- invariants that moved out of TypeScript and into the table, the request-id
-- keys behind idempotency, the guards behind the workflow RPCs, and the
-- privileges of the two new lifecycle routines.
--
-- As in the Stage 3 and Stage 4 files: no fixtures and no fake tables. Every
-- expectation below inspects an object the migrations actually created, and the
-- behavioural tests either run a pure function on a composite value or run an
-- audit query over rows the tests themselves do not write. The constraint text
-- was measured from the executed database, not retyped from the migration.

set search_path = public, extensions, tap, core;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- ---------------------------------------------------------------------------
-- A. The lifecycle's routines exist, and only the browser-facing ones are
--    reachable from the browser.
-- ---------------------------------------------------------------------------
select has_function('public', 'cancel_receivable', array['uuid', 'text']::name[],
    'cancel_receivable exists: closing an unpaid invoice is a named, auditable act');
select has_function('public', 'cancel_promise', array['uuid', 'text']::name[],
    'cancel_promise exists: withdrawing a commitment is a named, auditable act');
select has_function('public', 'record_payment', array['uuid', 'bigint', 'date', 'text', 'text', 'uuid', 'text']::name[],
    'record_payment takes a request id — the sixth parameter, ahead of the optional note');
-- create_promise gained p_made_on between the amount and the promised date; the
-- chronology file stage5_02_promise_chronology.sql pins what that date is for.
select has_function('public', 'create_promise', array['uuid', 'bigint', 'date', 'date', 'text', 'text', 'uuid']::name[],
    'create_promise takes both business dates: the day the promise was made and the day it is due');

-- The request id has NO default on purpose: a money write that cannot identify
-- itself is refused rather than accepted as non-idempotent. One overload only,
-- so there is no older signature left behind for a caller to slip through.
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'record_payment'
             and p.pronargs = 7 and p.pronargdefaults = 1), 1::bigint,
          'exactly one record_payment exists, taking seven parameters of which only the note is optional');

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'create_promise'
             and p.pronargs = 7 and p.pronargdefaults = 0), 1::bigint,
          'exactly one create_promise exists, taking seven parameters none of which is optional');

select ok(has_function_privilege('authenticated', 'public.cancel_receivable(uuid, text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.cancel_promise(uuid, text)', 'EXECUTE'),
          'the signed-in browser role may call both lifecycle routines');

select ok(not has_function_privilege('anon', 'public.cancel_receivable(uuid, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.cancel_promise(uuid, text)', 'EXECUTE'),
          'the anonymous role may call neither');

-- The reconciliation machinery reads a receivable's whole history and writes
-- outcomes, so exposing it would hand the browser a lever on the ledger. The
-- Stage 3 fail-closed default-privileges trigger strips the implicit EXECUTE
-- from every one of them and this migration re-grants only the six browser
-- routines — so this is a measurement, not an assumption.
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('current_business_date', 'promise_settled_amount', 'promise_outcome',
                               'apply_promise_outcome', 'settle_promises_for_receivable', 'settle_promises_for_owner')
             and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))),
          0::bigint,
          'none of the six internal lifecycle helpers is executable by anon or authenticated');

-- ---------------------------------------------------------------------------
-- B. One business date, and it is not a preference.
-- ---------------------------------------------------------------------------
select is(public.current_business_date(), (timezone('Asia/Kolkata', now()))::date,
          'the database''s today is the Asia/Kolkata calendar date the client also uses');

select is((select array_to_string(proconfig, ',') from pg_proc
           where oid = 'public.current_business_date()'::regprocedure), 'search_path=""',
          'current_business_date pins an empty search path, so no other schema can re-point it');

select is((select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.profiles'::regclass and conname = 'profiles_timezone_check'),
          'CHECK ((timezone = ''Asia/Kolkata''::text))',
          'profiles.timezone is constrained to the one calendar the ledger works in');

-- ---------------------------------------------------------------------------
-- C. Money invariants now live in the table. Each definition below is pinned
--    verbatim because a CHECK that has silently drifted is worse than none: the
--    application believes the database is holding the line. Every clause is
--    row-local, which is what a CHECK may express; cross-row rules (balance
--    against payment history, promise against money) stay in the guards and the
--    workflow RPCs, where they can see more than one row.
-- ---------------------------------------------------------------------------
-- Two near-duplicate receivable CHECKs had drifted apart, one permitting a
-- status the other did not recognise. The duplicate is gone rather than shadowed.
select is((select count(*) from pg_constraint where conrelid = 'public.receivables'::regclass
           and conname = 'receivables_check1'), 0::bigint,
          'the unnamed duplicate status constraint is no longer on the table');

select is((select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.receivables'::regclass and conname = 'receivables_status_check'),
          'CHECK ((status = ANY (ARRAY[''OPEN''::text, ''PARTIALLY_PAID''::text, ''PAID''::text, ''CANCELLED''::text])))',
          'the receivable status list is exactly the four states the lifecycle can reach');

select is((select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.receivables'::regclass and conname = 'receivables_financial_state_check'),
          'CHECK ((((status = ''OPEN''::text) AND (outstanding_paise = amount_due_paise)) OR ((status = ''PARTIALLY_PAID''::text) AND (outstanding_paise > 0) AND (outstanding_paise < amount_due_paise)) OR ((status = ''PAID''::text) AND (outstanding_paise = 0)) OR ((status = ''CANCELLED''::text) AND (outstanding_paise = 0))))',
          'one constraint states the whole legal balance-versus-status space, including a cancelled row owing nothing');

select is((select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.receivables'::regclass and conname = 'receivables_outstanding_not_negative'),
          'CHECK ((outstanding_paise >= 0))',
          'nothing is ever owed less than nothing');

select is((select count(*) from pg_constraint
           where conname like 'receivables_%' and pg_get_constraintdef(oid) ilike '%WRITTEN_OFF%'), 0::bigint,
          'WRITTEN_OFF is unreachable: no constraint, and so no row, may hold a state the ledger cannot explain');

-- The ceiling the client can type is the ceiling the database stores. A bigint
-- column on its own would accept amounts no screen can display.
select is((select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.payments'::regclass and conname = 'payments_amount_paise_check'),
          'CHECK (((amount_paise > 0) AND (amount_paise <= ''900000000000000''::bigint)))',
          'a receipt is whole paise, greater than zero, and within the recorded ceiling');

select is((select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.promises'::regclass and conname = 'promises_promised_amount_paise_check'),
          'CHECK (((promised_amount_paise > 0) AND (promised_amount_paise <= ''900000000000000''::bigint)))',
          'a promise carries the same floor and the same ceiling');

select is((select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.promises'::regclass and conname = 'promises_resolution_state_check'),
          'CHECK ((((status = ''ACTIVE''::text) AND (resolved_at IS NULL)) OR ((status <> ''ACTIVE''::text) AND (resolved_at IS NOT NULL))))',
          'an outcome without a timestamp, or an open commitment with one, cannot be stored');

select is((select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.activities'::regclass and conname = 'activities_type_check'),
          'CHECK ((type = ANY (ARRAY[''FOLLOW_UP_RECORDED''::text, ''PROMISE_CREATED''::text, ''PROMISE_STATUS_CHANGED''::text, ''PROMISE_CANCELLED''::text, ''PROMISE_CORRECTED''::text, ''PAYMENT_RECORDED''::text, ''RECEIVABLE_CREATED''::text, ''RECEIVABLE_CANCELLED''::text, ''SNOOZED''::text, ''NOTE_ADDED''::text])))',
          'every act this stage records has its own timeline vocabulary, additively and without orphans');

-- ---------------------------------------------------------------------------
-- D. Idempotency is a database property: one request id, one money write.
-- ---------------------------------------------------------------------------
select has_column('public', 'payments', 'request_id', 'a payment remembers the submission that created it');
select has_column('public', 'promises', 'request_id', 'a promise remembers the submission that created it');
select is((select data_type from information_schema.columns
           where table_schema = 'public' and table_name = 'payments' and column_name = 'request_id'), 'uuid',
          'the request identity is a uuid, never free text a form could stumble back into');

-- Partial and owner-scoped on purpose: rows written before this stage carry no
-- key and must not collide with each other, and one customer's retry key must
-- never be able to swallow another customer's write.
select is((select count(*) from pg_class c join pg_index i on i.indexrelid = c.oid
           where c.relname in ('payments_owner_request_key', 'promises_owner_request_key')
             and i.indisunique and c.relkind = 'i'
             and pg_get_indexdef(c.oid) ~~ '%(owner_id, request_id)%'
             and pg_get_indexdef(c.oid) ~~ '%WHERE (request_id IS NOT NULL)'), 2::bigint,
          'both request-id keys are unique, per owner, and ignore unkeyed history');

-- ---------------------------------------------------------------------------
-- E. The guards behind the workflow RPCs. A signed-in browser cannot reach any
--    of these paths directly — Stage 3 took the table write privileges away, and
--    stage3_02_privileges.sql pins that — so what is measured here is that the
--    second layer exists and fires on the right event, because a SECURITY
--    DEFINER body is the only thing that ever reaches it.
-- ---------------------------------------------------------------------------
select is((select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where not t.tgisinternal
             and ((t.tgname = 'payments_guard_facts' and c.relname = 'payments')
               or (t.tgname = 'promises_guard_history' and c.relname = 'promises')
               or (t.tgname = 'receivables_guard_financial_fields' and c.relname = 'receivables'))), 3::bigint,
          'the future-dated-receipt guard, the promise-history guard and the financial-field guard are all attached');

select is((select count(*) from pg_trigger t
           where t.tgname = 'payments_guard_facts'
             and (t.tgtype::integer & 2) = 2 and (t.tgtype::integer & 4) = 4
             and (t.tgtype::integer & 16) = 0 and (t.tgtype::integer & 8) = 0), 1::bigint,
          'the payment-fact guard fires before insert only: a receipt dated in the future cannot be written by any path');

select is((select count(*) from pg_trigger t
           where t.tgname = 'promises_guard_history'
             and (t.tgtype::integer & 2) = 2
             and (t.tgtype::integer & 16) = 16 and (t.tgtype::integer & 8) = 8), 1::bigint,
          'the promise-history guard covers update and delete: history is neither rewritten nor removed');

select is((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
           where t.tgname = 'receivables_guard_financial_fields' and p.proname = 'guard_receivable_financial_fields'
             and (t.tgtype::integer & 16) = 16
             and array_to_string(p.proconfig, ',') like 'search_path=public%'), 1::bigint,
          'the financial-field guard fires on update and resolves from public explicitly rather than from whatever path a caller left behind');

-- ---------------------------------------------------------------------------
-- F. The reconciliation rule, executed.
--    This is the query the stage's report claims the ledger satisfies. Against
--    the live database it must find nothing; against the deliberately
--    contradictory rows below it must find exactly the faults planted — an
--    audit that cannot fail is not an audit. Nothing is written for any of it.
--
--    A cancelled receivable is its own case, and executing this audit is what
--    caught that: cancellation preserves amount_due and zeroes the balance with
--    no payments behind it, so "outstanding = due - paid" is true of every state
--    EXCEPT that one. Reading cancelled rows as drift would have made the audit
--    cry wolf on a healthy ledger.
-- ---------------------------------------------------------------------------
select is((select count(*) from (
            select 100::bigint as amount_due, 70::bigint as outstanding, 30::bigint as paid, 'PARTIALLY_PAID'::text as status
            union all select 100::bigint, 50::bigint, 50::bigint, 'PARTIALLY_PAID'::text
            union all select 100::bigint, 0::bigint, 100::bigint, 'PAID'::text
            union all select 100::bigint, 100::bigint, 0::bigint, 'OPEN'::text
            union all select 100::bigint, 0::bigint, 0::bigint, 'CANCELLED'::text
          ) v
          where v.outstanding < 0
             or (v.status <> 'CANCELLED' and v.outstanding <> v.amount_due - v.paid)
             or (v.status = 'CANCELLED' and (v.outstanding <> 0 or v.paid <> 0))
             or (v.status = 'OPEN' and v.outstanding <> v.amount_due)
             or (v.status = 'PARTIALLY_PAID' and (v.outstanding <= 0 or v.outstanding >= v.amount_due))
             or (v.status = 'PAID' and v.outstanding <> 0)), 0::bigint,
          'the audit accepts every legal balance-and-status combination, including a cancelled invoice whose amount still stands');

select is((select count(*) from (
            select 100::bigint as amount_due, 60::bigint as outstanding, 30::bigint as paid, 'PARTIALLY_PAID'::text as status
            union all select 100::bigint, 0::bigint, 40::bigint, 'CANCELLED'::text
            union all select 100::bigint, 100::bigint, 100::bigint, 'PAID'::text
            union all select 100::bigint, 70::bigint, 30::bigint, 'OPEN'::text
            union all select 100::bigint, -5::bigint, 105::bigint, 'PAID'::text
            union all select 100::bigint, 40::bigint, 0::bigint, 'CANCELLED'::text
          ) v
          where v.outstanding < 0
             or (v.status <> 'CANCELLED' and v.outstanding <> v.amount_due - v.paid)
             or (v.status = 'CANCELLED' and (v.outstanding <> 0 or v.paid <> 0))
             or (v.status = 'OPEN' and v.outstanding <> v.amount_due)
             or (v.status = 'PARTIALLY_PAID' and (v.outstanding <= 0 or v.outstanding >= v.amount_due))
             or (v.status = 'PAID' and v.outstanding <> 0)), 6::bigint,
          'the same audit reports every one of six planted faults: a drifted balance, a cancelled row with receipts behind it, a paid row that still owes, an open row with a reduced balance, a negative amount, and a cancelled row that still owes');

select is((select count(*) from public.receivables r
           where (r.status <> 'CANCELLED' and r.outstanding_paise <> r.amount_due_paise - coalesce((select sum(p.amount_paise) from public.payments p where p.receivable_id = r.id), 0))
              or (r.status = 'CANCELLED' and (r.outstanding_paise <> 0 or exists (select 1 from public.payments p where p.receivable_id = r.id)))
              or (r.status = 'OPEN' and r.outstanding_paise <> r.amount_due_paise)
              or (r.status = 'PARTIALLY_PAID' and (r.outstanding_paise <= 0 or r.outstanding_paise >= r.amount_due_paise))
              or (r.status = 'PAID' and r.outstanding_paise <> 0)), 0::bigint,
          'and over the real database, as it stands, it finds nothing');

-- ---------------------------------------------------------------------------
-- G. The truth table, executed against a value rather than a fixture.
--    promise_outcome() accepts a promises row as a parameter, so it can be
--    shown a commitment without the ledger being touched: no payments exist for
--    the synthetic receivable id, which is exactly the case the deadline decides.
-- ---------------------------------------------------------------------------
select is(public.promise_outcome(
            jsonb_populate_record(null::public.promises,
              jsonb_build_object('receivable_id', '00000000-0000-4000-8000-0000000000aa'::uuid,
                                 'created_at', now() - interval '1 hour',
                                 'promised_date', public.current_business_date() + 3,
                                 'promised_amount_paise', 500000::bigint)),
            public.current_business_date()),
          'ACTIVE', 'a promise whose day has not arrived and has nothing paid toward it is still open');

select is(public.promise_outcome(
            jsonb_populate_record(null::public.promises,
              jsonb_build_object('receivable_id', '00000000-0000-4000-8000-0000000000aa'::uuid,
                                 'created_at', now() - interval '1 hour',
                                 'promised_date', public.current_business_date(),
                                 'promised_amount_paise', 500000::bigint)),
            public.current_business_date()),
          'ACTIVE', 'the promised day itself is not yet past — the deadline is inclusive, so a customer is not failed on it');

select is(public.promise_outcome(
            jsonb_populate_record(null::public.promises,
              jsonb_build_object('receivable_id', '00000000-0000-4000-8000-0000000000aa'::uuid,
                                 'created_at', now() - interval '1 hour',
                                 'promised_date', public.current_business_date() - 1,
                                 'promised_amount_paise', 500000::bigint)),
            public.current_business_date()),
          'BROKEN', 'the day after an unfunded promise is a broken promise, whatever has been typed since');

select is(public.promise_settled_amount(
            jsonb_populate_record(null::public.promises,
              jsonb_build_object('receivable_id', '00000000-0000-4000-8000-0000000000aa'::uuid,
                                 'created_at', now() - interval '1 hour',
                                 'promised_date', public.current_business_date() + 3,
                                 'promised_amount_paise', 500000::bigint))),
          0::bigint, 'attribution over no receipts is zero rather than null — the matrix always has a number to compare');

-- The four cells above are samples. These sweep the whole deadline half of the
-- table — 2,403 positions, no money attributable to any of them — which is only
-- reachable this cheaply because the function takes a value instead of a row.
-- The money half depends on receipts that have to exist as real rows, so those
-- branches are proven against live data in tests/stage5-local-lifecycle.test.ts.
with sweep as (
  select g.d, public.promise_outcome(
           jsonb_populate_record(null::public.promises,
             jsonb_build_object('receivable_id', '00000000-0000-4000-8000-0000000000aa'::uuid,
                                'created_at', now() - interval '1 hour',
                                'promised_date', public.current_business_date() + g.d,
                                'promised_amount_paise', a.amount)),
           public.current_business_date()) as outcome
    from generate_series(-400, 400) as g(d), (values (1::bigint), (500000), (500001)) as a(amount)
)
select is((select count(*) from sweep where outcome not in ('ACTIVE', 'BROKEN')), 0::bigint,
          'at any distance from today an unfunded promise is only ACTIVE or BROKEN — never KEPT, and never a human act');

with sweep as (
  select g.d, public.promise_outcome(
           jsonb_populate_record(null::public.promises,
             jsonb_build_object('receivable_id', '00000000-0000-4000-8000-0000000000aa'::uuid,
                                'created_at', now() - interval '1 hour',
                                'promised_date', public.current_business_date() + g.d,
                                'promised_amount_paise', a.amount)),
           public.current_business_date()) as outcome
    from generate_series(-400, 400) as g(d), (values (1::bigint), (500000), (500001)) as a(amount)
)
select is((select count(*) from sweep where (outcome = 'ACTIVE') <> (sweep.d >= 0)), 0::bigint,
          'and ACTIVE holds on exactly the inclusive side of the promised day, at every one of those positions');

select * from finish();
