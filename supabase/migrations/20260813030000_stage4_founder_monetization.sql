-- Stage 4: manual-verified Founder Lifetime purchase claims.
-- This migration deliberately has no payment gateway, banking credential, or client-side approval path.

create table if not exists public.founder_offer_config (
  offer_key text primary key check (offer_key = 'FOUNDER_V1'),
  amount_paise bigint not null default 49900 check (amount_paise = 49900),
  founder_cap integer not null default 50 check (founder_cap between 1 and 500),
  payee_name text not null default 'DueWeave' check (char_length(trim(payee_name)) between 1 and 120),
  upi_id text,
  payment_destination_status text not null default 'PLACEHOLDER'
    check (payment_destination_status in ('PLACEHOLDER', 'TEST', 'CONFIGURED')),
  support_contact text not null default 'Support contact not configured' check (char_length(trim(support_contact)) between 1 and 180),
  review_window_copy text not null default 'Usually reviewed within 24 hours.' check (char_length(trim(review_window_copy)) between 1 and 180),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  check ((payment_destination_status = 'PLACEHOLDER' and upi_id is null) or (payment_destination_status in ('TEST', 'CONFIGURED') and char_length(trim(coalesce(upi_id, ''))) between 3 and 160))
);

insert into public.founder_offer_config (offer_key)
values ('FOUNDER_V1')
on conflict (offer_key) do nothing;

create table if not exists public.founder_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  note text not null default '' check (char_length(note) <= 240)
);

create table if not exists public.founder_audit_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid references public.purchase_claims(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('CLAIM_CREATED', 'CLAIM_SUBMITTED', 'CLAIM_CANCELLED', 'CLAIM_APPROVED', 'CLAIM_REJECTED', 'ENTITLEMENT_REVOKED')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and metadata - array['reason', 'source'] = '{}'::jsonb),
  occurred_at timestamptz not null default now()
);

create index if not exists founder_audit_claim_idx on public.founder_audit_events (claim_id, occurred_at desc);
create index if not exists founder_audit_target_idx on public.founder_audit_events (target_user_id, occurred_at desc);

