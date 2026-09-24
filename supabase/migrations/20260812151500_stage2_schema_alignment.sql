-- Stage 2 alignment migration: keep the database reproducible while bringing the
-- initial secure foundation into line with the approved PROJECT AR-1 model.

-- Profiles retain auth.users as the identity source; business/profile fields are owner-editable.
alter table public.profiles add column if not exists business_name text not null default '' check (char_length(business_name) <= 160);
alter table public.profiles add column if not exists timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64);
alter table public.profiles add column if not exists currency text not null default 'INR' check (currency = 'INR');

-- Use specification-aligned business names while retaining the outstanding balance required by payment workflows.
alter table public.receivables rename column title to label;
alter table public.receivables drop constraint if exists receivables_status_check;
alter table public.receivables add constraint receivables_status_check
  check (status in ('OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'WRITTEN_OFF'));
alter table public.receivables drop constraint if exists receivables_check;
alter table public.receivables add constraint receivables_financial_state_check check (
  (status = 'PAID' and outstanding_paise = 0)
  or (status = 'PARTIALLY_PAID' and outstanding_paise > 0 and outstanding_paise < amount_due_paise)
  or (status = 'OPEN' and outstanding_paise = amount_due_paise)
  or (status in ('CANCELLED', 'WRITTEN_OFF') and outstanding_paise >= 0)
);

alter table public.promises add column if not exists updated_at timestamptz not null default now();
alter table public.promises drop constraint if exists promises_source_check;
alter table public.promises add constraint promises_source_check
  check (source in ('WHATSAPP', 'CALL', 'EMAIL', 'MEETING', 'OTHER'));

alter table public.payments rename column paid_date to paid_on;
alter table public.payments add column if not exists note text check (note is null or char_length(note) <= 2_000);
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('UPI', 'BANK_TRANSFER', 'CASH', 'OTHER'));

alter table public.activities add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.activities alter column note drop not null;
alter table public.activities drop constraint if exists activities_type_check;
alter table public.activities add constraint activities_type_check check (
  type in (
    'FOLLOW_UP_RECORDED', 'PROMISE_CREATED', 'PROMISE_STATUS_CHANGED', 'PAYMENT_RECORDED',
    'RECEIVABLE_CREATED', 'SNOOZED', 'NOTE_ADDED'
  )
);
alter table public.activities add constraint activities_metadata_allowlist check (
  jsonb_typeof(metadata) = 'object'
  and metadata - array['surface', 'reason', 'template_id', 'source'] = '{}'::jsonb
);

alter table public.promise_events rename column event_type to to_status;
alter table public.promise_events rename column detail to reason;
alter table public.promise_events add column if not exists from_status text;
alter table public.promise_events add column if not exists actor_type text not null default 'USER';
alter table public.promise_events drop constraint if exists promise_events_event_type_check;
alter table public.promise_events add constraint promise_events_to_status_check
  check (to_status in ('ACTIVE', 'KEPT', 'PARTIALLY_KEPT', 'BROKEN', 'RENEGOTIATED', 'CANCELLED'));
alter table public.promise_events add constraint promise_events_from_status_check
  check (from_status is null or from_status in ('ACTIVE', 'KEPT', 'PARTIALLY_KEPT', 'BROKEN', 'RENEGOTIATED', 'CANCELLED'));
alter table public.promise_events add constraint promise_events_actor_check
  check (actor_type in ('USER', 'SYSTEM'));

alter table public.entitlements rename column owner_id to user_id;
alter table public.entitlements rename column tier to plan;
alter table public.entitlements add column if not exists id uuid not null default gen_random_uuid();
alter table public.entitlements add column if not exists status text not null default 'ACTIVE';
alter table public.entitlements add column if not exists activated_at timestamptz;
alter table public.entitlements add column if not exists reviewed_by uuid;
alter table public.entitlements add column if not exists reviewed_at timestamptz;
alter table public.entitlements add constraint entitlements_id_unique unique (id);
alter table public.entitlements drop constraint if exists entitlements_source_check;
alter table public.entitlements add constraint entitlements_source_check check (source in ('DEFAULT', 'MANUAL', 'PURCHASE'));
alter table public.entitlements add constraint entitlements_status_check check (status in ('ACTIVE', 'PENDING_REVIEW', 'REVOKED'));

alter table public.purchase_claims rename column external_reference to utr_reference;
alter table public.purchase_claims rename column provider to payer_name;
alter table public.purchase_claims add column if not exists claim_id text not null default gen_random_uuid()::text;
alter table public.purchase_claims add column if not exists plan text not null default 'FOUNDER';
alter table public.purchase_claims add column if not exists amount_paise bigint not null default 0;
alter table public.purchase_claims add column if not exists submitted_at timestamptz not null default now();
alter table public.purchase_claims add column if not exists reviewed_at timestamptz;
alter table public.purchase_claims add column if not exists reviewed_by uuid;
alter table public.purchase_claims add column if not exists review_note text;
alter table public.purchase_claims drop constraint if exists purchase_claims_status_check;
alter table public.purchase_claims add constraint purchase_claims_status_check check (status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED'));
alter table public.purchase_claims add constraint purchase_claims_plan_check check (plan = 'FOUNDER');
alter table public.purchase_claims add constraint purchase_claims_amount_check check (amount_paise > 0);
alter table public.purchase_claims add constraint purchase_claims_claim_id_unique unique (claim_id);

alter table public.analytics_events alter column owner_id drop not null;
alter table public.analytics_events add column if not exists entity_type text check (entity_type is null or char_length(entity_type) <= 64);
alter table public.analytics_events add column if not exists entity_id uuid;
alter table public.analytics_events add constraint analytics_metadata_allowlist check (
  jsonb_typeof(metadata) = 'object'
  and metadata - array['surface', 'source', 'action'] = '{}'::jsonb
);

-- Recreate supporting timestamp trigger now that promises participate in the same model.
drop trigger if exists promises_updated_at on public.promises;
create trigger promises_updated_at before update on public.promises for each row execute procedure public.set_updated_at();

-- All nested references must belong to the requesting owner and to one another.
create or replace function public.assert_activity_ownership()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_client_owner uuid;
  v_receivable_owner uuid;
  v_promise_owner uuid;
  v_receivable_client uuid;
  v_promise_receivable uuid;
begin
  if new.client_id is not null then
    select owner_id into v_client_owner from public.clients where id = new.client_id;
    if v_client_owner is null or v_client_owner <> new.owner_id then raise exception 'Client is not available for this account'; end if;
  end if;
  if new.receivable_id is not null then
    select owner_id, client_id into v_receivable_owner, v_receivable_client from public.receivables where id = new.receivable_id;
    if v_receivable_owner is null or v_receivable_owner <> new.owner_id then raise exception 'Receivable is not available for this account'; end if;
    if new.client_id is not null and new.client_id <> v_receivable_client then raise exception 'Activity client does not match receivable'; end if;
  end if;
  if new.promise_id is not null then
    select owner_id, receivable_id into v_promise_owner, v_promise_receivable from public.promises where id = new.promise_id;
    if v_promise_owner is null or v_promise_owner <> new.owner_id then raise exception 'Promise is not available for this account'; end if;
    if new.receivable_id is not null and new.receivable_id <> v_promise_receivable then raise exception 'Activity receivable does not match promise'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.assert_promise_event_ownership()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_owner uuid;
  v_receivable uuid;
begin
  select owner_id, receivable_id into v_owner, v_receivable from public.promises where id = new.promise_id;
  if v_owner is null or v_owner <> new.owner_id or v_receivable <> new.receivable_id then
    raise exception 'Promise event is not available for this account';
  end if;
  return new;
end;
$$;

drop trigger if exists promise_events_verify_parent_owner on public.promise_events;
create trigger promise_events_verify_parent_owner before insert or update on public.promise_events
  for each row execute procedure public.assert_promise_event_ownership();

-- Keep the free-tier decision exclusively in the entitlement row and database trigger.
create or replace function public.enforce_free_receivable_limit()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_plan text;
  v_status text;
  v_active_count integer;
begin
  if new.status not in ('OPEN', 'PARTIALLY_PAID') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('OPEN', 'PARTIALLY_PAID') then return new; end if;
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
  select plan, status into v_plan, v_status from public.entitlements where user_id = new.owner_id;
  if coalesce(v_plan, 'FREE') = 'FOUNDER' and coalesce(v_status, 'ACTIVE') = 'ACTIVE' then return new; end if;
  select count(*) into v_active_count from public.receivables
    where owner_id = new.owner_id and status in ('OPEN', 'PARTIALLY_PAID');
  if v_active_count >= 3 then raise exception 'Free plan allows up to 3 active receivables'; end if;
  return new;
end;
$$;

-- Auth trigger is the only ordinary-user profile/entitlement creation path.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, auth, pg_temp as $$
begin
  insert into public.profiles (id, display_name, plan)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''), 'FREE')
  on conflict (id) do nothing;
  insert into public.entitlements (user_id, plan, status, source)
  values (new.id, 'FREE', 'ACTIVE', 'DEFAULT')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Replace application write functions with transaction-safe, specification-aligned variants.
