-- PROJECT AR-1 Stage 2: secure owned-data foundation.
-- This migration is the source of truth for schema, integrity, RLS, and RPC workflows.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  plan text not null default 'FREE' check (plan in ('FREE', 'FOUNDER')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  company text not null default '',
  phone text,
  email text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.receivables (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 240),
  invoice_ref text,
  amount_due_paise bigint not null check (amount_due_paise > 0),
  outstanding_paise bigint not null check (outstanding_paise >= 0 and outstanding_paise <= amount_due_paise),
  due_date date not null,
  notes text,
  status text not null default 'OPEN' check (status in ('OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'PAID' and outstanding_paise = 0)
    or (status = 'PARTIALLY_PAID' and outstanding_paise > 0 and outstanding_paise < amount_due_paise)
    or (status = 'OPEN' and outstanding_paise = amount_due_paise)
    or (status = 'CANCELLED' and outstanding_paise >= 0)
  )
);

create table if not exists public.promises (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  receivable_id uuid not null references public.receivables(id) on delete cascade,
  sequence_no integer not null check (sequence_no > 0),
  promised_amount_paise bigint not null check (promised_amount_paise > 0),
  promised_date date not null,
  source text not null check (source in ('WhatsApp', 'Call', 'Email', 'Meeting', 'Other')),
  note text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'KEPT', 'PARTIALLY_KEPT', 'BROKEN', 'RENEGOTIATED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (receivable_id, sequence_no)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  receivable_id uuid not null references public.receivables(id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0),
  paid_date date not null,
  method text not null check (method in ('UPI', 'Bank transfer', 'Cash', 'Other')),
  reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  receivable_id uuid references public.receivables(id) on delete cascade,
  promise_id uuid references public.promises(id) on delete set null,
  type text not null check (type in ('created', 'due', 'follow_up', 'contacted', 'promise', 'broken', 'payment', 'note')),
  occurred_at timestamptz not null default now(),
  note text not null default '',
  amount_paise bigint check (amount_paise is null or amount_paise > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.promise_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  promise_id uuid not null references public.promises(id) on delete cascade,
  receivable_id uuid not null references public.receivables(id) on delete cascade,
  event_type text not null check (event_type in ('CREATED', 'KEPT', 'PARTIALLY_KEPT', 'BROKEN', 'RENEGOTIATED', 'CANCELLED')),
  occurred_at timestamptz not null default now(),
  detail text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.entitlements (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  tier text not null default 'FREE' check (tier in ('FREE', 'FOUNDER')),
  updated_at timestamptz not null default now(),
  source text not null default 'DEFAULT' check (source in ('DEFAULT', 'MANUAL', 'PURCHASE'))
);

create table if not exists public.purchase_claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  external_reference text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'REJECTED')),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (provider, external_reference)
);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  event_name text not null check (char_length(trim(event_name)) between 1 and 120),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists clients_owner_idx on public.clients(owner_id, archived_at, created_at desc);
create index if not exists receivables_owner_status_due_idx on public.receivables(owner_id, status, due_date);
create index if not exists receivables_client_idx on public.receivables(client_id, created_at desc);
create index if not exists promises_owner_status_date_idx on public.promises(owner_id, status, promised_date);
create index if not exists promises_receivable_idx on public.promises(receivable_id, sequence_no desc);
create index if not exists payments_owner_date_idx on public.payments(owner_id, paid_date desc);
create index if not exists payments_receivable_idx on public.payments(receivable_id, paid_date desc);
create index if not exists activities_owner_timeline_idx on public.activities(owner_id, occurred_at desc);
create index if not exists activities_receivable_timeline_idx on public.activities(receivable_id, occurred_at desc);
create index if not exists promise_events_owner_timeline_idx on public.promise_events(owner_id, occurred_at desc);
create index if not exists promise_events_promise_idx on public.promise_events(promise_id, occurred_at desc);
create index if not exists analytics_owner_timeline_idx on public.analytics_events(owner_id, occurred_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.profiles (id, display_name, plan)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''), 'FREE')
  on conflict (id) do nothing;

  insert into public.entitlements (owner_id, tier, source)
  values (new.id, 'FREE', 'DEFAULT')
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

create or replace function public.prevent_profile_entitlement_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Profile identity cannot be changed';
  end if;
  if new.plan is distinct from old.plan then
    raise exception 'Plan changes require a protected entitlement workflow';
  end if;
  return new;
end;
$$;

create or replace function public.assert_owned_client()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_client_owner uuid;
begin
  select owner_id into v_client_owner from public.clients where id = new.client_id;
  if v_client_owner is null or v_client_owner <> new.owner_id then
    raise exception 'Client is not available for this account';
  end if;
  return new;
end;
$$;

