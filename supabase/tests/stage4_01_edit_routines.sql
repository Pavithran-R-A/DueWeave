-- Stage 4 (current roadmap) — the persistent edit routines' security posture (pgTAP).
--
-- Run with: pnpm test:db   (supabase test db)
--
-- These expectations were written from the Stage 4 edit contract, not from the
-- catalog: two narrow owner-scoped routines, reachable only by a signed-in
-- account, and no new table write privilege anywhere. The Stage 3 file
-- stage3_02_privileges.sql already asserts the global invariants over every
-- public routine (no PUBLIC EXECUTE, nothing anonymously callable), so this
-- file pins what is specific to the edit path.

set search_path = public, extensions, tap, core;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---------------------------------------------------------------------------
-- A. Both routines exist with the approved signature.
-- ---------------------------------------------------------------------------
select has_function('public', 'update_client',
    array['uuid', 'text', 'text', 'text', 'text', 'text', 'timestamp with time zone']::name[],
    'update_client exists with the owner id, five descriptive fields and a concurrency token');
select has_function('public', 'update_receivable_details',
    array['uuid', 'text', 'text', 'text', 'timestamp with time zone']::name[],
    'update_receivable_details exists with the owner id, three descriptive fields and a concurrency token');

-- ---------------------------------------------------------------------------
-- B. The parameter list IS the allowlist. A name that is not here cannot be
--    reached by any caller, which is what keeps amount_due_paise,
--    outstanding_paise, status, client_id, owner_id, due_date, created_at,
--    archived_at and updated_at out of reach.
-- ---------------------------------------------------------------------------
select is(
    (select proargnames from pg_proc
      where oid = 'public.update_client(uuid,text,text,text,text,text,timestamptz)'::regprocedure),
    array['p_client_id', 'p_name', 'p_company', 'p_phone', 'p_email', 'p_notes', 'p_expected_updated_at'],
    'update_client accepts only the five editable client fields plus identity and token');
select is(
    (select proargnames from pg_proc
      where oid = 'public.update_receivable_details(uuid,text,text,text,timestamptz)'::regprocedure),
    array['p_receivable_id', 'p_label', 'p_invoice_ref', 'p_notes', 'p_expected_updated_at'],
    'update_receivable_details accepts only the three editable receivable fields plus identity and token');

-- ---------------------------------------------------------------------------
-- C. Execution is an explicit opt-in for the signed-in role only.
-- ---------------------------------------------------------------------------
select function_privs_are('public', 'update_client',
    array['uuid', 'text', 'text', 'text', 'text', 'text', 'timestamp with time zone']::name[],
    'authenticated', array['EXECUTE'],
    'authenticated can execute update_client');
select function_privs_are('public', 'update_receivable_details',
    array['uuid', 'text', 'text', 'text', 'timestamp with time zone']::name[],
    'authenticated', array['EXECUTE'],
    'authenticated can execute update_receivable_details');
select is(has_function_privilege('anon',
    'public.update_client(uuid,text,text,text,text,text,timestamptz)'::regprocedure, 'EXECUTE'), false,
    'anon cannot execute update_client');
select is(has_function_privilege('anon',
    'public.update_receivable_details(uuid,text,text,text,timestamptz)'::regprocedure, 'EXECUTE'), false,
    'anon cannot execute update_receivable_details');
select is(has_function_privilege('public',
    'public.update_client(uuid,text,text,text,text,text,timestamptz)'::regprocedure, 'EXECUTE'), false,
    'update_client carries no implicit PUBLIC EXECUTE');
select is(has_function_privilege('public',
    'public.update_receivable_details(uuid,text,text,text,timestamptz)'::regprocedure, 'EXECUTE'), false,
    'update_receivable_details carries no implicit PUBLIC EXECUTE');

-- ---------------------------------------------------------------------------
-- D. Definer model, pinned search_path. The routines must run as the owner
--    because the browser role holds no table UPDATE below; every one of them
--    still resolves auth.uid() explicitly and never builds SQL dynamically.
-- ---------------------------------------------------------------------------
select is((select prosecdef from pg_proc
    where oid = 'public.update_client(uuid,text,text,text,text,text,timestamptz)'::regprocedure), true,
    'update_client is SECURITY DEFINER');
select is((select prosecdef from pg_proc
    where oid = 'public.update_receivable_details(uuid,text,text,text,timestamptz)'::regprocedure), true,
    'update_receivable_details is SECURITY DEFINER');
select is((select proconfig @> array['search_path=public, auth, pg_temp'] from pg_proc
    where oid = 'public.update_client(uuid,text,text,text,text,text,timestamptz)'::regprocedure), true,
    'update_client pins its search_path');
select is((select proconfig @> array['search_path=public, auth, pg_temp'] from pg_proc
    where oid = 'public.update_receivable_details(uuid,text,text,text,timestamptz)'::regprocedure), true,
    'update_receivable_details pins its search_path');

-- ---------------------------------------------------------------------------
-- E. The Stage 4 boundary: no UPDATE was granted to reach these columns.
--    authenticated stays read-only on both tenant tables, so the routine is the
--    only edit path and the Stage 3 cross-tenant regression stays in force.
-- ---------------------------------------------------------------------------
select table_privs_are('public', 'clients', 'authenticated', array['SELECT'],
    'authenticated holds SELECT only on clients, so an edit cannot bypass the routine');
select table_privs_are('public', 'receivables', 'authenticated', array['SELECT'],
    'authenticated holds SELECT only on receivables, so an edit cannot bypass the routine');

select * from finish();