drop function if exists public.create_client_and_receivable(text, text, text, text, text, text, text, bigint, date, text);
drop function if exists public.record_payment(uuid, bigint, date, text, text);

create or replace function public.create_client_and_receivable(
  p_client_name text, p_company text, p_phone text, p_email text, p_client_notes text,
  p_label text, p_invoice_ref text, p_amount_due_paise bigint, p_due_date date, p_notes text
)
returns public.receivables language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_owner uuid := auth.uid(); v_client public.clients; v_receivable public.receivables;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  insert into public.clients(owner_id, name, company, phone, email, notes)
    values(v_owner, p_client_name, coalesce(p_company, ''), nullif(p_phone, ''), nullif(p_email, ''), nullif(p_client_notes, '')) returning * into v_client;
  insert into public.receivables(owner_id, client_id, label, invoice_ref, amount_due_paise, outstanding_paise, due_date, notes, status)
    values(v_owner, v_client.id, p_label, nullif(p_invoice_ref, ''), p_amount_due_paise, p_amount_due_paise, p_due_date, nullif(p_notes, ''), 'OPEN') returning * into v_receivable;
  insert into public.activities(owner_id, client_id, receivable_id, type, note, metadata)
    values(v_owner, v_client.id, v_receivable.id, 'RECEIVABLE_CREATED', 'Receivable created', jsonb_build_object('surface', 'receivable'));
  return v_receivable;