create or replace function public.assert_owned_receivable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_receivable_owner uuid;
begin
  select owner_id into v_receivable_owner from public.receivables where id = new.receivable_id;
  if v_receivable_owner is null or v_receivable_owner <> new.owner_id then
    raise exception 'Receivable is not available for this account';
  end if;
  return new;
end;
$$;

create or replace function public.assert_activity_ownership()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  if new.client_id is not null then
    select owner_id into v_owner from public.clients where id = new.client_id;
    if v_owner is null or v_owner <> new.owner_id then raise exception 'Client is not available for this account'; end if;
  end if;
  if new.receivable_id is not null then
    select owner_id into v_owner from public.receivables where id = new.receivable_id;
    if v_owner is null or v_owner <> new.owner_id then raise exception 'Receivable is not available for this account'; end if;
  end if;
  if new.promise_id is not null then
    select owner_id into v_owner from public.promises where id = new.promise_id;
    if v_owner is null or v_owner <> new.owner_id then raise exception 'Promise is not available for this account'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_free_receivable_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_active_count integer;
begin
  if new.status not in ('OPEN', 'PARTIALLY_PAID') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('OPEN', 'PARTIALLY_PAID') then return new; end if;

  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
  select tier into v_plan from public.entitlements where owner_id = new.owner_id;
  if coalesce(v_plan, 'FREE') = 'FOUNDER' then return new; end if;

  select count(*) into v_active_count
  from public.receivables
  where owner_id = new.owner_id and status in ('OPEN', 'PARTIALLY_PAID');

  if v_active_count >= 3 then
    raise exception 'Free plan allows up to 3 active receivables';
  end if;
  return new;
end;
$$;

create or replace function public.guard_receivable_financial_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.owner_id is distinct from old.owner_id or new.client_id is distinct from old.client_id
    or new.amount_due_paise is distinct from old.amount_due_paise
    or new.outstanding_paise is distinct from old.outstanding_paise
    or new.status is distinct from old.status then
    if current_setting('app.ar1_write_context', true) <> 'payment' then
      raise exception 'Financial fields require a protected workflow';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_promise_history()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Promise history cannot be deleted';
  end if;
  if new.owner_id is distinct from old.owner_id
    or new.receivable_id is distinct from old.receivable_id
    or new.sequence_no is distinct from old.sequence_no
    or new.promised_amount_paise is distinct from old.promised_amount_paise
    or new.promised_date is distinct from old.promised_date
    or new.source is distinct from old.source
    or new.note is distinct from old.note then
    raise exception 'Promise facts cannot be rewritten';
  end if;
  if old.status <> 'ACTIVE' then
    raise exception 'Resolved promises cannot be changed';
  end if;
  if current_setting('app.ar1_write_context', true) <> 'promise' then
    raise exception 'Promise transitions require a protected workflow';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_immutable_history_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Historical records cannot be changed';
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients for each row execute procedure public.set_updated_at();
drop trigger if exists receivables_updated_at on public.receivables;
create trigger receivables_updated_at before update on public.receivables for each row execute procedure public.set_updated_at();
drop trigger if exists entitlements_updated_at on public.entitlements;
create trigger entitlements_updated_at before update on public.entitlements for each row execute procedure public.set_updated_at();

drop trigger if exists profiles_prevent_plan_change on public.profiles;
create trigger profiles_prevent_plan_change before update on public.profiles for each row execute procedure public.prevent_profile_entitlement_change();
drop trigger if exists receivables_verify_client_owner on public.receivables;
create trigger receivables_verify_client_owner before insert or update on public.receivables for each row execute procedure public.assert_owned_client();
drop trigger if exists promises_verify_parent_owner on public.promises;
create trigger promises_verify_parent_owner before insert or update on public.promises for each row execute procedure public.assert_owned_receivable();
drop trigger if exists payments_verify_parent_owner on public.payments;
create trigger payments_verify_parent_owner before insert or update on public.payments for each row execute procedure public.assert_owned_receivable();
drop trigger if exists activities_verify_owner on public.activities;
create trigger activities_verify_owner before insert or update on public.activities for each row execute procedure public.assert_activity_ownership();
drop trigger if exists promise_events_verify_parent_owner on public.promise_events;
create trigger promise_events_verify_parent_owner before insert or update on public.promise_events for each row execute procedure public.assert_owned_receivable();
drop trigger if exists receivables_free_limit on public.receivables;
create trigger receivables_free_limit before insert or update on public.receivables for each row execute procedure public.enforce_free_receivable_limit();
drop trigger if exists receivables_guard_financial_fields on public.receivables;
create trigger receivables_guard_financial_fields before update on public.receivables for each row execute procedure public.guard_receivable_financial_fields();
drop trigger if exists promises_guard_history on public.promises;
create trigger promises_guard_history before update or delete on public.promises for each row execute procedure public.guard_promise_history();
drop trigger if exists payments_immutable on public.payments;
create trigger payments_immutable before update or delete on public.payments for each row execute procedure public.prevent_immutable_history_changes();
drop trigger if exists activities_immutable on public.activities;
create trigger activities_immutable before update or delete on public.activities for each row execute procedure public.prevent_immutable_history_changes();
drop trigger if exists promise_events_immutable on public.promise_events;
create trigger promise_events_immutable before update or delete on public.promise_events for each row execute procedure public.prevent_immutable_history_changes();

