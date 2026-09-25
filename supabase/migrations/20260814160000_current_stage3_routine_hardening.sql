-- Stage 3 closure repair (D12) — harden future ROUTINE privileges correctly.
--
-- Forward-only. Nothing in this file edits an earlier migration; it replaces
-- the body of the preventive event trigger that
-- 20260814150000_current_stage3_default_privileges_fail_closed.sql installed.
--
-- WHAT WAS WRONG
--
-- That trigger watches CREATE/ALTER FUNCTION *and* CREATE/ALTER PROCEDURE, but
-- its dynamic statement was always
--
--     revoke all on function %s from public, anon, authenticated
--
-- PostgreSQL keeps FUNCTION and PROCEDURE apart in privilege syntax: FUNCTION
-- addresses ordinary, aggregate and window functions only. When a procedure is
-- created, the trigger fires at ddl_command_end and the revoke raises
--
--     SQLSTATE 42809  "stage3_probe_procedure() is not a function"
--
-- which aborts the CREATE PROCEDURE itself. Measured on the local PostgreSQL
-- 17.6 before this repair: a plain `create procedure public.x()` in the
-- migration-owner context failed with 42809 and the procedure did not persist.
-- So the previous implementation both broke legitimate DDL and, if the abort
-- had been avoided by simply not revoking on that tag, would have left the
-- procedure's implicit PUBLIC EXECUTE in place — which is the D11 hole, measured
-- open below for the aggregate case.
--
-- THE REPAIR
--
-- ROUTINE is the object keyword that addresses a function or a procedure
-- uniformly, and `::regprocedure` gives the signature-qualified identity that
-- overloads need. Verified on this server, inside a rolled-back transaction,
-- against:
--   * a normal function            — revoke accepted, PUBLIC/anon/authenticated stripped
--   * two overloads of one name    — each identity stripped independently
--   * a zero-parameter procedure   — creation succeeded, revoke accepted
--   * a parameterized procedure    — creation succeeded, revoke accepted
--   * an aggregate (prokind 'a')   — creation succeeded, revoke accepted
--
-- AGGREGATE TAGS ARE NOW WATCHED TOO
--
-- An aggregate is a pg_proc row with prokind = 'a' and it receives the same
-- implicit PUBLIC EXECUTE. The old tag list omitted CREATE/ALTER AGGREGATE, so
-- a future migration adding one would have re-opened exactly the hole D11
-- closed and would have failed this project's own invariant that no public
-- routine is left executable by PUBLIC.
--
-- ALTER IS FAIL-CLOSED, ON PURPOSE — READ THIS BEFORE WRITING A MIGRATION
--
-- The trigger also fires on ALTER FUNCTION / ALTER PROCEDURE, and the revoke it
-- emits removes *explicit* grants as well as the implicit default. Measured:
-- create a routine, `grant execute ... to authenticated`, then run
-- `alter function ... cost 5` (or `alter procedure ... set seq_page_cost = 1`,
-- or `create or replace ...`) and the authenticated EXECUTE entry is gone
-- again; a CALL by that role then fails with 42501 until the grant is re-issued.
-- That is deliberate: a migration that materially ALTERs a browser-exposed
-- routine MUST re-GRANT authenticated EXECUTE afterwards, otherwise the RPC
-- stops working instead of leaking. This behaviour is pinned by pgTAP
-- assertions "ALTER FUNCTION deliberately strips the earlier explicit grant"
-- and "ALTER PROCEDURE deliberately strips the earlier explicit grant" in
-- supabase/tests/stage3_02_privileges.sql, so it cannot silently change.
--
-- Current application routines are untouched by this file: it changes only how
-- future DDL is hardened, and every existing GRANT in the 20 browser-callable
-- RPCs stays as the earlier migrations set it.

-- The trigger function itself is an ordinary public function, so the statement
-- below re-fires the (still old) trigger with FUNCTION syntax, which is valid
-- for it.
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
    where c.command_tag in ('CREATE FUNCTION', 'ALTER FUNCTION',
                            'CREATE PROCEDURE', 'ALTER PROCEDURE',
                            'CREATE AGGREGATE', 'ALTER AGGREGATE')
      and p.pronamespace = 'public'::regnamespace
      and p.proowner = (select r.oid from pg_roles r where r.rolname = current_role)
  loop
    -- ROUTINE, not FUNCTION: this must work for a function, an aggregate and a
    -- procedure without knowing which one the command just created.
    execute format(
      'revoke all on routine %s from public, anon, authenticated',
      v_command.objid::regprocedure
    );
  end loop;
end;
$$;

revoke all on routine public.stage3_default_privileges_fail_closed()
    from public, anon, authenticated;

drop event trigger if exists stage3_default_privileges_fail_closed;
create event trigger stage3_default_privileges_fail_closed
    on ddl_command_end
    execute function public.stage3_default_privileges_fail_closed();