end;
$$;

create or replace function public.create_promise(
  p_receivable_id uuid, p_promised_amount_paise bigint, p_promised_date date, p_source text, p_note text
)
returns public.promises language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_owner uuid := auth.uid(); v_receivable public.receivables; v_active public.promises; v_promise public.promises; v_sequence integer;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found then raise exception 'Receivable is not available for this account'; end if;
  if v_receivable.status in ('PAID', 'CANCELLED', 'WRITTEN_OFF') then raise exception 'A promise cannot be added to a closed receivable'; end if;
  if p_promised_amount_paise <= 0 or p_promised_amount_paise > v_receivable.outstanding_paise then raise exception 'Promised amount must be within the remaining balance'; end if;
  select * into v_active from public.promises where receivable_id = p_receivable_id and status = 'ACTIVE' for update;
  if found then
    perform set_config('app.ar1_write_context', 'promise', true);
    update public.promises set status = 'RENEGOTIATED', resolved_at = now() where id = v_active.id;
    insert into public.promise_events(owner_id, promise_id, receivable_id, from_status, to_status, reason, actor_type)
      values(v_owner, v_active.id, p_receivable_id, 'ACTIVE', 'RENEGOTIATED', 'Superseded by a new promise', 'USER');
  end if;
  select coalesce(max(sequence_no), 0) + 1 into v_sequence from public.promises where receivable_id = p_receivable_id;
  insert into public.promises(owner_id, receivable_id, sequence_no, promised_amount_paise, promised_date, source, note)
    values(v_owner, p_receivable_id, v_sequence, p_promised_amount_paise, p_promised_date, upper(p_source), nullif(p_note, '')) returning * into v_promise;
  insert into public.promise_events(owner_id, promise_id, receivable_id, from_status, to_status, reason, actor_type)
    values(v_owner, v_promise.id, p_receivable_id, null, 'ACTIVE', 'Promise recorded', 'USER');
  insert into public.activities(owner_id, client_id, receivable_id, promise_id, type, note, metadata)
    values(v_owner, v_receivable.client_id, p_receivable_id, v_promise.id, 'PROMISE_CREATED', 'Promise recorded', jsonb_build_object('source', upper(p_source)));
  return v_promise;