create or replace function public.create_client_and_receivable(
  p_client_name text,
  p_company text,
  p_phone text,
  p_email text,
  p_client_notes text,
  p_title text,
  p_invoice_ref text,
  p_amount_due_paise bigint,
  p_due_date date,
  p_notes text
)
returns public.receivables
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_client public.clients;
  v_receivable public.receivables;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  insert into public.clients(owner_id, name, company, phone, email, notes)
  values(v_owner, p_client_name, coalesce(p_company, ''), nullif(p_phone, ''), nullif(p_email, ''), nullif(p_client_notes, ''))
  returning * into v_client;

  insert into public.receivables(owner_id, client_id, title, invoice_ref, amount_due_paise, outstanding_paise, due_date, notes, status)
  values(v_owner, v_client.id, p_title, nullif(p_invoice_ref, ''), p_amount_due_paise, p_amount_due_paise, p_due_date, nullif(p_notes, ''), 'OPEN')
  returning * into v_receivable;

  insert into public.activities(owner_id, client_id, receivable_id, type, note, amount_paise)
  values(v_owner, v_client.id, v_receivable.id, 'created', 'Receivable created', p_amount_due_paise);
  return v_receivable;
end;
$$;

create or replace function public.create_promise(
  p_receivable_id uuid,
  p_promised_amount_paise bigint,
  p_promised_date date,
  p_source text,
  p_note text
)
returns public.promises
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_receivable public.receivables;
  v_active public.promises;
  v_promise public.promises;
  v_sequence integer;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found then raise exception 'Receivable is not available for this account'; end if;
  if v_receivable.status in ('PAID', 'CANCELLED') then raise exception 'A promise cannot be added to a closed receivable'; end if;
  if p_promised_amount_paise <= 0 or p_promised_amount_paise > v_receivable.outstanding_paise then raise exception 'Promised amount must be within the remaining balance'; end if;

  select * into v_active from public.promises where receivable_id = p_receivable_id and status = 'ACTIVE' for update;
  if found then
    perform set_config('app.ar1_write_context', 'promise', true);
    update public.promises set status = 'RENEGOTIATED', resolved_at = now() where id = v_active.id;
    insert into public.promise_events(owner_id, promise_id, receivable_id, event_type, detail)
    values(v_owner, v_active.id, p_receivable_id, 'RENEGOTIATED', 'Superseded by a new promise');
  end if;

  select coalesce(max(sequence_no), 0) + 1 into v_sequence from public.promises where receivable_id = p_receivable_id;
  insert into public.promises(owner_id, receivable_id, sequence_no, promised_amount_paise, promised_date, source, note)
  values(v_owner, p_receivable_id, v_sequence, p_promised_amount_paise, p_promised_date, p_source, nullif(p_note, ''))
  returning * into v_promise;

  insert into public.promise_events(owner_id, promise_id, receivable_id, event_type, detail)
  values(v_owner, v_promise.id, p_receivable_id, 'CREATED', 'Promise recorded');
  insert into public.activities(owner_id, client_id, receivable_id, promise_id, type, note, amount_paise)
  values(v_owner, v_receivable.client_id, p_receivable_id, v_promise.id, 'promise', 'Promise recorded', p_promised_amount_paise);
  return v_promise;
end;
$$;

