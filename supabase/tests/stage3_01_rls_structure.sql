-- Stage 3 / Phase 6 — database authorization structure (pgTAP).
--
-- Run with: pnpm test:db   (supabase test db)
--
-- pgTAP is installed into the `extensions` schema, never into `public`, so the
-- application schema and the generated client types stay byte-identical whether
-- or not the database test suite has been run. No fixtures and no fake tables:
-- every assertion inspects objects the migrations actually created.

set search_path = public, extensions, tap, core;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- ---------------------------------------------------------------------------
-- A. Row-level security is enabled on every private table.
--    pgTAP 1.3.3 has no has_rls() helper, so the catalog is asserted directly.
-- ---------------------------------------------------------------------------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0::bigint,
           'no table in public is left without row level security');

select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
             and c.relname in ('profiles','clients','receivables','promises','payments','activities',
                               'promise_events','entitlements','purchase_claims','analytics_events',
                               'founder_offer_config','founder_admins','founder_audit_events')), 13::bigint,
           'all 13 expected private tables are present');

-- FORCE ROW LEVEL SECURITY is deliberately OFF: the workflow RPCs are SECURITY
-- DEFINER functions owned by the table owner and must bypass policies to write
-- provenance the browser is not allowed to write. Pin the state so a change is
-- a reviewed decision, never an accident.
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity), 0::bigint,
           'no table uses FORCE ROW LEVEL SECURITY (documented workflow dependency)');

-- ---------------------------------------------------------------------------
-- B. No view / materialized view / sequence can sidestep those policies
-- ---------------------------------------------------------------------------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('v','m')), 0::bigint,
           'public exposes no views or materialized views that could bypass RLS');

select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'S'), 0::bigint,
           'public exposes no sequences to browser roles');

-- ---------------------------------------------------------------------------
-- C. The policy set is exactly the designed one — nothing more, nothing less
-- ---------------------------------------------------------------------------
select policies_are('public', 'profiles',
    array['profiles_select_own','profiles_update_own','profiles_delete_own'],
    'profiles exposes exactly select/update/delete owner policies');
select policies_are('public', 'clients',    array['clients_owner_all'],   'clients exposes exactly one owner-scoped ALL policy');
select policies_are('public', 'receivables',array['receivables_select_own','receivables_update_own'],
    'receivables exposes read + limited-update policies and no INSERT policy');
select policies_are('public', 'promises',   array['promises_select_own'], 'promises is read-only for the browser');
select policies_are('public', 'payments',   array['payments_select_own'], 'payments is read-only for the browser');
select policies_are('public', 'activities', array['activities_select_own','activities_insert_own'],
    'activities exposes read + owner-checked insert only');
select policies_are('public', 'promise_events', array['promise_events_select_own'],
    'promise_events is read-only for the browser (workflow provenance)');
select policies_are('public', 'entitlements', array['entitlements_select_own'],
    'entitlements is read-only for the browser');
select policies_are('public', 'purchase_claims', array['purchase_claims_select_own'],
    'purchase_claims is read-only for the browser');
select policies_are('public', 'analytics_events', array['analytics_owner_select','analytics_owner_insert'],
    'analytics_events exposes read + owner-checked insert only');
select policies_are('public', 'founder_admins', array[]::name[], 'founder_admins defines no policies');
select policies_are('public', 'founder_audit_events', array[]::name[], 'founder_audit_events defines no policies');
select policies_are('public', 'founder_offer_config', array[]::name[], 'founder_offer_config defines no policies');

-- ---------------------------------------------------------------------------
-- D. Every policy is scoped to signed-in users only, and every write policy
--    states what a legal new row looks like.
-- ---------------------------------------------------------------------------
select is((select count(*) from pg_policy p
           join pg_class c on c.oid = p.polrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and 0 = any (p.polroles)), 0::bigint,
           'no policy still applies to the PUBLIC pseudo-role');

select is((select count(*) from pg_policy p
           join pg_class c on c.oid = p.polrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and p.polroles <> array['authenticated'::regrole::oid]), 0::bigint,
           'every policy names exactly the authenticated role');

select is((select count(*) from pg_policy p
           join pg_class c on c.oid = p.polrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and p.polpermissive = false), 0::bigint,
           'all policies remain permissive so the owner predicate is additive');

select is((select count(*) from pg_policy p
           join pg_class c on c.oid = p.polrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and p.polcmd in ('a','w','*') and p.polwithcheck is null), 0::bigint,
           'every INSERT/UPDATE/ALL policy declares a WITH CHECK predicate');