alter table public.purchase_claims add column if not exists updated_at timestamptz not null default now();
alter table public.purchase_claims alter column submitted_at drop not null;
alter table public.purchase_claims alter column submitted_at drop default;
alter table public.purchase_claims alter column status set default 'DRAFT';
alter table public.purchase_claims drop constraint if exists purchase_claims_status_check;
alter table public.purchase_claims add constraint purchase_claims_status_check
  check (status in ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'));
alter table public.purchase_claims drop constraint if exists purchase_claims_plan_check;
alter table public.purchase_claims add constraint purchase_claims_plan_check check (plan = 'FOUNDER');
alter table public.purchase_claims add constraint purchase_claims_claim_id_format_check
  check (claim_id ~ '^DW-F-[A-Z0-9]{8,32}$');
alter table public.purchase_claims add constraint purchase_claims_reference_state_check
  check ((status = 'DRAFT' and utr_reference = '' and payer_name = '') or (status <> 'DRAFT' and char_length(utr_reference) between 6 and 64 and char_length(payer_name) between 2 and 120));
alter table public.purchase_claims add constraint purchase_claims_review_note_length_check
  check (review_note is null or char_length(review_note) <= 300);

create unique index if not exists purchase_claims_utr_reference_unique
  on public.purchase_claims (upper(utr_reference))
  where status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED');
create unique index if not exists purchase_claims_owner_open_unique
  on public.purchase_claims (owner_id)
  where status in ('DRAFT', 'PENDING_REVIEW');
create index if not exists purchase_claims_status_submitted_idx
  on public.purchase_claims (status, submitted_at asc);

drop trigger if exists purchase_claims_updated_at on public.purchase_claims;
create trigger purchase_claims_updated_at before update on public.purchase_claims
  for each row execute procedure public.set_updated_at();
drop trigger if exists founder_offer_config_updated_at on public.founder_offer_config;
create trigger founder_offer_config_updated_at before update on public.founder_offer_config
  for each row execute procedure public.set_updated_at();

create or replace function public.is_founder_admin()
returns boolean language sql security definer stable set search_path = public, auth, pg_temp as $$
  select auth.uid() is not null and exists (select 1 from public.founder_admins where user_id = auth.uid());
$$;

create or replace function public.assert_founder_admin()
returns void language plpgsql security definer stable set search_path = public, auth, pg_temp as $$
begin
  if auth.uid() is null or not public.is_founder_admin() then
    raise exception 'Founder review access is not available for this account';
  end if;
end;
$$;

create or replace function public.prevent_direct_purchase_claim_change()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_context text := current_setting('app.dueweave_claim_context', true);
begin
  if tg_op = 'INSERT' then
    if v_context <> 'CREATE' then raise exception 'Founder claims must be created through the protected claim workflow'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Founder claim history is immutable';
  end if;
  if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id or new.claim_id is distinct from old.claim_id
     or new.plan is distinct from old.plan or new.amount_paise is distinct from old.amount_paise then
    raise exception 'Founder claim identity and offer terms are immutable';
  end if;
  if v_context = 'SUBMIT' then
    if old.status <> 'DRAFT' or new.status <> 'PENDING_REVIEW' then raise exception 'Only a draft claim can be submitted'; end if;
    if new.reviewed_at is not null or new.reviewed_by is not null then raise exception 'Claim review fields are protected'; end if;
    return new;
  end if;
  if v_context = 'CANCEL' then
    if old.status <> 'DRAFT' or new.status <> 'CANCELLED' then raise exception 'Only an unsubmitted claim can be cancelled'; end if;
    return new;
  end if;
  if v_context = 'ADMIN' then
    if old.status <> 'PENDING_REVIEW' or new.status not in ('APPROVED', 'REJECTED') then raise exception 'Only a pending claim can be reviewed'; end if;
    return new;
  end if;
  raise exception 'Founder claims must be changed through a protected workflow';
end;
$$;

drop trigger if exists purchase_claims_protect_workflow on public.purchase_claims;
create trigger purchase_claims_protect_workflow before insert or update or delete on public.purchase_claims
  for each row execute procedure public.prevent_direct_purchase_claim_change();

create or replace function public.get_founder_offer()
returns table (
  amount_paise bigint,
  founder_cap integer,
  available_spots integer,
  payee_name text,
  upi_id text,
  payment_destination_status text,
  support_contact text,
  review_window_copy text,
  enabled boolean
) language plpgsql security definer stable set search_path = public, auth, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  return query select c.amount_paise, c.founder_cap,
    greatest(0, c.founder_cap - (select count(*)::integer from public.entitlements e where e.plan = 'FOUNDER' and e.status = 'ACTIVE')),
    c.payee_name, c.upi_id, c.payment_destination_status, c.support_contact, c.review_window_copy, c.enabled
  from public.founder_offer_config c where c.offer_key = 'FOUNDER_V1';
end;
$$;

create or replace function public.create_founder_claim()
returns public.purchase_claims language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_owner uuid := auth.uid(); v_offer public.founder_offer_config; v_claim public.purchase_claims;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  select * into v_offer from public.founder_offer_config where offer_key = 'FOUNDER_V1' for update;
  if not found or not v_offer.enabled then raise exception 'Founder access is not available right now'; end if;
  if exists (select 1 from public.entitlements where user_id = v_owner and plan = 'FOUNDER' and status = 'ACTIVE') then
    raise exception 'Founder access is already active for this account';
  end if;
  if exists (select 1 from public.purchase_claims where owner_id = v_owner and status in ('DRAFT', 'PENDING_REVIEW')) then
    select * into v_claim from public.purchase_claims where owner_id = v_owner and status in ('DRAFT', 'PENDING_REVIEW') order by created_at desc limit 1;
    return v_claim;
  end if;
  perform set_config('app.dueweave_claim_context', 'CREATE', true);
  insert into public.purchase_claims(owner_id, claim_id, plan, amount_paise, utr_reference, payer_name, status)
    values(v_owner, 'DW-F-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)), 'FOUNDER', v_offer.amount_paise, '', '', 'DRAFT')
    returning * into v_claim;
  insert into public.founder_audit_events(claim_id, target_user_id, actor_user_id, event_type, metadata)
    values(v_claim.id, v_owner, v_owner, 'CLAIM_CREATED', jsonb_build_object('source', 'user'));
  insert into public.analytics_events(owner_id, event_name, metadata, entity_type, entity_id)
    values(v_owner, 'founder_claim_created', jsonb_build_object('surface', 'founder'), 'purchase_claim', v_claim.id);
  return v_claim;
end;
$$;

create or replace function public.submit_founder_payment(p_claim_id text, p_utr_reference text, p_payer_name text)
returns public.purchase_claims language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_owner uuid := auth.uid(); v_offer public.founder_offer_config; v_claim public.purchase_claims; v_utr text; v_payer text;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  v_utr := upper(regexp_replace(trim(coalesce(p_utr_reference, '')), '\s+', '', 'g'));
  v_payer := trim(coalesce(p_payer_name, ''));
  if char_length(v_utr) < 6 or char_length(v_utr) > 64 or v_utr !~ '^[A-Z0-9-]+$' then raise exception 'Enter a payment reference with letters, numbers, or hyphens only'; end if;
  if char_length(v_payer) < 2 or char_length(v_payer) > 120 then raise exception 'Enter the payer name used for the payment'; end if;
  select * into v_offer from public.founder_offer_config where offer_key = 'FOUNDER_V1';
  if not found or not v_offer.enabled or v_offer.payment_destination_status not in ('TEST', 'CONFIGURED') then
    raise exception 'Payment instructions are not ready for submission';
  end if;
  select * into v_claim from public.purchase_claims where claim_id = p_claim_id and owner_id = v_owner for update;
  if not found then raise exception 'This payment claim is not available for this account'; end if;
  if v_claim.status <> 'DRAFT' then raise exception 'This payment claim has already been submitted or closed'; end if;
  if v_claim.plan <> 'FOUNDER' or v_claim.amount_paise <> v_offer.amount_paise then raise exception 'This payment claim no longer matches the Founder offer'; end if;
  if exists (select 1 from public.purchase_claims where upper(utr_reference) = v_utr and status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')) then
    raise exception 'That payment reference has already been submitted';
  end if;
  perform set_config('app.dueweave_claim_context', 'SUBMIT', true);
  update public.purchase_claims set utr_reference = v_utr, payer_name = v_payer, status = 'PENDING_REVIEW', submitted_at = now()
    where id = v_claim.id returning * into v_claim;
  insert into public.founder_audit_events(claim_id, target_user_id, actor_user_id, event_type, metadata)
    values(v_claim.id, v_owner, v_owner, 'CLAIM_SUBMITTED', jsonb_build_object('source', 'user'));
  insert into public.analytics_events(owner_id, event_name, metadata, entity_type, entity_id)
    values(v_owner, 'founder_payment_submitted', jsonb_build_object('surface', 'founder'), 'purchase_claim', v_claim.id);
  return v_claim;
exception when unique_violation then
  raise exception 'That payment reference has already been submitted';
end;
$$;

create or replace function public.cancel_founder_claim(p_claim_id text)
returns public.purchase_claims language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_owner uuid := auth.uid(); v_claim public.purchase_claims;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  select * into v_claim from public.purchase_claims where claim_id = p_claim_id and owner_id = v_owner for update;
  if not found then raise exception 'This payment claim is not available for this account'; end if;
  if v_claim.status <> 'DRAFT' then raise exception 'Only an unsubmitted payment claim can be cancelled'; end if;
  perform set_config('app.dueweave_claim_context', 'CANCEL', true);
  update public.purchase_claims set status = 'CANCELLED' where id = v_claim.id returning * into v_claim;
  insert into public.founder_audit_events(claim_id, target_user_id, actor_user_id, event_type, metadata)
    values(v_claim.id, v_owner, v_owner, 'CLAIM_CANCELLED', jsonb_build_object('source', 'user'));
  return v_claim;
end;
$$;

create or replace function public.record_founder_upgrade_view()
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  insert into public.analytics_events(owner_id, event_name, metadata, entity_type)
    values(auth.uid(), 'upgrade_viewed', jsonb_build_object('surface', 'founder'), 'founder_offer');
end;
$$;

create or replace function public.list_pending_founder_claims()
returns table (claim_id text, owner_id uuid, owner_email text, payer_name text, utr_reference text, amount_paise bigint, submitted_at timestamptz)
language plpgsql security definer stable set search_path = public, auth, pg_temp as $$
begin
  perform public.assert_founder_admin();
  return query select c.claim_id, c.owner_id, u.email, c.payer_name, c.utr_reference, c.amount_paise, c.submitted_at
    from public.purchase_claims c join auth.users u on u.id = c.owner_id
    where c.status = 'PENDING_REVIEW' order by c.submitted_at asc;
end;
$$;

create or replace function public.get_founder_funnel()
returns table (event_name text, event_count bigint)
language plpgsql security definer stable set search_path = public, auth, pg_temp as $$
begin
  perform public.assert_founder_admin();
  return query select e.event_name, count(*)::bigint from public.analytics_events e
    where e.event_name in ('upgrade_viewed', 'founder_claim_created', 'founder_payment_submitted', 'founder_activated', 'founder_rejected')
    group by e.event_name order by e.event_name;
end;
$$;

create or replace function public.approve_founder_claim(p_claim_id text)
returns public.purchase_claims language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_admin uuid := auth.uid(); v_offer public.founder_offer_config; v_claim public.purchase_claims; v_active_count integer;
begin
  perform public.assert_founder_admin();
  perform pg_advisory_xact_lock(hashtext('dueweave-founder-seat-cap'));
  select * into v_offer from public.founder_offer_config where offer_key = 'FOUNDER_V1' for update;
  select * into v_claim from public.purchase_claims where claim_id = p_claim_id for update;
  if not found then raise exception 'This Founder claim is not available'; end if;
  if v_claim.status = 'APPROVED' then return v_claim; end if;
  if v_claim.status <> 'PENDING_REVIEW' then raise exception 'Only a pending Founder claim can be approved'; end if;
  if v_claim.plan <> 'FOUNDER' or v_claim.amount_paise <> v_offer.amount_paise then raise exception 'This Founder claim no longer matches the configured offer'; end if;
  select count(*) into v_active_count from public.entitlements where plan = 'FOUNDER' and status = 'ACTIVE';
  if v_active_count >= v_offer.founder_cap then raise exception 'The verified Founder offer is currently full'; end if;
  perform set_config('app.dueweave_claim_context', 'ADMIN', true);
  update public.purchase_claims set status = 'APPROVED', reviewed_at = now(), reviewed_by = v_admin, review_note = null
    where id = v_claim.id returning * into v_claim;
  insert into public.entitlements(user_id, plan, status, source, activated_at, reviewed_by, reviewed_at)
    values(v_claim.owner_id, 'FOUNDER', 'ACTIVE', 'PURCHASE', now(), v_admin, now())
    on conflict (user_id) do update set plan = 'FOUNDER', status = 'ACTIVE', source = 'PURCHASE', activated_at = now(), reviewed_by = v_admin, reviewed_at = now(), updated_at = now();
  insert into public.founder_audit_events(claim_id, target_user_id, actor_user_id, event_type, metadata)
    values(v_claim.id, v_claim.owner_id, v_admin, 'CLAIM_APPROVED', jsonb_build_object('source', 'manual_bank_review'));
  insert into public.analytics_events(owner_id, event_name, metadata, entity_type, entity_id)
    values(v_claim.owner_id, 'founder_activated', jsonb_build_object('source', 'manual_review'), 'purchase_claim', v_claim.id);
  return v_claim;
end;
$$;

create or replace function public.reject_founder_claim(p_claim_id text, p_reason text default null)
returns public.purchase_claims language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_admin uuid := auth.uid(); v_claim public.purchase_claims; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.assert_founder_admin();
  if v_reason is not null and char_length(v_reason) > 300 then raise exception 'Keep the review note concise'; end if;
  select * into v_claim from public.purchase_claims where claim_id = p_claim_id for update;
  if not found then raise exception 'This Founder claim is not available'; end if;
  if v_claim.status = 'REJECTED' then return v_claim; end if;
  if v_claim.status <> 'PENDING_REVIEW' then raise exception 'Only a pending Founder claim can be rejected'; end if;
  perform set_config('app.dueweave_claim_context', 'ADMIN', true);
  update public.purchase_claims set status = 'REJECTED', reviewed_at = now(), reviewed_by = v_admin, review_note = v_reason
    where id = v_claim.id returning * into v_claim;
  insert into public.founder_audit_events(claim_id, target_user_id, actor_user_id, event_type, metadata)
    values(v_claim.id, v_claim.owner_id, v_admin, 'CLAIM_REJECTED', jsonb_build_object('reason', coalesce(v_reason, 'Not verified'), 'source', 'manual_bank_review'));
  insert into public.analytics_events(owner_id, event_name, metadata, entity_type, entity_id)
    values(v_claim.owner_id, 'founder_rejected', jsonb_build_object('source', 'manual_review'), 'purchase_claim', v_claim.id);
  return v_claim;
end;
$$;

create or replace function public.revoke_founder_entitlement(p_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare v_admin uuid := auth.uid(); v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.assert_founder_admin();
  if v_reason is null or char_length(v_reason) > 300 then raise exception 'Provide a concise revocation reason'; end if;
  update public.entitlements set status = 'REVOKED', reviewed_by = v_admin, reviewed_at = now(), updated_at = now()
    where user_id = p_user_id and plan = 'FOUNDER' and status = 'ACTIVE';
  if not found then raise exception 'No active Founder entitlement is available for revocation'; end if;
  insert into public.founder_audit_events(target_user_id, actor_user_id, event_type, metadata)
    values(p_user_id, v_admin, 'ENTITLEMENT_REVOKED', jsonb_build_object('reason', v_reason, 'source', 'manual_admin_action'));
end;
$$;

-- Preserve records after revocation: only future transitions into active receivable states are gated.
create or replace function public.enforce_free_receivable_limit()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_plan text; v_status text; v_active_count integer;
begin
  if new.status not in ('OPEN', 'PARTIALLY_PAID') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('OPEN', 'PARTIALLY_PAID') then return new; end if;
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
  select plan, status into v_plan, v_status from public.entitlements where user_id = new.owner_id;
  if coalesce(v_plan, 'FREE') = 'FOUNDER' and v_status = 'ACTIVE' then return new; end if;
  select count(*) into v_active_count from public.receivables where owner_id = new.owner_id and status in ('OPEN', 'PARTIALLY_PAID');
  if v_active_count >= 3 then raise exception 'Free plan allows up to 3 active receivables'; end if;
  return new;
end;
$$;

alter table public.founder_offer_config enable row level security;
alter table public.founder_admins enable row level security;
alter table public.founder_audit_events enable row level security;

revoke all on table public.founder_offer_config, public.founder_admins, public.founder_audit_events from anon, authenticated;
revoke insert, update, delete on table public.purchase_claims, public.entitlements, public.analytics_events from authenticated;
grant select on table public.purchase_claims, public.entitlements, public.analytics_events to authenticated;

revoke all on function public.get_founder_offer() from public;
revoke all on function public.create_founder_claim() from public;
revoke all on function public.submit_founder_payment(text, text, text) from public;
revoke all on function public.cancel_founder_claim(text) from public;
revoke all on function public.record_founder_upgrade_view() from public;
revoke all on function public.list_pending_founder_claims() from public;
revoke all on function public.get_founder_funnel() from public;
revoke all on function public.approve_founder_claim(text) from public;
revoke all on function public.reject_founder_claim(text, text) from public;
revoke all on function public.revoke_founder_entitlement(uuid, text) from public;
grant execute on function public.get_founder_offer() to authenticated;
grant execute on function public.create_founder_claim() to authenticated;
grant execute on function public.submit_founder_payment(text, text, text) to authenticated;
grant execute on function public.cancel_founder_claim(text) to authenticated;
grant execute on function public.record_founder_upgrade_view() to authenticated;
grant execute on function public.list_pending_founder_claims() to authenticated;
grant execute on function public.get_founder_funnel() to authenticated;
grant execute on function public.approve_founder_claim(text) to authenticated;
grant execute on function public.reject_founder_claim(text, text) to authenticated;
grant execute on function public.revoke_founder_entitlement(uuid, text) to authenticated;

comment on table public.founder_offer_config is 'Server-controlled public Founder offer fields only; never stores banking secrets, UPI PINs, OTPs, or bank credentials.';
comment on table public.founder_admins is 'Server-controlled allowlist for manual Founder claim review; no browser-writable admin flag exists.';
comment on table public.founder_audit_events is 'Immutable monetization workflow audit history; no payment reference is copied into metadata.';
comment on function public.approve_founder_claim(text) is 'Atomic manual-review approval: validates admin, locks claim/cap, activates entitlement, and writes audit/analytics events.';
