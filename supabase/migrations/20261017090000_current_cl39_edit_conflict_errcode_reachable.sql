-- CL-39: make the stale-edit refusal reach the customer instead of hanging.
--
-- What was measured, on 2026-10-16 against the live project and on 2026-10-17 against the pinned
-- local build (public.ecr.aws/supabase/postgrest:v14.18), one session each time:
--
--   live project   a P0002 refusal answered in 76 ms and 128 ms; the stale-token edit was still
--                  unanswered at 30 s and the edge returned HTTP 504 "upstream request timeout" at
--                  125 s. The owner's read-back showed the row untouched: the customer waited two
--                  minutes for a message that already existed in the routine.
--   local v14.18   errcode 40001 unanswered at 40 s and 40P01 unanswered at 20 s, while P0001
--                  answered in 253 ms and a private-use DW001 in 181 ms, and P0001/DW001 answered
--                  again (124 ms / 15 ms) after both stalls, so the stall belonged to the code and
--                  not to the session or a wedged pool.
--
-- SQLSTATE 40001 (serialization_failure) and 40P01 (deadlock_detected) are the two codes whose
-- standard meaning is "roll this transaction back and run it again". A PostgREST built on that
-- reading re-runs the raise instead of answering it, so a refusal raised with 40001 is a refusal
-- nobody can see. The Stage 4 design comment claimed PostgREST reports 40001 "as a stable conflict
-- code"; on the build that serves this project it does not report it at all.
--
-- So both edit routines now raise the conflict with DW001, a private-use SQLSTATE outside the
-- retryable pair that every transport forwards as an ordinary refusal with its code intact. These
-- bodies are generated from the definitions this file replaces, byte for byte except the errcode:
-- update_client from 20260814170000_current_stage4_persistent_edits.sql and
-- update_receivable_details from 20261004170000_current_arc2_ledger_required_blank_class.sql,
-- which is the definition still in force for that routine. The customer-facing wording is
-- unchanged, because the client's conflict copy keys on that wording as well as the code
-- (client/src/data/supabase-adapters.ts), so the same screen text is produced before and after.
-- Nothing about the conflict itself changes: the token is still required, still compared before any
-- write, and a stale edit still cannot touch the row.
--
-- Out of scope, and recorded rather than repaired: the Stage 5 idempotency refusals raise 40901,
-- which is also class 40 but was measured to answer promptly (HTTP 500 in 27 ms on the same build
-- and session) and whose wording the adapter already renders, so it is a rough edge, not this
-- defect. supabase/tests/stage4_02_edit_conflict_code.sql sweeps for the two codes that were
-- measured swallowing a reply rather than all of class 40, for exactly that reason.

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
    raise exception 'This client changed in another session' using errcode = 'DW001';
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


create or replace function public.update_receivable_details(p_receivable_id uuid, p_label text, p_invoice_ref text default '', p_notes text default '', p_expected_updated_at timestamptz default null)
    returns public.receivables
    language plpgsql
    security definer
    set search_path to 'public', 'auth', 'pg_temp'
as $update_receivable$
declare
  v_owner uuid := auth.uid();
  v_row public.receivables;
  c_ws constant text := E' \t\n\r\f\v'
      || E'\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a'
      || E'\u2028\u2029\u202f\u205f\u3000\ufeff';
  v_label text := nullif(btrim(coalesce(p_label, ''), c_ws), '');
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
    raise exception 'This receivable changed in another session' using errcode = 'DW001';
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
$update_receivable$;

-- Re-stating the fail-closed posture in the file that changes the body, so the
-- grant set is readable here and the routines stay executable by the browser
-- role only: a signed-out visitor keeps no path to either one.
grant execute on function public.update_client(uuid, text, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.update_receivable_details(uuid, text, text, text, timestamptz) to authenticated;

revoke all on function public.update_client(uuid, text, text, text, text, text, timestamptz) from public, anon;
revoke all on function public.update_receivable_details(uuid, text, text, text, timestamptz) from public, anon;

comment on function public.update_client is 'Owner-scoped edit of the five descriptive client fields. Requires the caller''s last-read updated_at.';
comment on function public.update_receivable_details is 'Owner-scoped edit of receivable label, invoice reference and notes. Financial columns and due_date are not reachable.';
