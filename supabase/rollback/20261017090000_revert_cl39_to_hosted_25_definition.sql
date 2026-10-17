-- Forward-restore file: the two edit routines exactly as production held them at 25
-- migrations, read from the live catalog with pg_get_functiondef on 2026-10-17 through the
-- credential path scripts/hosted-db-census.mjs uses, and re-emitted by
-- scripts/hosted-migration-qualification.mjs. Running this file undoes migration
-- 20261017090000_current_cl39_edit_conflict_errcode_reachable.sql: it restores the conflict
-- raise to SQLSTATE 40001, which is what made a stale edit unreachable (see
-- docs/CONSUMER_LIVE_PROGRESS.md, "Migration 26 qualification against production").
-- Captured md5 (each digest is md5 of the definition below it, newline included): update_client 4563d2577760a1ff4c72d4f8b3888e14, update_receivable_details 75090b6ed5a5b273949f6ba5a86d7bea.
CREATE OR REPLACE FUNCTION public.update_client(p_client_id uuid, p_name text, p_company text DEFAULT ''::text, p_phone text DEFAULT ''::text, p_email text DEFAULT ''::text, p_notes text DEFAULT ''::text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS clients
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.update_receivable_details(p_receivable_id uuid, p_label text, p_invoice_ref text DEFAULT ''::text, p_notes text DEFAULT ''::text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS receivables
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
$function$
;
