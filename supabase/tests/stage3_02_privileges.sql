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

select plan(95);

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
    -- five self-scoped founder purchase routines, seven founder review
    -- routines that each re-check assert_founder_admin() internally, the
    -- two Stage 4 edit routines, and the two Stage 5 lifecycle routines that
    -- close a receivable or withdraw a promise. The list stays an exact set on
    -- purpose: a future migration that grants one more RPC has to be approved
    -- here first.
    array[
        'approve_founder_claim', 'cancel_founder_claim', 'cancel_promise',
        'cancel_receivable', 'create_client', 'create_client_and_receivable',
        'create_founder_claim', 'create_promise',
        'create_receivable', 'get_founder_funnel', 'get_founder_offer',
        'list_pending_founder_claims', 'list_rejected_founder_claims',
        'mark_due_promises_broken', 'reconsider_founder_claim', 'record_contacted',
        'record_founder_upgrade_view', 'record_payment', 'reject_founder_claim',
        'revoke_founder_entitlement', 'snooze_receivable', 'submit_founder_payment',
        'update_client', 'update_receivable_details'
    ]::text[],
    'authenticated can execute exactly the 24 RPCs the application calls');

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
-- E2. The same closed-by-default contract has to hold for every ROUTINE, not
--     only for the plain function section E happens to try.
--
--     Defect D12: the preventive trigger installed by the D10/D11 migration
--     watches CREATE/ALTER FUNCTION *and* CREATE/ALTER PROCEDURE, but its
--     dynamic statement was always `revoke all on function <identity>`.
--     PostgreSQL keeps FUNCTION and PROCEDURE apart in privilege syntax, so
--     revoking on a procedure object raises SQLSTATE 42809
--     ("<name>() is not a function") — and because the revoke runs at
--     ddl_command_end, that aborts the migration's own CREATE PROCEDURE.
--
--     Every probe here is created through a harness that catches the error,
--     so D12 shows up as named failing assertions instead of ending the run
--     half-way (which would hide sections F and G). The identity lookups go
--     through to_regprocedure(), so an object that was never created makes the
--     privilege assertion fail rather than raise a second error: absence is
--     never allowed to read as "closed".
-- ---------------------------------------------------------------------------
-- `detail` holds either the literal 'ok' or the exact PostgreSQL error
-- the harness caught, so a failing assertion prints the reason instead of a
-- bare boolean.
create temp table stage3_routine_probe(
    probe  text primary key,
    detail text not null
);

do $do$ begin
  execute $sql$create function public.stage3_probe_function() returns integer
                 language sql security invoker set search_path = public, pg_temp
                 as $body$ select 1 $body$$sql$;
  insert into pg_temp.stage3_routine_probe values ('function', 'ok');
exception when others then
  insert into pg_temp.stage3_routine_probe values ('function', sqlstate || ': ' || sqlerrm);
end $do$;

do $do$ begin
  execute $sql$create function public.stage3_probe_overload(integer) returns integer
                 language sql security invoker set search_path = public, pg_temp
                 as $body$ select 1 $body$$sql$;
  insert into pg_temp.stage3_routine_probe values ('overload_integer', 'ok');
exception when others then
  insert into pg_temp.stage3_routine_probe values ('overload_integer', sqlstate || ': ' || sqlerrm);
end $do$;

do $do$ begin
  execute $sql$create function public.stage3_probe_overload(text) returns integer
                 language sql security invoker set search_path = public, pg_temp
                 as $body$ select 1 $body$$sql$;
  insert into pg_temp.stage3_routine_probe values ('overload_text', 'ok');
exception when others then
  insert into pg_temp.stage3_routine_probe values ('overload_text', sqlstate || ': ' || sqlerrm);
end $do$;

-- The two procedure probes: these are what D12 breaks.
do $do$ begin
  execute $sql$create procedure public.stage3_probe_procedure()
                 language plpgsql security invoker set search_path = public, pg_temp
                 as $body$ begin null; end; $body$$sql$;
  insert into pg_temp.stage3_routine_probe values ('procedure', 'ok');
