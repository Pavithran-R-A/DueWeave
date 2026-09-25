-- Stage 3 (current roadmap) — make FUTURE database access fail closed.
--
-- Forward-only. This migration changes what objects created by a *later*
-- migration inherit. It revokes nothing that any current application object
-- depends on: the grants Stage 3 made deliberately on the existing 13 tables
-- and 20 approved RPCs are untouched, and the pgTAP contract in
-- supabase/tests/stage3_02_privileges.sql sections A-C keeps them pinned.

-- ---------------------------------------------------------------------------
-- D10 — `authenticated SELECT` on every future public table.
--
-- Stage 3's first pass (D6) stopped future objects inheriting browser *writes*
-- but then re-opened reads with:
--
--   alter default privileges for role postgres in schema public
--     grant select on tables to authenticated;
--
-- Executed before this repair, as the migration role in schema public:
--
--   pg_default_acl (role postgres, schema public, tables)
--     = {postgres=arwdDxtm/postgres, service_role=arwdDxtm/postgres,
--        authenticated=r/postgres}                        <- the defect
--
--   create table public.<new>;            -- no GRANT at all
--   has_table_privilege('authenticated', '<new>', 'SELECT') = t
--
-- So a future migration that creates a table and forgets to enable RLS, forgets
-- a policy, or forgets an explicit revoke leaves that table readable through the
-- exposed Data API for every signed-in account. Reads must be opt-in, exactly
-- like writes already are.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- D11 — implicit PUBLIC EXECUTE on every future public function.
--
-- Discovered while probing D11's replacement behaviour, and not visible in
-- pg_default_acl at all, so no default-ACL assertion could ever have caught it.
--
-- PostgreSQL stamps the built-in initial privilege for a function
-- (`{=X/owner}`, i.e. EXECUTE to the PUBLIC pseudo-role) onto a new function
-- *after* merging the recorded default ACL, and ALTER DEFAULT PRIVILEGES has no
-- form that removes an initial privilege. Measured against this stack, five
-- distinct statements each left PUBLIC EXECUTE in place:
--
--   revoke all on functions from public
--   revoke execute on functions from public
--   revoke all on functions from public, anon, authenticated
--     (with a following grant execute to postgres)
--   grant execute, then revoke execute
--   revoking every remaining grantee, which deletes the pg_default_acl row and
--     falls back to acldefault() — which is where PUBLIC EXECUTE comes from
--
-- Executed proof, same role and schema as above:
--
--   create function public.<new>() ...;
--   proacl = {postgres=X/postgres, =X/postgres, service_role=X/postgres}
--   has_function_privilege('anon', '<new>', 'EXECUTE')          = t   <- fail-open
--   has_function_privilege('authenticated', '<new>', 'EXECUTE') = t
--
-- Because PostgREST publishes every EXECUTE-reachable public function as
-- /rpc/<name>, a future function that forgets its revoke — including a helper
-- written to be called only from a SECURITY DEFINER routine — is anonymously
-- callable. anon inherits from PUBLIC, so the browser roles are reached even
-- though neither is named in the default ACL.
--
-- The only supported mechanism that can strip an initial privilege is to revoke
-- it on the object once it exists. This trigger makes that automatic and
-- preventive rather than dependent on a future author remembering a line. It is
-- deliberately narrow:
--   * only objects in schema public,
--   * only CREATE/ALTER FUNCTION|PROCEDURE,
--   * only when the role running the DDL owns the function, so no session can
--     use it to strip another owner's grants and no unexpected DDL is aborted.
--
-- Owner and service_role EXECUTE survive — the workflow functions are owned by
-- this role and reach their tables through it — and a migration that wants a
-- browser role to reach a new function still says so explicitly afterwards,
-- which is proven behaviourally in the same pgTAP file.
-- ---------------------------------------------------------------------------
create or replace function public.stage3_default_privileges_fail_closed()
returns event_trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_command record;
begin
  for v_command in
    select c.objid
    from pg_event_trigger_ddl_commands() c
    join pg_proc p on p.oid = c.objid
    where c.command_tag in ('CREATE FUNCTION', 'ALTER FUNCTION', 'CREATE PROCEDURE', 'ALTER PROCEDURE')
      and p.pronamespace = 'public'::regnamespace
      and p.proowner = (select r.oid from pg_roles r where r.rolname = current_role)
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      v_command.objid::regprocedure);
  end loop;
end;
$$;

-- Event trigger functions cannot be invoked over SQL, but the implicit PUBLIC
-- EXECUTE PostgreSQL gave this one at creation is the exact privilege class this
-- migration exists to remove, so it is removed here too.
revoke all on function public.stage3_default_privileges_fail_closed() from public, anon, authenticated;

drop event trigger if exists stage3_default_privileges_fail_closed;

create event trigger stage3_default_privileges_fail_closed
    on ddl_command_end
    execute function public.stage3_default_privileges_fail_closed();