create or replace function public.record_payment(
  p_receivable_id uuid,
  p_amount_paise bigint,
  p_paid_date date,
  p_method text,
  p_reference text
)
returns public.payments
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_receivable public.receivables;
  v_payment public.payments;
  v_outstanding bigint;
  v_active public.promises;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found then raise exception 'Receivable is not available for this account'; end if;
  if p_amount_paise <= 0 or p_amount_paise > v_receivable.outstanding_paise then raise exception 'Payment must be within the remaining balance'; end if;

  insert into public.payments(owner_id, receivable_id, amount_paise, paid_date, method, reference)
  values(v_owner, p_receivable_id, p_amount_paise, p_paid_date, p_method, nullif(p_reference, ''))
  returning * into v_payment;
  v_outstanding := v_receivable.outstanding_paise - p_amount_paise;
  perform set_config('app.ar1_write_context', 'payment', true);
  update public.receivables
  set outstanding_paise = v_outstanding,
      status = case when v_outstanding = 0 then 'PAID' else 'PARTIALLY_PAID' end
  where id = p_receivable_id;

  select * into v_active from public.promises where receivable_id = p_receivable_id and status = 'ACTIVE' for update;
  if found and v_outstanding = 0 then
    perform set_config('app.ar1_write_context', 'promise', true);
    update public.promises set status = 'KEPT', resolved_at = now() where id = v_active.id;
    insert into public.promise_events(owner_id, promise_id, receivable_id, event_type, detail)
    values(v_owner, v_active.id, p_receivable_id, 'KEPT', 'Promise fully settled by payment');
  elsif found then
    perform set_config('app.ar1_write_context', 'promise', true);
    update public.promises set status = 'PARTIALLY_KEPT', resolved_at = now() where id = v_active.id;
    insert into public.promise_events(owner_id, promise_id, receivable_id, event_type, detail)
    values(v_owner, v_active.id, p_receivable_id, 'PARTIALLY_KEPT', 'Partial payment recorded against promise');
  end if;

  insert into public.activities(owner_id, client_id, receivable_id, type, note, amount_paise)
  values(v_owner, v_receivable.client_id, p_receivable_id, 'payment', 'Payment recorded', p_amount_paise);
  return v_payment;
end;
$$;

create or replace function public.record_contacted(p_receivable_id uuid, p_note text default 'Follow-up recorded')
returns public.activities
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_receivable public.receivables;
  v_activity public.activities;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner;
  if not found then raise exception 'Receivable is not available for this account'; end if;
  insert into public.activities(owner_id, client_id, receivable_id, type, note)
  values(v_owner, v_receivable.client_id, p_receivable_id, 'contacted', coalesce(nullif(p_note, ''), 'Follow-up recorded'))
  returning * into v_activity;
  return v_activity;
end;
$$;

create or replace function public.delete_my_business_data()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  delete from public.profiles where id = auth.uid();
end;
$$;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.receivables enable row level security;
alter table public.promises enable row level security;
alter table public.payments enable row level security;
alter table public.activities enable row level security;
alter table public.promise_events enable row level security;
alter table public.entitlements enable row level security;
alter table public.purchase_claims enable row level security;
alter table public.analytics_events enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles for delete using (id = auth.uid());

drop policy if exists clients_owner_all on public.clients;
create policy clients_owner_all on public.clients for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists receivables_select_own on public.receivables;
create policy receivables_select_own on public.receivables for select using (owner_id = auth.uid());
drop policy if exists receivables_update_own on public.receivables;
create policy receivables_update_own on public.receivables for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists promises_select_own on public.promises;
create policy promises_select_own on public.promises for select using (owner_id = auth.uid());
drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments for select using (owner_id = auth.uid());

drop policy if exists activities_select_own on public.activities;
create policy activities_select_own on public.activities for select using (owner_id = auth.uid());
drop policy if exists activities_insert_own on public.activities;
create policy activities_insert_own on public.activities for insert with check (owner_id = auth.uid());

drop policy if exists promise_events_select_own on public.promise_events;
create policy promise_events_select_own on public.promise_events for select using (owner_id = auth.uid());
drop policy if exists entitlements_select_own on public.entitlements;
create policy entitlements_select_own on public.entitlements for select using (owner_id = auth.uid());
drop policy if exists purchase_claims_select_own on public.purchase_claims;
create policy purchase_claims_select_own on public.purchase_claims for select using (owner_id = auth.uid());

drop policy if exists analytics_owner_select on public.analytics_events;
create policy analytics_owner_select on public.analytics_events for select using (owner_id = auth.uid());
drop policy if exists analytics_owner_insert on public.analytics_events;
create policy analytics_owner_insert on public.analytics_events for insert with check (owner_id = auth.uid());

revoke all on function public.create_client_and_receivable(text, text, text, text, text, text, text, bigint, date, text) from public;
revoke all on function public.create_promise(uuid, bigint, date, text, text) from public;
revoke all on function public.record_payment(uuid, bigint, date, text, text) from public;
revoke all on function public.record_contacted(uuid, text) from public;
revoke all on function public.delete_my_business_data() from public;
grant execute on function public.create_client_and_receivable(text, text, text, text, text, text, text, bigint, date, text) to authenticated;
grant execute on function public.create_promise(uuid, bigint, date, text, text) to authenticated;
grant execute on function public.record_payment(uuid, bigint, date, text, text) to authenticated;
grant execute on function public.record_contacted(uuid, text) to authenticated;
grant execute on function public.delete_my_business_data() to authenticated;

comment on function public.delete_my_business_data() is 'Deletes owned application data through cascading foreign keys. Deleting the Supabase Auth identity remains a later privileged server operation.';