exception when others then
  insert into pg_temp.stage3_routine_probe values ('procedure', sqlstate || ': ' || sqlerrm);
end $do$;

do $do$ begin
  execute $sql$create procedure public.stage3_probe_procedure(p_a integer, p_b text)
                 language plpgsql security invoker set search_path = public, pg_temp
                 as $body$ begin null; end; $body$$sql$;
  insert into pg_temp.stage3_routine_probe values ('procedure_params', 'ok');
exception when others then
  insert into pg_temp.stage3_routine_probe values ('procedure_params', sqlstate || ': ' || sqlerrm);
end $do$;

-- A future FUNCTION must be created and must start closed.
select is((select detail from pg_temp.stage3_routine_probe where probe = 'function'), 'ok',
    'a later migration can create a public function');
select is((select has_function_privilege('anon', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.stage3_probe_function()')), false,
    'anon cannot execute a function created by a later migration');
select is((select has_function_privilege('authenticated', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.stage3_probe_function()')), false,
    'authenticated cannot execute a function created by a later migration');
select is((select has_function_privilege('public', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.stage3_probe_function()')), false,
    'a future function does not inherit the implicit PUBLIC EXECUTE');

-- Overloaded signatures are separate privilege identities, and each must
-- start closed: matching only on proname would let one overload keep access.
select is((select detail from pg_temp.stage3_routine_probe where probe = 'overload_integer'), 'ok',
    'a later migration can create an overloaded public function (integer)');
select is((select detail from pg_temp.stage3_routine_probe where probe = 'overload_text'), 'ok',
    'a later migration can create the same overload name (text)');
select is((select count(distinct p.oid) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'stage3_probe_overload'),
    2::bigint,
    'both overloaded signatures exist as two distinct routine identities');
select is((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'stage3_probe_overload'
             and has_function_privilege('anon', p.oid, 'EXECUTE')), 0::bigint,
    'no overload signature is anonymously callable');
select is((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'stage3_probe_overload'
             and has_function_privilege('authenticated', p.oid, 'EXECUTE')), 0::bigint,
    'no overload signature is callable by an ordinary account');
select is((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'stage3_probe_overload'
             and has_function_privilege('public', p.oid, 'EXECUTE')), 0::bigint,
    'no overload signature keeps the implicit PUBLIC EXECUTE');

-- A future PROCEDURE must be creatable at all, and must start closed too.
select is((select detail from pg_temp.stage3_routine_probe where probe = 'procedure'), 'ok',
    'a later migration can create a public procedure (D12)');
select is((select detail from pg_temp.stage3_routine_probe where probe = 'procedure_params'), 'ok',
    'a later migration can create a public procedure with parameters (D12)');
select is((select string_agg(p.prokind::text, '' order by p.oid::text) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'stage3_probe_procedure'),
    'pp',
    'the future procedures really are procedures, not functions in disguise');
select is((select has_function_privilege('anon', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.stage3_probe_procedure()')), false,
    'anon cannot execute a procedure created by a later migration');
select is((select has_function_privilege('authenticated', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.stage3_probe_procedure()')), false,
    'authenticated cannot execute a procedure created by a later migration');
select is((select has_function_privilege('public', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.stage3_probe_procedure()')), false,
    'a future procedure does not inherit the implicit PUBLIC EXECUTE');
select is((select has_function_privilege('authenticated', p.oid, 'EXECUTE')
           from pg_proc p
           where p.oid = to_regprocedure('public.stage3_probe_procedure(integer,text)')), false,
    'authenticated cannot execute a parameterized procedure created later');
select is((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'stage3_probe_procedure'
             and has_function_privilege('postgres', p.oid, 'EXECUTE')), 2::bigint,
    'the owner still executes both future procedures it created');
select is((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'stage3_probe_procedure'
             and has_function_privilege('service_role', p.oid, 'EXECUTE')), 2::bigint,
    'service_role keeps its intended control over future procedures');

-- An aggregate is the third kind of pg_proc routine (prokind 'a') and it gets
-- the same implicit PUBLIC EXECUTE, so the widened tag list has to cover it.
do $do$ begin
  execute $sql$create function public.stage3_probe_agg_sfunc(bigint, bigint) returns bigint
                 language sql security invoker set search_path = public, pg_temp
                 as $body$ select coalesce($1, 0) + coalesce($2, 0) $body$$sql$;
  execute $sql$create aggregate public.stage3_probe_agg(bigint) (
                 sfunc = public.stage3_probe_agg_sfunc, stype = bigint)$sql$;
  insert into pg_temp.stage3_routine_probe values ('aggregate', 'ok');
exception when others then
  insert into pg_temp.stage3_routine_probe values ('aggregate', sqlstate || ': ' || sqlerrm);
end $do$;

select is((select detail from pg_temp.stage3_routine_probe where probe = 'aggregate'), 'ok',
    'a later migration can create a public aggregate');
select is((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'stage3_probe_agg'
             and (has_function_privilege('anon', p.oid, 'EXECUTE')
                  or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                  or has_function_privilege('public', p.oid, 'EXECUTE'))), 0::bigint,
    'a future aggregate keeps no PUBLIC or browser-role EXECUTE');
select is((select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname like 'stage3_probe_agg%'
             and has_function_privilege('postgres', p.oid, 'EXECUTE')), 2::bigint,
    'the owner still executes the future aggregate and its transition function');

-- One blanket statement over every routine created so far in public: no
-- browser role and no PUBLIC entry anywhere in the freshly stamped ACLs.
select is((select count(*) from pg_proc p
           cross join lateral aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace and p.proname like 'stage3_probe%'
             and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0)), 0::bigint,
    'no future routine of any kind carries a browser-role or PUBLIC entry');

-- The preventive trigger must not touch unrelated DDL: a table, an index and
-- a view created afterwards have to survive the same ddl_command_end event.
do $do$ begin
  execute 'create table public.stage3_probe_plain_table (id bigint, owner_id uuid)';
  execute 'create index stage3_probe_plain_index on public.stage3_probe_plain_table (id)';
  execute 'create view public.stage3_probe_plain_view as select id from public.stage3_probe_plain_table';
  insert into pg_temp.stage3_routine_probe values ('unrelated_ddl', 'ok');
exception when others then
  insert into pg_temp.stage3_routine_probe values ('unrelated_ddl', sqlstate || ': ' || sqlerrm);
end $do$;

select is((select detail from pg_temp.stage3_routine_probe where probe = 'unrelated_ddl'), 'ok',
    'the routine hardening trigger does not abort unrelated table, index and view DDL');
select is((select count(*) from pg_class c
           cross join lateral aclexplode(c.relacl) a
           where c.oid in (to_regclass('public.stage3_probe_plain_table'),
                           to_regclass('public.stage3_probe_plain_view'))
             and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0)), 0::bigint,
    'the unrelated table and view are also created closed to browser roles');

-- Explicit opt-in has to keep working for both kinds, which is what makes
-- fail-closed tolerable for a future migration author.
do $do$ begin
  execute 'grant execute on function public.stage3_probe_function() to authenticated';
  insert into pg_temp.stage3_routine_probe values ('grant_function', 'ok');
exception when others then
  insert into pg_temp.stage3_routine_probe values ('grant_function', sqlstate || ': ' || sqlerrm);
end $do$;

do $do$ begin
  execute 'grant execute on procedure public.stage3_probe_procedure() to authenticated';
  insert into pg_temp.stage3_routine_probe values ('grant_procedure', 'ok');
exception when others then
  insert into pg_temp.stage3_routine_probe values ('grant_procedure', sqlstate || ': ' || sqlerrm);
end $do$;

select is((select has_function_privilege('authenticated', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.stage3_probe_function()')), true,
    'a migration can still deliberately expose a future function');
select is((select has_function_privilege('anon', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.stage3_probe_function()')), false,
    'exposing a function to authenticated does not leak it to anon');
select is((select has_function_privilege('authenticated', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.stage3_probe_procedure()')), true,
    'a migration can still deliberately expose a future procedure (D12)');
select is((select has_function_privilege('anon', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.stage3_probe_procedure()')), false,
    'exposing a procedure to authenticated does not leak it to anon');

-- And prove the procedure grant is real execution capability for a genuine
-- authenticated principal, at the privilege layer. PostgREST exposes no
-- /rpc path for procedures, so CALL is the correct thing to test here.
create function public.stage3_probe_call_auth() returns text
language plpgsql security invoker set search_path = public, pg_temp as $fn$
declare v_result text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
                     json_build_object('role', 'authenticated',
                                       'sub', '11111111-1111-1111-1111-111111111111')::text, true);
  begin
    execute 'call public.stage3_probe_procedure()';
    v_result := 'ok';
  exception when others then
    v_result := sqlstate || ': ' || sqlerrm;
  end;
  reset role;
  return v_result;
end $fn$;

select is(public.stage3_probe_call_auth(), 'ok',
    'the opted-in authenticated principal can CALL the future procedure');

-- ALTER is watched too, and must stay fail-closed on purpose: a migration
-- that materially ALTERs a browser-exposed routine has to re-GRANT afterwards.
do $do$ begin
  execute 'alter function public.stage3_probe_function() cost 5';
  insert into pg_temp.stage3_routine_probe values ('alter_function', 'ok');
exception when others then
  insert into pg_temp.stage3_routine_probe values ('alter_function', sqlstate || ': ' || sqlerrm);
end $do$;

do $do$ begin
  execute 'alter procedure public.stage3_probe_procedure() set seq_page_cost = 1';
  insert into pg_temp.stage3_routine_probe values ('alter_procedure', 'ok');
exception when others then
  insert into pg_temp.stage3_routine_probe values ('alter_procedure', sqlstate || ': ' || sqlerrm);
end $do$;

select is((select detail from pg_temp.stage3_routine_probe where probe = 'alter_function'), 'ok',
    'ALTER FUNCTION of an exposed future function still works');
select is((select has_function_privilege('authenticated', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.stage3_probe_function()')), false,
    'ALTER FUNCTION deliberately strips the earlier explicit grant (fail-closed)');
select is((select detail from pg_temp.stage3_routine_probe where probe = 'alter_procedure'), 'ok',
    'ALTER PROCEDURE of an exposed future procedure still works (D12)');
select is((select has_function_privilege('authenticated', p.oid, 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.stage3_probe_procedure()')), false,
    'ALTER PROCEDURE deliberately strips the earlier explicit grant (fail-closed)');

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
drop function if exists public.stage3_probe_call_auth();
drop aggregate if exists public.stage3_probe_agg(bigint);
drop function if exists public.stage3_probe_agg_sfunc(bigint, bigint);
drop view if exists public.stage3_probe_plain_view;
drop table if exists public.stage3_probe_plain_table;
drop procedure if exists public.stage3_probe_procedure();
drop procedure if exists public.stage3_probe_procedure(integer, text);
drop function if exists public.stage3_probe_overload(integer);
drop function if exists public.stage3_probe_overload(text);
drop function if exists public.stage3_probe_function();
drop function if exists public.stage3_optin_probe_visible(uuid);
drop policy if exists stage3_optin_probe_select on public.stage3_optin_probe_table;
drop table if exists public.stage3_optin_probe_table;
drop function if exists public.stage3_acl_probe_function();
drop table if exists public.stage3_acl_probe_table;
drop sequence if exists public.stage3_acl_probe_sequence;

select is((select count(*) from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and (c.relname like 'stage3_acl_probe%' or c.relname like 'stage3_optin_probe%'
                  or c.relname like 'stage3_probe%')), 0::bigint,
    'the future-object probes leave no relation behind');

select is((select count(*) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and (p.proname like 'stage3_probe%'
                  or p.proname in ('stage3_acl_probe_function', 'stage3_optin_probe_visible'))), 0::bigint,
    'the future-routine probes leave no function or procedure behind');

