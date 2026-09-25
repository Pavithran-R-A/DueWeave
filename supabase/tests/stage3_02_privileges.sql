-- Stage 3 / Phase 6 — executed privilege posture (pgTAP).
--
-- Run with: pnpm test:db   (supabase test db)
--
-- These assertions encode the Stage 3 authorization design (Phase 4): the
-- browser roles are only ever allowed the narrow surface the application
-- actually uses. Every expectation was written from the design matrix, not
-- from the current catalog, so an executed defect shows up as a failure here.

set search_path = public, extensions, tap, core;
create extension if not exists pgtap with schema extensions;

select plan(61);

-- ---------------------------------------------------------------------------
-- A. anon holds no table privilege at all. RLS is not the only barrier:
--    an anonymous request must be refused by the privilege layer too.
-- ---------------------------------------------------------------------------
select table_privs_are('public', 'profiles', 'anon', array[]::name[],
    'anon holds no privilege on profiles');
select table_privs_are('public', 'clients', 'anon', array[]::name[],
    'anon holds no privilege on clients');
select table_privs_are('public', 'receivables', 'anon', array[]::name[],
    'anon holds no privilege on receivables');
select table_privs_are('public', 'promises', 'anon', array[]::name[],
    'anon holds no privilege on promises');
select table_privs_are('public', 'payments', 'anon', array[]::name[],
    'anon holds no privilege on payments');
select table_privs_are('public', 'activities', 'anon', array[]::name[],
    'anon holds no privilege on activities');
select table_privs_are('public', 'promise_events', 'anon', array[]::name[],
    'anon holds no privilege on promise_events');
select table_privs_are('public', 'entitlements', 'anon', array[]::name[],
    'anon holds no privilege on entitlements');
select table_privs_are('public', 'purchase_claims', 'anon', array[]::name[],
    'anon holds no privilege on purchase_claims');
select table_privs_are('public', 'analytics_events', 'anon', array[]::name[],
    'anon holds no privilege on analytics_events');
select table_privs_are('public', 'founder_offer_config', 'anon', array[]::name[],
    'anon holds no privilege on founder_offer_config');
select table_privs_are('public', 'founder_admins', 'anon', array[]::name[],
    'anon holds no privilege on founder_admins');
select table_privs_are('public', 'founder_audit_events', 'anon', array[]::name[],
    'anon holds no privilege on founder_audit_events');

-- ---------------------------------------------------------------------------
-- B. authenticated holds reads only, plus the single documented owner-scoped
--    profile write the product contract supports. All financial writes go
--    through protected RPCs, never through a table privilege.
-- ---------------------------------------------------------------------------
select table_privs_are('public', 'profiles', 'authenticated', array['SELECT', 'UPDATE'],
    'authenticated may read and update its own profile row only');
select table_privs_are('public', 'clients', 'authenticated', array['SELECT'],
    'authenticated may only read clients');
select table_privs_are('public', 'receivables', 'authenticated', array['SELECT'],
    'authenticated may only read receivables');
select table_privs_are('public', 'promises', 'authenticated', array['SELECT'],
    'authenticated may only read promises');
select table_privs_are('public', 'payments', 'authenticated', array['SELECT'],
    'authenticated may only read payments');
select table_privs_are('public', 'activities', 'authenticated', array['SELECT'],
    'authenticated may only read activities');
select table_privs_are('public', 'promise_events', 'authenticated', array['SELECT'],
    'authenticated may only read promise_events');
select table_privs_are('public', 'entitlements', 'authenticated', array['SELECT'],
    'authenticated may only read entitlements');
select table_privs_are('public', 'purchase_claims', 'authenticated', array['SELECT'],
    'authenticated may only read purchase_claims');
select table_privs_are('public', 'analytics_events', 'authenticated', array['SELECT'],
    'authenticated may only read analytics events');
select table_privs_are('public', 'founder_offer_config', 'authenticated', array[]::name[],
    'authenticated holds no privilege on founder_offer_config');
select table_privs_are('public', 'founder_admins', 'authenticated', array[]::name[],
    'authenticated holds no privilege on founder_admins');
select table_privs_are('public', 'founder_audit_events', 'authenticated', array[]::name[],
    'authenticated holds no privilege on founder_audit_events');

