-- Stage 4.1: a rejected claim may be reconsidered only by a trusted reviewer
-- after an explicit external bank-history recheck. Original UTR and rejection
-- history remain immutable; no customer resubmission or payment credential is used.

alter table public.founder_audit_events
  drop constraint if exists founder_audit_events_event_type_check;
alter table public.founder_audit_events
  add constraint founder_audit_events_event_type_check
  check (event_type in (
    'CLAIM_CREATED', 'CLAIM_SUBMITTED', 'CLAIM_CANCELLED', 'CLAIM_APPROVED',
    'CLAIM_REJECTED', 'CLAIM_RECONSIDERED', 'CLAIM_APPROVED_AFTER_REVIEW',
    'ENTITLEMENT_REVOKED'
  ));

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
  if v_context = 'RECONSIDER' then
    if old.status <> 'REJECTED' or new.status <> 'APPROVED' then raise exception 'Only a rejected Founder claim can be reconsidered'; end if;
    if new.utr_reference is distinct from old.utr_reference or new.payer_name is distinct from old.payer_name then
      raise exception 'A reconsidered Founder claim must retain its original payment reference';
    end if;
    return new;
  end if;
  raise exception 'Founder claims must be changed through a protected workflow';
end;
$$;

create or replace function public.list_rejected_founder_claims()
returns table (
  claim_id text,
  owner_id uuid,
  owner_email text,
  payer_name text,
  utr_reference text,
  amount_paise bigint,
  rejected_at timestamptz,
  rejection_note text
)
language plpgsql security definer stable set search_path = public, auth, pg_temp as $$
begin
  perform public.assert_founder_admin();
  return query
    select c.claim_id, c.owner_id, u.email, c.payer_name, c.utr_reference,
      c.amount_paise, c.reviewed_at, c.review_note
    from public.purchase_claims c
    join auth.users u on u.id = c.owner_id
    where c.status = 'REJECTED'
    order by c.reviewed_at desc nulls last;
end;
$$;

create or replace function public.reconsider_founder_claim(
  p_claim_id text,
  p_bank_history_verified boolean,
  p_note text default null
)
returns public.purchase_claims
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_admin uuid := auth.uid();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_offer public.founder_offer_config;
  v_claim public.purchase_claims;
  v_active_count integer;
begin
  perform public.assert_founder_admin();
  if p_bank_history_verified is distinct from true then
    raise exception 'Confirm bank-history verification before reconsidering this claim';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep the reconsideration note concise';
  end if;

  perform pg_advisory_xact_lock(hashtext('dueweave-founder-seat-cap'));
  select * into v_offer from public.founder_offer_config where offer_key = 'FOUNDER_V1' for update;
  select * into v_claim from public.purchase_claims where claim_id = p_claim_id for update;
  if not found then raise exception 'This Founder claim is not available'; end if;

  if v_claim.status = 'APPROVED' and exists (
    select 1 from public.founder_audit_events
    where claim_id = v_claim.id and event_type = 'CLAIM_RECONSIDERED'
  ) then
    return v_claim;
  end if;
  if v_claim.status <> 'REJECTED' then
    raise exception 'Only a rejected Founder claim can be reconsidered';
  end if;
  if v_claim.plan <> 'FOUNDER' or v_claim.amount_paise <> v_offer.amount_paise then
    raise exception 'This Founder claim no longer matches the configured offer';
  end if;

  select count(*) into v_active_count
  from public.entitlements
  where plan = 'FOUNDER' and status = 'ACTIVE';
  if v_active_count >= v_offer.founder_cap then
    raise exception 'The verified Founder offer is currently full';
  end if;

  perform set_config('app.dueweave_claim_context', 'RECONSIDER', true);
  update public.purchase_claims
    set status = 'APPROVED', reviewed_at = now(), reviewed_by = v_admin,
      review_note = coalesce(v_note, v_claim.review_note)
    where id = v_claim.id
    returning * into v_claim;

  insert into public.entitlements(user_id, plan, status, source, activated_at, reviewed_by, reviewed_at)
    values(v_claim.owner_id, 'FOUNDER', 'ACTIVE', 'PURCHASE', now(), v_admin, now())
    on conflict (user_id) do update set
      plan = 'FOUNDER', status = 'ACTIVE', source = 'PURCHASE', activated_at = now(),
      reviewed_by = v_admin, reviewed_at = now(), updated_at = now();
  insert into public.founder_audit_events(claim_id, target_user_id, actor_user_id, event_type, metadata)
    values(v_claim.id, v_claim.owner_id, v_admin, 'CLAIM_RECONSIDERED',
      jsonb_build_object('reason', coalesce(v_note, 'Bank history reverified'), 'source', 'manual_bank_reconsideration'));
  insert into public.founder_audit_events(claim_id, target_user_id, actor_user_id, event_type, metadata)
    values(v_claim.id, v_claim.owner_id, v_admin, 'CLAIM_APPROVED_AFTER_REVIEW',
      jsonb_build_object('reason', 'Bank history verified', 'source', 'manual_bank_reconsideration'));
  insert into public.analytics_events(owner_id, event_name, metadata, entity_type, entity_id)
    values(v_claim.owner_id, 'founder_activated', jsonb_build_object('source', 'manual_reconsideration'), 'purchase_claim', v_claim.id);
  return v_claim;
end;
$$;

revoke all on function public.list_rejected_founder_claims() from public;
revoke all on function public.reconsider_founder_claim(text, boolean, text) from public;
grant execute on function public.list_rejected_founder_claims() to authenticated;
grant execute on function public.reconsider_founder_claim(text, boolean, text) to authenticated;

comment on function public.reconsider_founder_claim(text, boolean, text) is
  'Admin-only, idempotent reconsideration of one rejected Founder claim after explicit bank-history verification; preserves the original UTR and immutable rejection audit trail.';
