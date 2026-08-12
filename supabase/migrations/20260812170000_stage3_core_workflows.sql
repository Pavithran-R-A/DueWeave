-- Stage 3 core workflow hardening. These functions keep multi-row financial
-- transitions atomic, derive identity from auth.uid(), and leave the ordinary
-- browser with only the narrow RPC surface it needs.

create or replace function public.assert_stage3_client_input(
  p_name text, p_phone text, p_email text, p_notes text
)
returns table (name text, phone text, email text, notes text)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := nullif(regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_digits text;
begin
  if v_name is null or char_length(v_name) > 160 then
    raise exception 'Add a client name of up to 160 characters';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'Add a valid email address or leave it blank';
  end if;
  if v_phone is not null then
    v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
    if char_length(v_digits) < 10 or char_length(v_digits) > 15 then
      raise exception 'Add a valid phone number or leave it blank';
    end if;
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'Notes can be up to 2,000 characters';
  end if;
  return query select v_name, v_phone, v_email, v_notes;
end;
$$;

create or replace function public.create_client(
  p_name text, p_company text default '', p_phone text default '', p_email text default '', p_notes text default ''
)
returns public.clients
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_input record;
  v_client public.clients;
  v_company text := nullif(btrim(coalesce(p_company, '')), '');
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  select * into v_input from public.assert_stage3_client_input(p_name, p_phone, p_email, p_notes);
  if v_company is not null and char_length(v_company) > 160 then raise exception 'Business name can be up to 160 characters'; end if;
  insert into public.clients(owner_id, name, company, phone, email, notes)
    values(v_owner, v_input.name, coalesce(v_company, ''), v_input.phone, v_input.email, v_input.notes)
    returning * into v_client;
  return v_client;
end;
$$;

create or replace function public.create_receivable(
  p_client_id uuid, p_label text, p_invoice_ref text, p_amount_due_paise bigint, p_due_date date, p_notes text default ''
)
returns public.receivables
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_client public.clients;
  v_receivable public.receivables;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_reference text := nullif(btrim(coalesce(p_invoice_ref, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  if p_amount_due_paise is null or p_amount_due_paise <= 0 or p_amount_due_paise > 900000000000000 then
    raise exception 'Add a valid positive receivable amount';
  end if;
  if p_due_date is null then raise exception 'Add a due date'; end if;
  if v_label is null or char_length(v_label) > 240 then raise exception 'Add a receivable label of up to 240 characters'; end if;
  if v_reference is not null and char_length(v_reference) > 160 then raise exception 'Reference can be up to 160 characters'; end if;
  if v_notes is not null and char_length(v_notes) > 2000 then raise exception 'Notes can be up to 2,000 characters'; end if;
  select * into v_client from public.clients where id = p_client_id and owner_id = v_owner and archived_at is null for update;
  if not found then raise exception 'Client is not available for this account'; end if;
  insert into public.receivables(owner_id, client_id, label, invoice_ref, amount_due_paise, outstanding_paise, due_date, notes, status)
    values(v_owner, v_client.id, v_label, v_reference, p_amount_due_paise, p_amount_due_paise, p_due_date, v_notes, 'OPEN')
    returning * into v_receivable;
  insert into public.activities(owner_id, client_id, receivable_id, type, note, metadata)
    values(v_owner, v_client.id, v_receivable.id, 'RECEIVABLE_CREATED', 'Receivable created', jsonb_build_object('surface', 'receivable'));
  return v_receivable;
end;
$$;

create or replace function public.create_client_and_receivable(
  p_client_name text, p_company text, p_phone text, p_email text, p_client_notes text,
  p_label text, p_invoice_ref text, p_amount_due_paise bigint, p_due_date date, p_notes text
)
returns public.receivables
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  v_client public.clients;
begin
  select * into v_client from public.create_client(p_client_name, p_company, p_phone, p_email, p_client_notes);
  return public.create_receivable(v_client.id, p_label, p_invoice_ref, p_amount_due_paise, p_due_date, p_notes);
end;
$$;

-- The current user's timezone defines their business date. This function is
-- intentionally lazy: any dashboard read or promise action can make overdue
-- ACTIVE promises BROKEN, and only the ACTIVE -> BROKEN transition emits an event.
create or replace function public.mark_due_promises_broken()
returns integer
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_timezone text;
  v_business_date date;
  v_promise public.promises;
  v_count integer := 0;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  select timezone into v_timezone from public.profiles where id = v_owner;
  v_business_date := (now() at time zone coalesce(v_timezone, 'Asia/Kolkata'))::date;
  for v_promise in
    select p.* from public.promises p
    join public.receivables r on r.id = p.receivable_id
    where p.owner_id = v_owner and p.status = 'ACTIVE' and p.promised_date < v_business_date
      and r.status in ('OPEN', 'PARTIALLY_PAID')
    for update
  loop
    perform set_config('app.ar1_write_context', 'promise', true);
    update public.promises set status = 'BROKEN', resolved_at = now() where id = v_promise.id and status = 'ACTIVE';
    if found then
      insert into public.promise_events(owner_id, promise_id, receivable_id, from_status, to_status, reason, actor_type)
        values(v_owner, v_promise.id, v_promise.receivable_id, 'ACTIVE', 'BROKEN', 'Promise date passed without a recorded full payment', 'SYSTEM');
      insert into public.activities(owner_id, client_id, receivable_id, promise_id, type, note, metadata)
        select v_owner, r.client_id, v_promise.receivable_id, v_promise.id, 'PROMISE_STATUS_CHANGED', 'Promise marked broken', jsonb_build_object('reason', 'business_date_passed')
        from public.receivables r where r.id = v_promise.receivable_id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.create_promise(
  p_receivable_id uuid, p_promised_amount_paise bigint, p_promised_date date, p_source text, p_note text
)
returns public.promises language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_owner uuid := auth.uid(); v_receivable public.receivables; v_active public.promises; v_promise public.promises; v_sequence integer;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  perform public.mark_due_promises_broken();
  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found then raise exception 'Receivable is not available for this account'; end if;
  if v_receivable.status in ('PAID', 'CANCELLED', 'WRITTEN_OFF') then raise exception 'A promise cannot be added to a closed receivable'; end if;
  if p_promised_amount_paise is null or p_promised_amount_paise <= 0 or p_promised_amount_paise > v_receivable.outstanding_paise then raise exception 'Promised amount must be within the remaining balance'; end if;
  if p_promised_date is null then raise exception 'Add a promised business date'; end if;
  if upper(coalesce(p_source, '')) not in ('WHATSAPP', 'CALL', 'EMAIL', 'MEETING', 'OTHER') then raise exception 'Choose a valid promise source'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is not null and char_length(btrim(p_note)) > 2000 then raise exception 'Notes can be up to 2,000 characters'; end if;
  select * into v_active from public.promises where receivable_id = p_receivable_id and status = 'ACTIVE' for update;
  if found then
    perform set_config('app.ar1_write_context', 'promise', true);
    update public.promises set status = 'RENEGOTIATED', resolved_at = now() where id = v_active.id;
    insert into public.promise_events(owner_id, promise_id, receivable_id, from_status, to_status, reason, actor_type)
      values(v_owner, v_active.id, p_receivable_id, 'ACTIVE', 'RENEGOTIATED', 'Superseded by a new promise', 'USER');
  end if;
  select coalesce(max(sequence_no), 0) + 1 into v_sequence from public.promises where receivable_id = p_receivable_id;
  insert into public.promises(owner_id, receivable_id, sequence_no, promised_amount_paise, promised_date, source, note)
    values(v_owner, p_receivable_id, v_sequence, p_promised_amount_paise, p_promised_date, upper(p_source), nullif(btrim(p_note), '')) returning * into v_promise;
  insert into public.promise_events(owner_id, promise_id, receivable_id, from_status, to_status, reason, actor_type)
    values(v_owner, v_promise.id, p_receivable_id, null, 'ACTIVE', 'Promise recorded', 'USER');
  insert into public.activities(owner_id, client_id, receivable_id, promise_id, type, note, metadata)
    values(v_owner, v_receivable.client_id, p_receivable_id, v_promise.id, 'PROMISE_CREATED', 'Promise recorded', jsonb_build_object('source', upper(p_source)));
  return v_promise;
end;
$$;

alter table public.activities drop constraint if exists activities_metadata_allowlist;
alter table public.activities add constraint activities_metadata_allowlist check (
  jsonb_typeof(metadata) = 'object'
  and metadata - array['surface', 'reason', 'template_id', 'source', 'snoozed_until', 'channel'] = '{}'::jsonb
);

create or replace function public.snooze_receivable(p_receivable_id uuid, p_until date)
returns public.activities
language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_receivable public.receivables;
  v_activity public.activities;
  v_timezone text;
  v_business_date date;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  select timezone into v_timezone from public.profiles where id = v_owner;
  v_business_date := (now() at time zone coalesce(v_timezone, 'Asia/Kolkata'))::date;
  if p_until is null or p_until < v_business_date then raise exception 'Choose today or a future snooze date'; end if;
  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found or v_receivable.status not in ('OPEN', 'PARTIALLY_PAID') then raise exception 'Receivable is not available to snooze'; end if;
  insert into public.activities(owner_id, client_id, receivable_id, type, note, metadata)
    values(v_owner, v_receivable.client_id, p_receivable_id, 'SNOOZED', 'Follow-up snoozed', jsonb_build_object('snoozed_until', p_until::text, 'surface', 'today'))
    returning * into v_activity;
  return v_activity;
end;
$$;

revoke all on function public.assert_stage3_client_input(text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_client(text, text, text, text, text) from public, anon;
revoke all on function public.create_receivable(uuid, text, text, bigint, date, text) from public, anon;
revoke all on function public.create_client_and_receivable(text, text, text, text, text, text, text, bigint, date, text) from public, anon;
revoke all on function public.mark_due_promises_broken() from public, anon;
revoke all on function public.create_promise(uuid, bigint, date, text, text) from public, anon;
revoke all on function public.snooze_receivable(uuid, date) from public, anon;
grant execute on function public.create_client(text, text, text, text, text) to authenticated;
grant execute on function public.create_receivable(uuid, text, text, bigint, date, text) to authenticated;
grant execute on function public.create_client_and_receivable(text, text, text, text, text, text, text, bigint, date, text) to authenticated;
grant execute on function public.mark_due_promises_broken() to authenticated;
grant execute on function public.create_promise(uuid, bigint, date, text, text) to authenticated;
grant execute on function public.snooze_receivable(uuid, date) to authenticated;