-- Administrative maintenance privileges must never reach a browser role.
select is((select count(*)
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           cross join lateral aclexplode(c.relacl) a
           join pg_roles g on g.oid = a.grantee
           where n.nspname = 'public' and c.relkind = 'r'
             and g.rolname in ('anon', 'authenticated')
             and a.privilege_type not in ('SELECT', 'UPDATE')), 0::bigint,
    'no browser role holds DELETE, INSERT, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on a table');

select is((select count(*)
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           cross join lateral aclexplode(c.relacl) a
           where n.nspname = 'public' and c.relkind = 'r' and a.grantee = 0), 0::bigint,
    'no private table is granted to the PUBLIC pseudo-role');

-- The local admin fixture keeps full access; hardening must not break it.
select table_privs_are('public', 'founder_admins', 'service_role',
    array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
    'service_role retains full control of founder_admins');
select table_privs_are('public', 'entitlements', 'service_role',
    array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
    'service_role retains full control of entitlements');

-- ---------------------------------------------------------------------------
-- C. Function surface. PostgREST exposes every executable public function as
--    /rpc/<name>, so EXECUTE grants define the callable API.
-- ---------------------------------------------------------------------------
select is((select coalesce(array_agg(p.proname::text order by p.proname), array[]::text[])
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
    array[]::text[],
    'anon can execute no public function, so no RPC is reachable anonymously');

select is((select coalesce(array_agg(p.proname::text order by p.proname), array[]::text[])
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    -- The approved RPC set, in name order: the eight core workflow routines,
    -- five self-scoped founder purchase routines, and seven founder review
    -- routines that each re-check assert_founder_admin() internally.
    array[
        'approve_founder_claim', 'cancel_founder_claim', 'create_client',
        'create_client_and_receivable', 'create_founder_claim', 'create_promise',
        'create_receivable', 'get_founder_funnel', 'get_founder_offer',
        'list_pending_founder_claims', 'list_rejected_founder_claims',
        'mark_due_promises_broken', 'reconsider_founder_claim', 'record_contacted',
        'record_founder_upgrade_view', 'record_payment', 'reject_founder_claim',
        'revoke_founder_entitlement', 'snooze_receivable', 'submit_founder_payment'
    ]::text[],
    'authenticated can execute exactly the 20 RPCs the application calls');

select is(has_function_privilege('authenticated', 'public.is_founder_admin()', 'EXECUTE'), false,
    'is_founder_admin() is internal and not callable over RPC');
select is(has_function_privilege('authenticated', 'public.assert_founder_admin()', 'EXECUTE'), false,
    'assert_founder_admin() is internal and not callable over RPC');
select is(has_function_privilege('authenticated', 'public.delete_my_business_data()', 'EXECUTE'), false,
    'delete_my_business_data() stays revoked for ordinary accounts');
select is(has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'), false,
    'the signup trigger function is not callable over RPC');

select is((select count(*)
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           left join lateral aclexplode(p.proacl) a on true
           where n.nspname = 'public' and (p.proacl is null or a.grantee = 0)), 0::bigint,
    'no public function leaves default or PUBLIC EXECUTE in place');

-- ---------------------------------------------------------------------------
-- D. Future objects must start CLOSED. ALTER DEFAULT PRIVILEGES decides what a
--    table, function or sequence created by a LATER migration inherits, so one
--    automatic browser privilege here is a hole that only opens later — most
--    dangerously on a table whose migration forgets to enable RLS, where the
--    read would then be permitted for every signed-in account.
--
--    Stage 3's first repair (D6) removed automatic *writes* but still installed
--    `authenticated SELECT` on every future table. That leftover is defect D10,
--    and these assertions were strengthened to require zero browser privileges
--    before the repair migration existed.
-- ---------------------------------------------------------------------------
select is((select count(*)
           from pg_default_acl d
           join pg_roles r on r.oid = d.defaclrole
           cross join lateral aclexplode(d.defaclacl) a
           join pg_roles g on g.oid = a.grantee
           where r.rolname = 'postgres'
             and d.defaclnamespace = 'public'::regnamespace::oid
             and g.rolname in ('anon', 'authenticated')), 0::bigint,
    'the migration role installs no privilege of any kind on a future public object');

select is((select count(*)
           from pg_default_acl d
           join pg_roles r on r.oid = d.defaclrole
           cross join lateral aclexplode(d.defaclacl) a
           where r.rolname = 'postgres'
             and d.defaclnamespace = 'public'::regnamespace::oid
             and a.grantee = 0), 0::bigint,
    'default privileges for the migration role never target the PUBLIC pseudo-role');

-- Per object kind, so a reopened default names itself in the failure output.
select is((select coalesce(array_agg(distinct pg_get_userbyid(a.grantee)::text
                                      order by pg_get_userbyid(a.grantee)::text), '{}'::text[])
           from pg_default_acl d
           join pg_roles r on r.oid = d.defaclrole
           cross join lateral aclexplode(d.defaclacl) a
           where r.rolname = 'postgres' and d.defaclobjtype = 'r'
             and d.defaclnamespace = 'public'::regnamespace::oid
             and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid)),
    '{}'::text[],
    'a future public table inherits no browser-role privilege');

select is((select coalesce(array_agg(distinct pg_get_userbyid(a.grantee)::text
                                      order by pg_get_userbyid(a.grantee)::text), '{}'::text[])
           from pg_default_acl d
           join pg_roles r on r.oid = d.defaclrole
           cross join lateral aclexplode(d.defaclacl) a
           where r.rolname = 'postgres' and d.defaclobjtype = 'f'
             and d.defaclnamespace = 'public'::regnamespace::oid
             and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid)),
    '{}'::text[],
    'a future public function inherits no browser-role EXECUTE');

