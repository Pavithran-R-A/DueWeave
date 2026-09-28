-- Stage 8 — the reviewer boundary (pgTAP).
--
-- Run with: pnpm test:db   (supabase test db)
--
-- Founder access is granted by a person, and only by a person on a list. That
-- list is `founder_admins`, and the only thing that consults it is
-- `assert_founder_admin()`, called from inside the reviewer routines. This file
-- pins the shape of that boundary in the catalog: which routines are reviewer
-- routines, that every one of them runs as a definer with a fixed search path,
-- that nothing is reachable anonymously, and that the allowlist cannot outlive
-- the account it names or be widened by the person it lists.
--
-- Stage 3's `stage3_01_rls_structure.sql` and `stage3_02_privileges.sql` already
-- pin the table-level grants, RLS state and the full callable set, so nothing
-- here repeats them; these are the Founder-specific structural facts Stage 8
-- relies on. Catalog reads only — no row is written, so the file passes the same
-- way on a fresh replay and on a database carrying local fixtures.

set search_path = public, extensions, tap, core;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- ---------------------------------------------------------------------------
-- A. The allowlist is a list of accounts and nothing else: one row per user, no
--    extra column that could carry a power, and a reviewer row disappears with
--    the account it names.
-- ---------------------------------------------------------------------------
select is(
    (select array_agg(column_name::text order by column_name::text)
       from information_schema.columns
      where table_schema = 'public' and table_name = 'founder_admins'),
    array['created_at', 'created_by', 'note', 'user_id'],
    'the reviewer allowlist stores an account, who added it, when, and a note, with no room for a further power');

select is(
    (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.founder_admins'::regclass and conname = 'founder_admins_pkey'),
    'PRIMARY KEY (user_id)',
    'one account can be a reviewer exactly once, so a duplicated row cannot stack authority');

select is(
    (select confdeltype from pg_constraint
      where conrelid = 'public.founder_admins'::regclass and conname = 'founder_admins_user_id_fkey'),
    'c',
    'a reviewer row is removed with the account it names, so a deleted reviewer cannot keep queue access');

select is(
    (select confdeltype from pg_constraint
      where conrelid = 'public.founder_admins'::regclass and conname = 'founder_admins_created_by_fkey'),
    'n',
    'removing the account that added a reviewer keeps the allowlist row and nulls its provenance rather than cascading a second removal');

-- ---------------------------------------------------------------------------
-- B. The reviewer half of the Founder surface is exactly the seven routines that
--    assert the allowlist, and the customer half contains none of them.
-- ---------------------------------------------------------------------------
select is(
    (select array_agg(p.proname::text order by p.proname::text)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '%founder%'
        and pg_get_functiondef(p.oid) like '%perform public.assert_founder_admin()%'),
    array['approve_founder_claim', 'get_founder_funnel', 'list_pending_founder_claims',
          'list_rejected_founder_claims', 'reconsider_founder_claim', 'reject_founder_claim',
          'revoke_founder_entitlement'],
    'seven routines decide or read the review queue, and each one checks the allowlist itself');

select is(
    (select array_agg(p.proname::text order by p.proname::text)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '%founder%'
        and pg_get_functiondef(p.oid) not like '%perform public.assert_founder_admin()%'),
    array['assert_founder_admin', 'cancel_founder_claim', 'create_founder_claim', 'get_founder_offer',
          'is_founder_admin', 'record_founder_upgrade_view', 'submit_founder_payment'],
    'the customer-facing half is the remaining seven, and no routine joined it by inheriting reviewer powers');

select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '%founder%'),
    14::bigint,
    'no eleventh way into the Founder surface was added beyond the seven customer and seven reviewer routines');

-- ---------------------------------------------------------------------------
-- C. Every Founder routine runs as a definer with a pinned search path, so the
--    privileged tables it writes are reached by its own grant and not by a
--    caller-supplied object of the same name.
-- ---------------------------------------------------------------------------
select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '%founder%' and p.prosecdef),
    14::bigint,
    'every Founder routine is SECURITY DEFINER, the only way it can write a table the caller cannot touch');

select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '%founder%'
        and p.proconfig @> array['search_path=public, auth, pg_temp']),
    14::bigint,
    'every Founder routine pins its search path to public, auth and pg_temp');

-- ---------------------------------------------------------------------------
-- D. Nothing in the Founder surface is reachable without a session, and the
--    allowlist helpers are not callable over the API at all.
-- ---------------------------------------------------------------------------
select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '%founder%'
        and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('public', p.oid, 'EXECUTE'))),
    0::bigint,
    'no Founder routine is executable anonymously or by PUBLIC');

select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('is_founder_admin', 'assert_founder_admin')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    0::bigint,
    'an account cannot ask the API whether it is a reviewer, so the allowlist stays invisible to probing');

-- ---------------------------------------------------------------------------
-- E. The queue readers cannot write, which is what makes them safe to call on
--    every screen load; only the deciding routines are volatile.
-- ---------------------------------------------------------------------------
select is(
    (select array_agg(p.proname::text order by p.proname::text)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '%founder%' and p.provolatile = 's'),
    array['assert_founder_admin', 'get_founder_funnel', 'get_founder_offer', 'is_founder_admin',
          'list_pending_founder_claims', 'list_rejected_founder_claims'],
    'every Founder reader is declared STABLE, so a screen refresh cannot change a claim');

select is(
    (select array_agg(p.proname::text order by p.proname::text)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '%founder%' and p.provolatile = 'v'),
    array['approve_founder_claim', 'cancel_founder_claim', 'create_founder_claim',
          'reconsider_founder_claim', 'record_founder_upgrade_view', 'reject_founder_claim',
          'revoke_founder_entitlement', 'submit_founder_payment'],
    'exactly the eight writing routines are volatile, so a write is always an explicit decision');
