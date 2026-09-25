-- Stage 4 (current roadmap) — persistent, owner-scoped edits with optimistic concurrency.
--
-- Forward-only. This file creates two narrow SECURITY DEFINER RPCs and changes
-- nothing else: no earlier migration is edited, no table privilege is widened,
-- no policy is touched, and the Stage 3 fail-closed default-privilege posture
-- (20260814150000 / 20260814160000) is honoured — the ddl_command_end trigger
-- revokes the implicit EXECUTE on each CREATE below, and this file then makes
-- browser access an explicit opt-in, which is the only way Stage 3 allows it.
--
-- WHY RPCs AND NOT AN UPDATE GRANT
--
-- `authenticated` holds SELECT only on public.clients and public.receivables
-- (measured: information_schema.table_privileges lists exactly one row per
-- table, privilege_type SELECT). Granting UPDATE to reach these columns would
-- hand every signed-in account a write path whose column set the database
-- cannot police on its own, and would make the Stage 3 cross-tenant regression
-- weaker rather than stronger. The approved alternative is a routine per edit,
-- whose parameter list IS the allowlist.
--
-- THE ALLOWLIST
--
--   update_client             -> name, company, phone, email, notes
--   update_receivable_details -> label, invoice_ref, notes
--
-- Never reachable through either routine, because they are simply not
-- parameters and are not in the UPDATE set: id, owner_id, client_id,
-- created_at, archived_at, amount_due_paise, outstanding_paise, status,
-- due_date, updated_at.
--
-- due_date is deliberately NOT editable in Stage 4, and this is the boundary
-- record for that decision. A due date is what the ledger grades promises
-- against: moving it rewrites whether each stored promise was kept or broken,
-- changes the follow-up suggestion and the queue priority for that invoice,
-- and would need a dated history entry plus a re-judgement rule to stay
-- honest. That is lifecycle work, it belongs to the promise-state stage, and
-- inventing a silent date change here would quietly corrupt the provenance the
-- product is judged by. Nothing in this migration, in the repositories, or in
-- the edit sheet accepts a date.
--
-- client re-parenting is likewise out of scope, and already impossible at the
-- database layer: guard_receivable_financial_fields raises on any UPDATE that
-- moves owner_id or client_id outside the protected payment workflow.
--
-- CONCURRENCY — explicit rejection of last-write-wins
--
-- Both routines require p_expected_updated_at, the `updated_at` value the
-- caller last read. The row is locked with FOR UPDATE, ownership is verified
-- against auth.uid(), and the token is compared before anything is written. A
-- mismatch raises SQLSTATE 40001 (serialization_failure), which PostgREST
-- reports as a stable conflict code, so a second tab or a second device never
-- silently overwrites an edit to someone's money record. Silence was not an
-- option and neither was silent loss, so the client keeps its typed values and
-- reloads. `updated_at` itself is advanced by the existing set_updated_at
-- BEFORE UPDATE trigger — this file does not hand-write it, which is why the
-- token cannot be forged or left stale by an edit path.
--
-- The caller-supplied timestamp is compared as a timestamptz, never as text,
-- and the identity columns are copied from the locked row, not from arguments.

-- ---------------------------------------------------------------------------
-- update_client
-- ---------------------------------------------------------------------------
create or replace function public.update_client(
  p_client_id uuid,
  p_name text,
  p_company text default '',
  p_phone text default '',
  p_email text default '',
  p_notes text default '',
  -- PostgreSQL requires every parameter after a defaulted one to be defaulted
  -- too, so the token is `default null` and then treated as mandatory below:
  -- a call that omits it is refused as a conflict instead of writing blindly.
  p_expected_updated_at timestamptz default null
) returns clients
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_owner uuid := auth.uid();
  v_row public.clients;
  v_input record;
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
begin
  if v_owner is null then
    raise exception 'Authentication is required';
  end if;
  if p_client_id is null then
    raise exception 'A client id is required' using errcode = 'P0002';
  end if;

  select * into v_row from public.clients where id = p_client_id and owner_id = v_owner for update;
  if not found then
    raise exception 'That client is not available in this private ledger' using errcode = 'P0002';
  end if;

  if p_expected_updated_at is null or v_row.updated_at <> p_expected_updated_at then
    raise exception 'This client changed in another session' using errcode = '40001';
  end if;

  -- Same trim, length, email and phone rules create_client already enforces.
  select * into v_input from public.assert_stage3_client_input(p_name, p_phone, p_email, p_notes);
  if v_company is not null and char_length(v_company) > 160 then
    raise exception 'Business name can be up to 160 characters';
  end if;

  update public.clients
     set name = v_input.name,
         company = coalesce(v_company, ''),
         phone = v_input.phone,
         email = v_input.email,
         notes = v_input.notes
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_receivable_details
-- ---------------------------------------------------------------------------
create or replace function public.update_receivable_details(
  p_receivable_id uuid,
  p_label text,
  p_invoice_ref text default '',
  p_notes text default '',
  p_expected_updated_at timestamptz default null
) returns receivables
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_owner uuid := auth.uid();
  v_row public.receivables;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_invoice_ref text := nullif(btrim(coalesce(p_invoice_ref, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_owner is null then
    raise exception 'Authentication is required';
  end if;
  if p_receivable_id is null then
    raise exception 'A receivable id is required' using errcode = 'P0002';
  end if;

  select * into v_row from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found then
    raise exception 'That receivable is not available in this private ledger' using errcode = 'P0002';
  end if;

  if p_expected_updated_at is null or v_row.updated_at <> p_expected_updated_at then
    raise exception 'This receivable changed in another session' using errcode = '40001';
  end if;

  -- Identical limits and wording to create_receivable, so an edit can never be
  -- stricter or looser than the path that created the row.
  if v_label is null or char_length(v_label) > 240 then
    raise exception 'Add a receivable label of up to 240 characters';
  end if;
  if v_invoice_ref is not null and char_length(v_invoice_ref) > 160 then
    raise exception 'Reference can be up to 160 characters';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'Notes can be up to 2,000 characters';
  end if;

  update public.receivables
     set label = v_label,
         invoice_ref = v_invoice_ref,
         notes = v_notes
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

-- Explicit opt-in for the browser role only. The fail-closed trigger has
-- already stripped PUBLIC/anon/authenticated EXECUTE above; a signed-out
-- visitor keeps no path to either routine.
grant execute on function public.update_client(uuid, text, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.update_receivable_details(uuid, text, text, text, timestamptz) to authenticated;

revoke all on function public.update_client(uuid, text, text, text, text, text, timestamptz) from public, anon;
revoke all on function public.update_receivable_details(uuid, text, text, text, timestamptz) from public, anon;

comment on function public.update_client is 'Owner-scoped edit of the five descriptive client fields. Requires the caller''s last-read updated_at.';
comment on function public.update_receivable_details is 'Owner-scoped edit of receivable label, invoice reference and notes. Financial columns and due_date are not reachable.';

commit;