select is((select coalesce(array_agg(distinct pg_get_userbyid(a.grantee)::text
                                      order by pg_get_userbyid(a.grantee)::text), '{}'::text[])
           from pg_default_acl d
           join pg_roles r on r.oid = d.defaclrole
           cross join lateral aclexplode(d.defaclacl) a
           where r.rolname = 'postgres' and d.defaclobjtype = 'S'
             and d.defaclnamespace = 'public'::regnamespace::oid
             and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid)),
    '{}'::text[],
    'a future public sequence inherits no browser-role privilege');

-- ---------------------------------------------------------------------------
-- E. The recorded default is only evidence; what matters is the ACL a real
--    object created afterwards actually carries. One of each kind is created
--    here with no GRANT statement at all and then probed. The section that
--    follows drops every object again, so nothing reaches the application
--    schema — the last two assertions of this file prove the cleanup.
--
--    This section is what caught defect D11, which no pg_default_acl
--    inspection could see: PostgreSQL stamps an implicit PUBLIC EXECUTE onto
--    every newly created function, and ALTER DEFAULT PRIVILEGES ... REVOKE
--    (measured four ways) does not remove it. Without a preventive repair a
--    future function would be anonymously callable over /rpc.
-- ---------------------------------------------------------------------------
drop function if exists public.stage3_acl_probe_function();
drop table if exists public.stage3_acl_probe_table;
drop sequence if exists public.stage3_acl_probe_sequence;

create table public.stage3_acl_probe_table (id bigint, owner_id uuid);
create sequence public.stage3_acl_probe_sequence;
create function public.stage3_acl_probe_function() returns bigint
language sql security invoker set search_path = public, pg_temp
as $$ select count(*) from public.stage3_acl_probe_table $$;

select is(has_table_privilege('anon', 'public.stage3_acl_probe_table', 'SELECT'), false,
    'anon cannot read a table created by a later migration');
select is(has_table_privilege('authenticated', 'public.stage3_acl_probe_table', 'SELECT'), false,
    'authenticated cannot read a table created by a later migration');
select is(has_table_privilege('authenticated', 'public.stage3_acl_probe_table', 'INSERT'), false,
    'authenticated cannot write a table created by a later migration');
select is((select count(*) from aclexplode(
              (select relacl from pg_class where oid = 'public.stage3_acl_probe_table'::regclass)) a
           where a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0)), 0::bigint,
    'a future table carries no browser-role or PUBLIC entry in its own ACL');

select is((select count(*) from aclexplode(
              (select relacl from pg_class where oid = 'public.stage3_acl_probe_sequence'::regclass)) a
           where a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0)), 0::bigint,
    'a future sequence carries no browser-role or PUBLIC entry in its own ACL');
select is(has_sequence_privilege('authenticated', 'public.stage3_acl_probe_sequence', 'USAGE'), false,
    'authenticated cannot use a sequence created by a later migration');

select is(has_function_privilege('anon', 'public.stage3_acl_probe_function()', 'EXECUTE'), false,
    'a future function is not anonymously callable');
