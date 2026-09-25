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

select plan(39);

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
-- D. Hardening must survive future migrations: the role that applies
--    migrations may not keep installing browser access by default.
-- ---------------------------------------------------------------------------
select is((select count(*)
           from pg_default_acl d
           join pg_roles r on r.oid = d.defaclrole
           cross join lateral aclexplode(d.defaclacl) a
           join pg_roles g on g.oid = a.grantee
           where r.rolname = 'postgres'
             and d.defaclnamespace = 'public'::regnamespace::oid
             and g.rolname in ('anon', 'authenticated')
             and a.privilege_type not in ('SELECT', 'USAGE')), 0::bigint,
    'default privileges for the migration role install no browser write access');

select is((select count(*)
           from pg_default_acl d
           join pg_roles r on r.oid = d.defaclrole
           cross join lateral aclexplode(d.defaclacl) a
           where r.rolname = 'postgres'
             and d.defaclnamespace = 'public'::regnamespace::oid
             and a.grantee = 0), 0::bigint,
    'default privileges for the migration role never target the PUBLIC pseudo-role');

