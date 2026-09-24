-- Stage 4.2: a Founder payment destination cannot become actionable until
-- support and the founder-approved beta refund policy are configured by a
-- trusted operator through Supabase. These fields are not browser-writable.

alter table public.founder_offer_config
  add column if not exists support_contact_status text not null default 'PENDING'
    check (support_contact_status in ('PENDING', 'CONFIGURED')),
  add column if not exists refund_policy_status text not null default 'PENDING_APPROVAL'
    check (refund_policy_status in ('PENDING_APPROVAL', 'APPROVED')),
  add column if not exists refund_policy_text text
    check (refund_policy_text is null or char_length(trim(refund_policy_text)) between 40 and 1200);

alter table public.founder_offer_config
  drop constraint if exists founder_offer_config_refund_policy_ready_check;
alter table public.founder_offer_config
  add constraint founder_offer_config_refund_policy_ready_check
  check (
    (refund_policy_status = 'PENDING_APPROVAL' and refund_policy_text is null)
    or (refund_policy_status = 'APPROVED' and char_length(trim(coalesce(refund_policy_text, ''))) between 40 and 1200)
  );

drop function if exists public.get_founder_offer();
create function public.get_founder_offer()
returns table (
  amount_paise bigint,
  founder_cap integer,
  available_spots integer,
  payee_name text,
  upi_id text,
  payment_destination_status text,
  support_contact text,
  support_contact_status text,
  refund_policy_status text,
  refund_policy_text text,
  review_window_copy text,
  enabled boolean
) language plpgsql security definer stable set search_path = public, auth, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  return query select c.amount_paise, c.founder_cap,
    greatest(0, c.founder_cap - (select count(*)::integer from public.entitlements e where e.plan = 'FOUNDER' and e.status = 'ACTIVE')),
    c.payee_name, c.upi_id, c.payment_destination_status, c.support_contact, c.support_contact_status,
    c.refund_policy_status, c.refund_policy_text, c.review_window_copy, c.enabled
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
  if v_offer.payment_destination_status <> 'CONFIGURED'
     or v_offer.support_contact_status <> 'CONFIGURED'
     or v_offer.refund_policy_status <> 'APPROVED'
     or v_offer.refund_policy_text is null then
    raise exception 'Founder payment instructions are not ready yet';
  end if;
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
  if not found or not v_offer.enabled
     or v_offer.payment_destination_status <> 'CONFIGURED'
     or v_offer.support_contact_status <> 'CONFIGURED'
     or v_offer.refund_policy_status <> 'APPROVED'
     or v_offer.refund_policy_text is null then
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

revoke all on function public.get_founder_offer() from public;
revoke all on function public.create_founder_claim() from public;
revoke all on function public.submit_founder_payment(text, text, text) from public;
grant execute on function public.get_founder_offer() to authenticated;
grant execute on function public.create_founder_claim() to authenticated;
grant execute on function public.submit_founder_payment(text, text, text) to authenticated;

comment on column public.founder_offer_config.support_contact_status is 'Trusted-operator readiness flag; browser users cannot set a support contact.';
comment on column public.founder_offer_config.refund_policy_status is 'Founder approval gate for the public beta refund terms; browser users cannot approve it.';