select is(has_function_privilege('authenticated', 'public.stage3_acl_probe_function()', 'EXECUTE'), false,
    'a future function is not callable by an ordinary account');
select is(has_function_privilege('public', 'public.stage3_acl_probe_function()', 'EXECUTE'), false,
    'a future function does not inherit the implicit PUBLIC EXECUTE');
select is((select count(*) from aclexplode(
              (select proacl from pg_proc where oid = 'public.stage3_acl_probe_function()'::regprocedure)) a
           where a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0)), 0::bigint,
    'a future function carries no browser-role or PUBLIC entry in its own ACL');

-- Fail-closed must not mean fail-broken: the roles that legitimately own and
-- operate the schema keep working on the very same object.
select is(has_function_privilege('postgres', 'public.stage3_acl_probe_function()', 'EXECUTE'), true,
    'the owner still executes a future function it created');
select is(has_function_privilege('service_role', 'public.stage3_acl_probe_function()', 'EXECUTE'), true,
    'service_role still executes a future function');

-- ---------------------------------------------------------------------------
-- F. Explicit opt-in has to keep working, so the closed default cannot be an
--    excuse to bypass the grant step later. A second table is created with no
--    automatic access, then deliberately exposed with GRANT + RLS + a policy
--    anchored to auth.uid(), and a real authenticated principal is made to
--    resolve it — proving DEFAULT = CLOSED and GRANT + POLICY = ACCESSIBLE, and
--    that the policy still narrows the row set rather than exposing the table.
-- ---------------------------------------------------------------------------
drop table if exists public.stage3_optin_probe_table;
create table public.stage3_optin_probe_table (owner_id uuid, note text);
alter table public.stage3_optin_probe_table enable row level security;
insert into public.stage3_optin_probe_table values
    ('11111111-1111-1111-1111-111111111111'::uuid, 'mine'),
    ('22222222-2222-2222-2222-222222222222'::uuid, 'someone else''s');

select is(has_table_privilege('authenticated', 'public.stage3_optin_probe_table', 'SELECT'), false,
    'a new table is unreadable before the deliberate grant');

create policy stage3_optin_probe_select on public.stage3_optin_probe_table
    for select to authenticated using (owner_id = (select auth.uid()));
grant select on table public.stage3_optin_probe_table to authenticated;

select is(has_table_privilege('authenticated', 'public.stage3_optin_probe_table', 'SELECT'), true,
    'an explicit migration grant still takes effect');
select is(has_table_privilege('anon', 'public.stage3_optin_probe_table', 'SELECT'), false,
    'the explicit grant to authenticated does not leak to anon');

-- Resolve the policy as a genuine authenticated principal rather than as the owner.
create function public.stage3_optin_probe_visible(p_sub uuid) returns bigint
language plpgsql security invoker set search_path = public, pg_temp as $fn$
declare v_count bigint;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
                     json_build_object('role', 'authenticated', 'sub', p_sub)::text, true);
  select count(*) into v_count from public.stage3_optin_probe_table;
  reset role;
  return v_count;
end $fn$;

select is(public.stage3_optin_probe_visible('11111111-1111-1111-1111-111111111111'::uuid), 1::bigint,
    'the authenticated principal reaches exactly the row its policy allows');
select is(public.stage3_optin_probe_visible('33333333-3333-3333-3333-333333333333'::uuid), 0::bigint,
    'the same principal sees nothing when no row is its own');

-- ---------------------------------------------------------------------------
-- G. Cleanup, then proof the cleanup happened. No probe object may survive into
--    the application schema or into the generated client types.
-- ---------------------------------------------------------------------------
drop function if exists public.stage3_optin_probe_visible(uuid);
drop policy if exists stage3_optin_probe_select on public.stage3_optin_probe_table;
drop table if exists public.stage3_optin_probe_table;
drop function if exists public.stage3_acl_probe_function();
drop table if exists public.stage3_acl_probe_table;
drop sequence if exists public.stage3_acl_probe_sequence;

select is((select count(*) from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and (c.relname like 'stage3_acl_probe%' or c.relname like 'stage3_optin_probe%')), 0::bigint,
    'the future-object probes leave no relation behind');

select is((select count(*) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('stage3_acl_probe_function', 'stage3_optin_probe_visible')), 0::bigint,
    'the future-object probes leave no function behind');