end;
$$;

create or replace function public.record_payment(
  p_receivable_id uuid, p_amount_paise bigint, p_paid_on date, p_method text, p_reference text, p_note text default null
)
returns public.payments language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_owner uuid := auth.uid(); v_receivable public.receivables; v_payment public.payments; v_outstanding bigint; v_active public.promises;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found then raise exception 'Receivable is not available for this account'; end if;
  if p_amount_paise <= 0 or p_amount_paise > v_receivable.outstanding_paise then raise exception 'Payment must be within the remaining balance'; end if;
  insert into public.payments(owner_id, receivable_id, amount_paise, paid_on, method, reference, note)
    values(v_owner, p_receivable_id, p_amount_paise, p_paid_on, upper(replace(p_method, ' ', '_')), nullif(p_reference, ''), nullif(p_note, '')) returning * into v_payment;
  v_outstanding := v_receivable.outstanding_paise - p_amount_paise;
  perform set_config('app.ar1_write_context', 'payment', true);
  update public.receivables set outstanding_paise = v_outstanding, status = case when v_outstanding = 0 then 'PAID' else 'PARTIALLY_PAID' end where id = p_receivable_id;
  select * into v_active from public.promises where receivable_id = p_receivable_id and status = 'ACTIVE' for update;
  if found then
    perform set_config('app.ar1_write_context', 'promise', true);
    update public.promises set status = case when v_outstanding = 0 then 'KEPT' else 'PARTIALLY_KEPT' end, resolved_at = now() where id = v_active.id;
    insert into public.promise_events(owner_id, promise_id, receivable_id, from_status, to_status, reason, actor_type)
      values(v_owner, v_active.id, p_receivable_id, 'ACTIVE', case when v_outstanding = 0 then 'KEPT' else 'PARTIALLY_KEPT' end, 'Payment recorded against promise', 'SYSTEM');
  end if;
  insert into public.activities(owner_id, client_id, receivable_id, type, note, metadata)
    values(v_owner, v_receivable.client_id, p_receivable_id, 'PAYMENT_RECORDED', 'Payment recorded', jsonb_build_object('source', 'payment'));
  return v_payment;
end;
$$;

create or replace function public.record_contacted(p_receivable_id uuid, p_note text default 'Follow-up recorded')
returns public.activities language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_owner uuid := auth.uid(); v_receivable public.receivables; v_activity public.activities;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner;
  if not found then raise exception 'Receivable is not available for this account'; end if;
  insert into public.activities(owner_id, client_id, receivable_id, type, note, metadata)
    values(v_owner, v_receivable.client_id, p_receivable_id, 'FOLLOW_UP_RECORDED', coalesce(nullif(p_note, ''), 'Follow-up recorded'), jsonb_build_object('surface', 'today')) returning * into v_activity;
  return v_activity;
end;
$$;

-- Table RLS remains the default boundary. The only browser writes are safe owner-scoped client/profile fields;
-- financial writes proceed through the authenticated RPC transaction functions above.
drop policy if exists entitlements_select_own on public.entitlements;
create policy entitlements_select_own on public.entitlements for select using (user_id = auth.uid());
drop policy if exists analytics_owner_select on public.analytics_events;
create policy analytics_owner_select on public.analytics_events for select using (owner_id = auth.uid());
drop policy if exists analytics_owner_insert on public.analytics_events;
create policy analytics_owner_insert on public.analytics_events for insert with check (owner_id = auth.uid());

revoke all on function public.record_payment(uuid, bigint, date, text, text, text) from public;
grant execute on function public.record_payment(uuid, bigint, date, text, text, text) to authenticated;

comment on table public.entitlements is 'Protected entitlement state; ordinary users only have SELECT access to their own row.';
comment on table public.promise_events is 'Immutable promise-status audit trail. Writes only occur through protected transactional workflows.';