select is((select count(*) from pg_policy p
           join pg_class c on c.oid = p.polrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and pg_get_expr(p.polqual, p.polrelid)          not like '%auth.uid()%'
             and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') not like '%auth.uid()%'), 0::bigint,
           'every policy predicate is anchored to auth.uid()');

-- The owner key each policy protects, verified object by object. The three
-- accepted forms are the hoisted (select auth.uid()) predicates introduced by
-- 20260814140000_current_stage3_policy_initplan.sql; the deparsed text is taken
-- from the executed catalog, and no other predicate shape is accepted at all.
select is((select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and (coalesce(pg_get_expr(p.polqual, p.polrelid), 'none') not in
                    ('(owner_id = ( SELECT auth.uid() AS uid))',
                     '(id = ( SELECT auth.uid() AS uid))',
                     '(user_id = ( SELECT auth.uid() AS uid))', 'none')
                  or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), 'none') not in
                    ('(owner_id = ( SELECT auth.uid() AS uid))',
                     '(id = ( SELECT auth.uid() AS uid))',
                     '(user_id = ( SELECT auth.uid() AS uid))', 'none'))), 0::bigint,
           'every policy compares only a documented owner column');

-- ---------------------------------------------------------------------------
-- E. SECURITY DEFINER shape (Phase 19-20 invariants, so the written review
--    cannot silently rot). Every definer routine in public is covered by these
--    catalog-wide assertions; the exact browser-callable set is pinned by
--    stage3_02_privileges.sql.
-- ---------------------------------------------------------------------------

-- Every routine pins search_path, so no caller can steer an unqualified name.
select is((select count(*) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')), 0::bigint,
           'every function in public pins search_path');

-- ... and gives a caller no schema that resolves before its own. A routine
-- either puts public first, or pins an empty path and so must spell every
-- name it touches with its own qualifier — the stricter of the two, and the
-- form the Stage 5 lifecycle helpers use. Anything else (a path that starts
-- with pg_temp, or a path that simply omits public) is a steerable name.
select is((select count(*) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and not exists (select 1 from unnest(p.proconfig) c
                             where c like 'search_path=public,%'
                                or c = 'search_path=public'
                                or c = 'search_path=""')
             ), 0::bigint,
           'every function either resolves from public first or pins an empty search path');

-- The empty-path form is only safe while it stays empty: a later edit that
-- appends a caller-writable schema would reintroduce shadowing.
select is((select count(*) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
             and (select count(*) from unnest(p.proconfig) c where c like 'search_path=%') > 1
           ), 0::bigint,
           'a function that pins an empty search path pins no other schema');

-- Definer routines run as their owner, so the owner must not be a browser role
-- and must not be a superuser (the local postgres role is verified non-superuser).
select is((select count(*) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           join pg_roles r on r.oid = p.proowner
           where n.nspname = 'public' and p.prosecdef
             and (r.rolsuper or r.rolname in ('anon','authenticated','service_role'))), 0::bigint,
           'no SECURITY DEFINER routine runs as a superuser or a browser role');

-- A browser-callable definer routine that writes must resolve its owner, either
-- directly through auth.uid() or through an assert_* ownership guard.
select is((select count(*) from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
             and has_function_privilege('authenticated', p.oid, 'EXECUTE')
             and p.prosrc ~* '(insert[[:space:]]+into|update[[:space:]]+|delete[[:space:]]+from)'
             and p.prosrc not like '%auth.uid()%'
             and p.prosrc not like '%assert_%'), 0::bigint,
           'every browser-executable writing SECURITY DEFINER routine is anchored to an owner check');

-- F. The FORCE ROW LEVEL SECURITY deviation is inert by construction, not by hope.
-- Postgres honours a BYPASSRLS membership over FORCE, so forcing policies onto these
-- tables would change nothing for the SECURITY DEFINER owner path. Verified by
-- experiment in the Stage 3 report (§ Phase 23 experiment log): with FORCE switched on
-- for profiles/entitlements/clients/activities an owner-side UPDATE still touched every
-- row, while `entitlements` has no UPDATE policy at all.
select is((select count(*) from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
             and (not c.relrowsecurity or c.relforcerowsecurity)), 0::bigint,
           'every private table enables row security and none is force-enabled');

select is((select count(*) from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           join pg_roles r on r.oid = c.relowner
           where n.nspname = 'public' and c.relkind = 'r' and not r.rolbypassrls), 0::bigint,
           'every private table is owned by the one role whose writes are scoped in-function rather than by policy');

-- G. Each policy resolves the request user once per query, not once per row.
-- `supabase db advisors --local --type performance` reported auth_rls_initplan for all
-- 15 owner policies; the measured cost is in the Stage 3 report. A bare auth.uid() is
-- inlined into the per-row filter, while the wrapped (select auth.uid()) form becomes an
-- InitPlan, so the setting lookup happens a single time per statement.
select is((select count(*) from pg_policy p
           join pg_class c on c.oid = p.polrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and pg_get_expr(p.polqual, p.polrelid) is not null
             and pg_get_expr(p.polqual, p.polrelid) not like '%( SELECT auth.uid() AS uid)%'), 0::bigint,
           'every USING predicate reads the request user through a hoisted sub-plan');

select is((select count(*) from pg_policy p
           join pg_class c on c.oid = p.polrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and p.polwithcheck is not null
             and pg_get_expr(p.polwithcheck, p.polrelid) not like '%( SELECT auth.uid() AS uid)%'), 0::bigint,
           'every WITH CHECK predicate reads the request user through a hoisted sub-plan');
