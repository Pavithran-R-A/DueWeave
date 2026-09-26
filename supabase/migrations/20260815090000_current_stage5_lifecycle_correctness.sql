-- Stage 5 (current roadmap) — authoritative money state and promise outcomes.
--
-- Forward-only. None of the 19 earlier migrations is edited; this file changes
-- the executed definitions that Stage 3/4 qualified, and every change below is
-- justified by a defect measured in current_stage5_financial_lifecycle_report.md
-- (§3) and reproduced by a failing test in tests/stage5-local-lifecycle.test.ts
-- before any SQL here was written.
--
-- WHAT WAS WRONG, IN ONE PARAGRAPH
--
-- record_payment graded a promise by asking "did the invoice reach zero?".
-- That question is not the one the ledger has to answer. A customer who
-- promised ₹5,000 and paid ₹5,000 on a ₹10,000 invoice kept their word, and the
-- database recorded them as PARTIALLY_KEPT. A customer who promised ₹5,000 by
-- yesterday and paid nothing until the invoice was cleared in full today was
-- recorded as KEPT — the money arrived late, and the promise was rewritten as
-- though it had not. Both readings came from the same missing rule: nothing in
-- the lifecycle ever compared a payment against the promise's own amount and
-- date.
--
-- THE RULE THIS FILE INSTALLS
--
-- One internal function, promise_outcome(promise, business_date), decides
-- every promise status from persisted facts, and one internal function,
-- apply_promise_outcome(...), is the only writer of a promise status. Nothing
-- else in the database may reclassify a promise, and the row trigger
-- guard_promise_history now refuses any transition the matrix below does not
-- list — so the rule cannot be bypassed by a path this file forgot.
--
-- Attribution (Phase 6). A payment counts toward a promise when
--
--     payment.receivable_id = promise.receivable_id
--     AND payment.created_at  > promise.created_at      -- recorded after the commitment
--     AND payment.paid_on     <= promise.promised_date   -- arrived by the date named
--
-- created_at is when the ledger learned about the money; paid_on is when the
-- money moved. Both are needed and neither is enough alone: created_at excludes
-- money that had already arrived before the customer made the promise, and
-- paid_on is what makes a late payment late even when it is entered promptly.
-- A payment entered today and backdated to before the deadline therefore counts
-- toward the promise, which is the correct financial fact and is what the
-- narrow BROKEN -> KEPT correction below exists to recognise.
--
-- "The invoice became PAID" is deliberately NOT part of the rule. It is a
-- separate fact about a separate object, and conflating the two was the defect.
--
-- TIME. Every lifecycle decision now reads the day from one function,
-- current_business_date(), which returns the Asia/Kolkata calendar date. The
-- frontend has always computed "today" in India time (client/lib/business-clock).
-- Before this file the database instead asked each profile its own timezone, so
-- a signed-in user could move their own profile.timezone and silently change
-- when every one of their promises was judged kept or broken, while the screen
-- they were looking at still said India. DueWeave v1 is India-only and
-- currency-only-INR, so profile.timezone is now pinned by a CHECK instead of
-- being honoured as a variable. One truthful model, not two that disagree.
--
-- LOCK ORDERING. Every writer takes: optional owner+request advisory lock ->
-- the receivable row -> that receivable's promise rows, in sequence_no order.
-- mark_due_promises_broken() previously locked promises and receivables through
-- a join without controlling the order, which is exactly how a payment and an
-- overdue sweep deadlock against each other; that statement is gone.

-- ---------------------------------------------------------------------------
-- 1. One business date, pinned
-- ---------------------------------------------------------------------------

create or replace function public.current_business_date()
returns date
language sql
stable
set search_path = ''
as $$
  -- No table reference, so an empty search_path costs nothing here; the whole
  -- point is that this definition cannot be re-pointed by another schema.
  select (timezone('Asia/Kolkata', now()))::date;
$$;

comment on function public.current_business_date() is 'The single source of truth for "today" in the money lifecycle: the Asia/Kolkata calendar date. v1 is India-only; profile.timezone is pinned to match.';

-- profiles.timezone was directly UPDATABLE by its owner (profiles is the one
-- table authenticated may write), which made it a lifecycle control disguised
-- as a preference. Existing rows were measured before this constraint was
-- added: zero rows held any other value, so it can be added validated.
alter table public.profiles drop constraint if exists profiles_timezone_check;
alter table public.profiles
  add constraint profiles_timezone_check check (timezone = 'Asia/Kolkata');

-- Same refusal with words a customer can read, instead of a raw 23514 from the
-- table constraint. The existing guard already owns "you may not change your
-- own plan", so it is the right place for "you may not change your own
-- business date rules either". The identity and plan checks are carried over
-- from the executed definition unchanged, including their wording.
create or replace function public.prevent_profile_entitlement_change()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Profile identity cannot be changed';
  end if;
  if new.plan is distinct from old.plan then
    raise exception 'Plan changes require a protected entitlement workflow';
  end if;
  if new.timezone is distinct from old.timezone then
    raise exception 'DueWeave keeps one business calendar for the ledger, so the working day cannot be moved';
  end if;
  if new.currency is distinct from old.currency then
    raise exception 'DueWeave records money in INR only';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Promise money attribution and the truth table
-- ---------------------------------------------------------------------------

create or replace function public.promise_settled_amount(p_promise public.promises)
returns bigint
language sql
stable
set search_path = ''
as $$
  -- Deterministic, and every input is a persisted fact rather than a
  -- convention: no floating point, no clock reading, no ordering assumption.
  select coalesce(sum(py.amount_paise), 0)::bigint
    from public.payments py
   where py.receivable_id = p_promise.receivable_id
     and py.created_at > p_promise.created_at
     and py.paid_on <= p_promise.promised_date;
$$;

comment on function public.promise_settled_amount(public.promises) is 'Payments attributable to one promise: recorded after it was made and dated on or before its promised date. Internal — not executable from the browser.';

create or replace function public.promise_outcome(p_promise public.promises, p_business_date date)
returns text
language sql
stable
set search_path = ''
as $$
  -- The whole Stage 5 truth table, in one readable place.
  --
  -- KEPT is checked first and is unconditional: once the attributable money
  -- reaches the promised amount the outcome is a historical fact, whether or
  -- not the day has arrived. That is what lets a promise be kept on an invoice
  -- that is still partly outstanding, and what stops a paid-in-full invoice
  -- from laundering a promise that was actually missed.
  --
  -- ACTIVE before the deadline is the other half of the same honesty: a
  -- customer who has paid part of what they promised and still has time has
  -- neither kept nor broken anything yet.
  select case
    when v.qualified >= p_promise.promised_amount_paise then 'KEPT'
    when p_business_date <= p_promise.promised_date then 'ACTIVE'
    when v.qualified > 0 then 'PARTIALLY_KEPT'
    else 'BROKEN'
  end
    from (select public.promise_settled_amount(p_promise) as qualified) v;
$$;

comment on function public.promise_outcome(public.promises, date) is 'Decides ACTIVE / KEPT / PARTIALLY_KEPT / BROKEN from promised amount, attributable payments and the business date. Never says RENEGOTIATED or CANCELLED — those are human acts, recorded by create_promise and cancel_promise.';

-- ---------------------------------------------------------------------------
-- 3. The only writer of a promise status
-- ---------------------------------------------------------------------------

create or replace function public.apply_promise_outcome(
  p_promise public.promises,
  p_to_status text,
  p_reason text,
  p_actor_type text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_is_correction boolean;
  v_activity_type text;
begin
  if p_to_status is not distinct from p_promise.status then
    return;  -- no transition, therefore no history row and no churn
  end if;

  -- THE MATRIX. Exactly what guard_promise_history will allow, restated here
  -- so the writer fails before the trigger has to. RENEGOTIATED and CANCELLED
  -- reach here from create_promise / cancel_promise only.
  v_is_correction := false;
  if p_promise.status = 'ACTIVE' then
    if p_to_status not in ('KEPT', 'PARTIALLY_KEPT', 'BROKEN', 'RENEGOTIATED', 'CANCELLED') then
      raise exception 'Illegal promise transition from ACTIVE to %', p_to_status using errcode = '42601';
    end if;
  elsif p_promise.status = 'BROKEN' then
    -- Phase 7: evidence that arrived later, dated on or before the promised
    -- day, corrects the record. The original BROKEN event is not touched.
    if p_to_status not in ('KEPT', 'PARTIALLY_KEPT') then
      raise exception 'A broken promise can only be corrected to KEPT or PARTIALLY_KEPT' using errcode = '42601';
    end if;
    v_is_correction := true;
  elsif p_promise.status = 'PARTIALLY_KEPT' then
    -- One direction only: the rest of the promised sum turned up late but
    -- dated in time. A kept promise never becomes less than it was recorded.
    if p_to_status <> 'KEPT' then
      raise exception 'A partially kept promise can only be corrected to KEPT' using errcode = '42601';
    end if;
    v_is_correction := true;
  else
    raise exception 'A % promise is final', p_promise.status using errcode = '42601';
  end if;

  v_activity_type := case
    when v_is_correction then 'PROMISE_CORRECTED'
    when p_to_status = 'CANCELLED' then 'PROMISE_CANCELLED'
    else 'PROMISE_STATUS_CHANGED'
  end;

  -- guard_promise_history refuses any write outside a protected workflow, and
  -- the GUC is transaction-local, so only a SECURITY DEFINER body can set it.
  perform set_config('app.ar1_write_context', 'promise', true);

  update public.promises
     set status = p_to_status,
         resolved_at = now()
   where id = p_promise.id;

  insert into public.promise_events(owner_id, promise_id, receivable_id, from_status, to_status, reason, actor_type)
    values(p_promise.owner_id, p_promise.id, p_promise.receivable_id, p_promise.status, p_to_status, p_reason, p_actor_type);

  insert into public.activities(owner_id, client_id, receivable_id, promise_id, type, note, metadata)
    select p_promise.owner_id, r.client_id, p_promise.receivable_id, p_promise.id, v_activity_type,
           case v_activity_type
             when 'PROMISE_CORRECTED' then 'Promise record corrected'
             when 'PROMISE_CANCELLED' then 'Promise cancelled'
             else 'Promise outcome recorded'
           end,
           jsonb_build_object('reason', p_reason)
      from public.receivables r
     where r.id = p_promise.receivable_id;
end;
$$;

comment on function public.apply_promise_outcome(public.promises, text, text, text) is 'The single writer of promises.status. Enforces the transition matrix and appends promise_events + activities for every change. Internal — not executable from the browser.';

-- ---------------------------------------------------------------------------
-- 4. Reconciliation, scoped to one receivable
-- ---------------------------------------------------------------------------

create or replace function public.settle_promises_for_receivable(p_owner uuid, p_receivable_id uuid, p_business_date date)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_promise public.promises;
  v_outcome text;
  v_count integer := 0;
begin
  -- Callers must already hold the receivable row lock; that is what makes the
  -- promise sequence, the balance and this sweep serialise against a
  -- concurrent payment instead of racing it.
  for v_promise in
    select p.*
      from public.promises p
     where p.owner_id = p_owner
       and p.receivable_id = p_receivable_id
       -- Only rows this sweep could possibly change: an open commitment, or a
       -- broken/partial one with money recorded after its outcome was written.
       and (
         p.status = 'ACTIVE'
         or (p.status in ('BROKEN', 'PARTIALLY_KEPT') and exists (
              select 1 from public.payments py
               where py.receivable_id = p.receivable_id
                 and py.created_at > p.resolved_at))
       )
     order by p.sequence_no
       for update
  loop
    if v_promise.status in ('KEPT', 'RENEGOTIATED', 'CANCELLED') then
      continue;
    end if;
    v_outcome := public.promise_outcome(v_promise, p_business_date);
    if v_promise.status = 'ACTIVE' then
      if v_outcome = 'ACTIVE' then
        continue;
      end if;
      perform public.apply_promise_outcome(v_promise, v_outcome,
        case v_outcome
          when 'KEPT' then 'Promised amount received on or before the promised date'
          when 'PARTIALLY_KEPT' then 'Part of the promised amount received by the promised date'
          else 'No part of the promised amount was received by the promised date'
        end,
        'SYSTEM');
      v_count := v_count + 1;
    elsif v_outcome = 'KEPT' or (v_promise.status = 'BROKEN' and v_outcome = 'PARTIALLY_KEPT') then
      perform public.apply_promise_outcome(v_promise, v_outcome,
        'Historical payment recorded for a date on or before the promise deadline', 'SYSTEM');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

comment on function public.settle_promises_for_receivable(uuid, uuid, date) is 'Reconciles one receivable''s promises against the truth table, including the narrow late-evidence correction. Internal — not executable from the browser.';

create or replace function public.settle_promises_for_owner(p_owner uuid, p_business_date date)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_receivable_id uuid;
  v_count integer := 0;
begin
  -- Receivable first, then its promises, always in the same order, and
  -- receivables visited in id order so two sweeps cannot cross.
  for v_receivable_id in
    select r.id
      from public.receivables r
     where r.owner_id = p_owner
       and exists (
         select 1 from public.promises p
          where p.receivable_id = r.id
            and (
              p.status = 'ACTIVE'
              or (p.status in ('BROKEN', 'PARTIALLY_KEPT') and exists (
                   select 1 from public.payments py
                    where py.receivable_id = p.receivable_id
                      and py.created_at > p.resolved_at))
            )
       )
     order by r.id
       for update of r
  loop
    v_count := v_count + public.settle_promises_for_receivable(p_owner, v_receivable_id, p_business_date);
  end loop;
  return v_count;
end;
$$;

comment on function public.settle_promises_for_owner(uuid, date) is 'Owner-wide reconciliation used by the browser-facing settle call. Locks receivables before promises, in id order. Internal — not executable from the browser.';

-- ---------------------------------------------------------------------------
-- 5. History rules the database itself enforces
-- ---------------------------------------------------------------------------

-- guard_promise_history used to say "ACTIVE may change, anything else may not",
-- which both blocked the legitimate correction and allowed any write to an
-- ACTIVE promise — including one that jumped it straight to RENEGOTIATED after
-- its deadline had already passed. It now states the matrix.
create or replace function public.guard_promise_history()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
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
    or new.note is distinct from old.note
    or new.request_id is distinct from old.request_id then
    raise exception 'Promise facts cannot be rewritten';
  end if;
  if new.status is not distinct from old.status then
    return new;  -- a fact-only touch is not a transition
  end if;
  if old.status = 'ACTIVE' and new.status not in ('KEPT', 'PARTIALLY_KEPT', 'BROKEN', 'RENEGOTIATED', 'CANCELLED') then
    raise exception 'An active promise can only move to a recorded outcome';
  end if;
  if old.status = 'BROKEN' and new.status not in ('KEPT', 'PARTIALLY_KEPT') then
    raise exception 'A broken promise can only be corrected by evidence dated on or before its promised date';
  end if;
  if old.status = 'PARTIALLY_KEPT' and new.status <> 'KEPT' then
    raise exception 'A partially kept promise can only be corrected to kept';
  end if;
  if old.status in ('KEPT', 'RENEGOTIATED', 'CANCELLED') then
    raise exception 'A % promise is final', old.status;
  end if;
  if new.resolved_at is null then
    raise exception 'A resolved promise must record when its outcome was written';
  end if;
  if current_setting('app.ar1_write_context', true) <> 'promise' then
    raise exception 'Promise transitions require a protected workflow';
  end if;
  return new;
end;
$$;

-- Cancellation moves money state too, so it needs a workflow of its own; the
-- list stays explicit and no new browser write path appears.
create or replace function public.guard_receivable_financial_fields()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.owner_id is distinct from old.owner_id or new.client_id is distinct from old.client_id
    or new.amount_due_paise is distinct from old.amount_due_paise
    or new.outstanding_paise is distinct from old.outstanding_paise
    or new.status is distinct from old.status then
    if coalesce(current_setting('app.ar1_write_context', true), '') not in ('payment', 'receivable_cancel') then
      raise exception 'Financial fields require a protected workflow';
    end if;
  end if;
  return new;
end;
$$;

-- paid_on is a date the customer types. No CHECK can express "not in the
-- future" because it depends on the clock, so the rule lives in a trigger and
-- therefore holds for every insert path, not only record_payment.
create or replace function public.guard_payment_facts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.paid_on > public.current_business_date() then
    raise exception 'A payment cannot be dated in the future';
  end if;
  return new;
end;
$$;

drop trigger if exists payments_guard_facts on public.payments;
create trigger payments_guard_facts
  before insert on public.payments
  for each row execute function public.guard_payment_facts();

-- ---------------------------------------------------------------------------
-- 6. Money invariants that live in the table, not in the application
-- ---------------------------------------------------------------------------

-- Two near-duplicate table CHECKs had drifted apart: receivables_check1 had no
-- WRITTEN_OFF branch while receivables_financial_state_check did, so the
-- allowed status set and the allowed balance states disagreed, and CANCELLED
-- accepted any outstanding amount including a positive one. One constraint now
-- states the whole legal state space, and every clause is row-local, as a
-- CHECK must be.
alter table public.receivables drop constraint if exists receivables_check1;
alter table public.receivables drop constraint if exists receivables_financial_state_check;
alter table public.receivables drop constraint if exists receivables_status_check;

alter table public.receivables
  add constraint receivables_status_check check (status = any (array['OPEN'::text, 'PARTIALLY_PAID'::text, 'PAID'::text, 'CANCELLED'::text]));

alter table public.receivables
  add constraint receivables_financial_state_check check (
    (status = 'OPEN' and outstanding_paise = amount_due_paise)
    or (status = 'PARTIALLY_PAID' and outstanding_paise > 0 and outstanding_paise < amount_due_paise)
    or (status = 'PAID' and outstanding_paise = 0)
    or (status = 'CANCELLED' and outstanding_paise = 0)
  );

-- WRITTEN_OFF was reachable in the status list but had no write path, no
-- semantics for its balance, and no screen. Storing it is what Stage 5 refuses
-- to do half-way; it is removed rather than left as a value the ledger could
-- hold without being able to explain. This is a narrowing of the CHECK, so it
-- was measured first: zero rows held that status.

alter table public.receivables add constraint receivables_outstanding_not_negative check (outstanding_paise >= 0);

-- The application ceiling is 900,000,000,000,000 paise (parseINRToPaise in
-- client/lib/finance.ts). A bigint column can hold far more than the client can
-- type or display, so the ceiling belongs in the database too.
alter table public.payments drop constraint if exists payments_amount_paise_check;
alter table public.payments
  add constraint payments_amount_paise_check check (amount_paise > 0 and amount_paise <= 900000000000000);

alter table public.promises drop constraint if exists promises_promised_amount_paise_check;
alter table public.promises
  add constraint promises_promised_amount_paise_check check (promised_amount_paise > 0 and promised_amount_paise <= 900000000000000);

-- An outcome without a timestamp, or an open commitment with one, makes the
-- history unreadable. Row-local, therefore a CHECK.
alter table public.promises
  add constraint promises_resolution_state_check check (
    (status = 'ACTIVE' and resolved_at is null)
    or (status <> 'ACTIVE' and resolved_at is not null)
  );

-- New history kinds for the acts this stage adds. Additive: no existing row
-- changes and no old value is removed.
alter table public.activities drop constraint if exists activities_type_check;
alter table public.activities
  add constraint activities_type_check check (type = any (array[
    'FOLLOW_UP_RECORDED'::text, 'PROMISE_CREATED'::text, 'PROMISE_STATUS_CHANGED'::text,
    'PROMISE_CANCELLED'::text, 'PROMISE_CORRECTED'::text,
    'PAYMENT_RECORDED'::text, 'RECEIVABLE_CREATED'::text, 'RECEIVABLE_CANCELLED'::text,
    'SNOOZED'::text, 'NOTE_ADDED'::text]));

-- ---------------------------------------------------------------------------
-- 7. Request identity — so a retry cannot move money twice
-- ---------------------------------------------------------------------------

alter table public.payments add column if not exists request_id uuid;
alter table public.promises add column if not exists request_id uuid;

create unique index if not exists payments_owner_request_key
  on public.payments (owner_id, request_id)
  where request_id is not null;

create unique index if not exists promises_owner_request_key
  on public.promises (owner_id, request_id)
  where request_id is not null;

comment on column public.payments.request_id is 'Client-generated identity of the submission that created this payment. Reused by a retry of the same form; unique per owner. Never the UTR, which is optional and absent for cash.';
comment on column public.promises.request_id is 'Client-generated identity of the submission that created this promise. Reused by a retry of the same form; unique per owner.';

-- ---------------------------------------------------------------------------
-- 8. record_payment — balance from history, promises from the truth table
-- ---------------------------------------------------------------------------

drop function if exists public.record_payment(uuid, bigint, date, text, text, text);

create or replace function public.record_payment(
  p_receivable_id uuid,
  p_amount_paise bigint,
  p_paid_on date,
  p_method text,
  p_reference text,
  -- No default: a call that does not identify itself is refused, so there is
  -- no non-idempotent door left open for the browser to walk through.
  p_request_id uuid,
  p_note text default null
)
returns payments
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_owner uuid := auth.uid();
  v_receivable public.receivables;
  v_prior public.payments;
  v_payment public.payments;
  v_method text := upper(btrim(coalesce(p_method, '')));
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_prior_paid bigint;
  v_total_paid bigint;
  v_outstanding bigint;
begin
  if v_owner is null then
    raise exception 'Authentication is required';
  end if;
  if p_request_id is null then
    raise exception 'This payment needs a request id so a retry cannot record it twice' using errcode = 'P0001';
  end if;

  -- Same submission, same account: serialise the retry against the original
  -- before anything is locked, so two clicks cannot both pass the replay check
  -- below. Advisory locks are taken before row locks everywhere in this file,
  -- so this cannot form a cycle with the receivable lock.
  perform pg_advisory_xact_lock(hashtext(v_owner::text || ':' || p_request_id::text));

  if v_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'OTHER') then
    raise exception 'Choose how the money arrived';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Enter a payment amount greater than zero';
  end if;
  if p_amount_paise > 900000000000000 then
    raise exception 'That amount is larger than DueWeave can record';
  end if;
  if p_paid_on is null then
    raise exception 'Choose the date the money arrived';
  end if;
  if p_reference is not null and char_length(btrim(p_reference)) > 160 then
    raise exception 'Reference can be up to 160 characters';
  end if;
  if p_note is not null and char_length(btrim(p_note)) > 2000 then
    raise exception 'Notes can be up to 2,000 characters';
  end if;

  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Receivable is not available for this account';
  end if;

  -- Read after the lock, so a retry whose first attempt has already committed
  -- is recognised instead of failing on the now-smaller balance.
  select * into v_prior from public.payments where owner_id = v_owner and request_id = p_request_id;
  if found then
    if v_prior.receivable_id = p_receivable_id
      and v_prior.amount_paise = p_amount_paise
      and v_prior.paid_on = p_paid_on
      and v_prior.method = v_method
      and coalesce(v_prior.reference, '') = coalesce(v_reference, '')
      and coalesce(v_prior.note, '') = coalesce(v_note, '') then
      return v_prior;  -- replay of the same act: no second payment, no second event
    end if;
    raise exception 'That request id already recorded a different payment' using errcode = '40901';
  end if;

  if v_receivable.status = 'PAID' then
    raise exception 'This receivable is already settled';
  end if;
  if v_receivable.status = 'CANCELLED' then
    raise exception 'A cancelled receivable does not accept payments';
  end if;
  -- Future-dated receipts are refused; backdated ones are not, because a
  -- customer recording last week's UPI on Monday is normal and is exactly the
  -- evidence the correction path exists to honour.
  if p_paid_on > public.current_business_date() then
    raise exception 'A payment cannot be dated in the future';
  end if;
  if p_amount_paise > v_receivable.outstanding_paise then
    raise exception 'Payment must be within the remaining balance';
  end if;

  -- The balance is derived from the whole payment history rather than nudged
  -- down by this one amount, so "outstanding" and "what was paid" cannot drift
  -- apart over successive writes. A disagreement is a defect and is reported
  -- as one instead of being silently overwritten.
  select coalesce(sum(py.amount_paise), 0)::bigint into v_prior_paid
    from public.payments py where py.receivable_id = p_receivable_id;
  if v_receivable.outstanding_paise is distinct from (v_receivable.amount_due_paise - v_prior_paid) then
    raise exception 'This receivable''s recorded balance does not match its payment history';
  end if;

  perform set_config('app.ar1_write_context', 'payment', true);

  insert into public.payments(owner_id, receivable_id, amount_paise, paid_on, method, reference, note, request_id)
    values(v_owner, p_receivable_id, p_amount_paise, p_paid_on, v_method, v_reference, v_note, p_request_id)
    on conflict (owner_id, request_id) where request_id is not null do nothing
    returning * into v_payment;

  if v_payment.id is null then
    -- Only reachable if a duplicate committed in the gap this transaction could
    -- not see. Hand back that row rather than inserting a second payment.
    select * into v_payment from public.payments where owner_id = v_owner and request_id = p_request_id;
    if v_payment.receivable_id <> p_receivable_id or v_payment.amount_paise <> p_amount_paise or v_payment.paid_on <> p_paid_on then
      raise exception 'That request id already recorded a different payment' using errcode = '40901';
    end if;
    return v_payment;
  end if;

  v_total_paid := v_prior_paid + p_amount_paise;
  v_outstanding := v_receivable.amount_due_paise - v_total_paid;

  update public.receivables
     set outstanding_paise = v_outstanding,
         status = case when v_outstanding = 0 then 'PAID' else 'PARTIALLY_PAID' end
   where id = p_receivable_id;

  -- After the balance is written, and while the receivable lock is still held,
  -- so a concurrent payment and the overdue sweep see the same history.
  perform public.settle_promises_for_receivable(v_owner, p_receivable_id, public.current_business_date());

  insert into public.activities(owner_id, client_id, receivable_id, type, note, metadata)
    values(v_owner, v_receivable.client_id, p_receivable_id, 'PAYMENT_RECORDED', 'Payment recorded', jsonb_build_object('source', 'payment'));

  return v_payment;
end;
$$;

comment on function public.record_payment(uuid, bigint, date, text, text, uuid, text) is 'Records money, derives the balance from the payment history, and reconciles promises against their own amount and date. Idempotent per (owner, request_id).';

-- ---------------------------------------------------------------------------
-- 9. create_promise — reconcile first, then renegotiate only what is still open
-- ---------------------------------------------------------------------------

drop function if exists public.create_promise(uuid, bigint, date, text, text);

create or replace function public.create_promise(
  p_receivable_id uuid,
  p_promised_amount_paise bigint,
  p_promised_date date,
  p_source text,
  p_note text,
  p_request_id uuid
)
returns promises
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_owner uuid := auth.uid();
  v_receivable public.receivables;
  v_prior public.promises;
  v_promise public.promises;
  v_active public.promises;
  v_source text := upper(btrim(coalesce(p_source, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_sequence integer;
begin
  if v_owner is null then
    raise exception 'Authentication is required';
  end if;
  if p_request_id is null then
    raise exception 'This promise needs a request id so a retry cannot record it twice' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_owner::text || ':' || p_request_id::text));

  if v_source not in ('WHATSAPP', 'CALL', 'EMAIL', 'MEETING', 'OTHER') then
    raise exception 'Choose how the promise was made';
  end if;
  if p_promised_amount_paise is null or p_promised_amount_paise <= 0 then
    raise exception 'Enter a promised amount greater than zero';
  end if;
  if p_promised_amount_paise > 900000000000000 then
    raise exception 'That amount is larger than DueWeave can record';
  end if;
  if p_promised_date is null then
    raise exception 'Choose the date the customer promised';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'Notes can be up to 2,000 characters';
  end if;

  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Receivable is not available for this account';
  end if;

  select * into v_prior from public.promises where owner_id = v_owner and request_id = p_request_id;
  if found then
    if v_prior.receivable_id = p_receivable_id
      and v_prior.promised_amount_paise = p_promised_amount_paise
      and v_prior.promised_date = p_promised_date
      and v_prior.source = v_source
      and coalesce(v_prior.note, '') = coalesce(v_note, '') then
      return v_prior;
    end if;
    raise exception 'That request id already recorded a different promise' using errcode = '40901';
  end if;

  if v_receivable.status <> 'OPEN' and v_receivable.status <> 'PARTIALLY_PAID' then
    raise exception 'A promise cannot be added to a closed receivable';
  end if;
  if p_promised_amount_paise > v_receivable.outstanding_paise then
    raise exception 'Promised amount must be within the remaining balance';
  end if;

  -- Phase 15, and the whole of the honesty this case needs: judge the existing
  -- commitment on its own facts BEFORE deciding whether it was superseded. A
  -- promise whose day has already gone by was kept, partly kept or broken —
  -- calling that "renegotiated" because a new date was typed afterwards would
  -- erase something the ledger actually knows.
  perform public.settle_promises_for_receivable(v_owner, p_receivable_id, public.current_business_date());

  select * into v_active
    from public.promises
   where receivable_id = p_receivable_id and status = 'ACTIVE'
   order by sequence_no
   for update;
  if found then
    perform public.apply_promise_outcome(v_active, 'RENEGOTIATED', 'Replaced by a new promise before its date arrived', 'USER');
  end if;

  -- Safe under the receivable lock taken above: every writer of a promise for
  -- this receivable holds that same lock first, so the sequence cannot race.
  select coalesce(max(sequence_no), 0) + 1 into v_sequence from public.promises where receivable_id = p_receivable_id;

  insert into public.promises(owner_id, receivable_id, sequence_no, promised_amount_paise, promised_date, source, note, request_id)
    values(v_owner, p_receivable_id, v_sequence, p_promised_amount_paise, p_promised_date, v_source, v_note, p_request_id)
    on conflict (owner_id, request_id) where request_id is not null do nothing
    returning * into v_promise;

  if v_promise.id is null then
    select * into v_promise from public.promises where owner_id = v_owner and request_id = p_request_id;
    return v_promise;
  end if;

  perform set_config('app.ar1_write_context', 'promise', true);
  insert into public.promise_events(owner_id, promise_id, receivable_id, from_status, to_status, reason, actor_type)
    values(v_owner, v_promise.id, p_receivable_id, null, 'ACTIVE', 'Promise recorded', 'USER');

  insert into public.activities(owner_id, client_id, receivable_id, promise_id, type, note, metadata)
    values(v_owner, v_receivable.client_id, p_receivable_id, v_promise.id, 'PROMISE_CREATED', 'Promise recorded', jsonb_build_object('source', v_source));

  return v_promise;
end;
$$;

comment on function public.create_promise(uuid, bigint, date, text, text, uuid) is 'Records a commitment, reconciling any earlier active promise first so that only a genuinely still-open commitment is marked RENEGOTIATED. Idempotent per (owner, request_id).';

-- ---------------------------------------------------------------------------
-- 10. The browser-facing settle call, now a real reconciliation
-- ---------------------------------------------------------------------------

create or replace function public.mark_due_promises_broken()
returns integer
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  -- Name kept: Stage 4 split it out of the read path and the repository, the
  -- security contract and the browser all call it by this name. What changed is
  -- that it now settles every promise due for the signed-in owner against the
  -- truth table instead of only stamping the unfunded ones BROKEN.
  return public.settle_promises_for_owner(auth.uid(), public.current_business_date());
end;
$$;

comment on function public.mark_due_promises_broken() is 'Reconciles the signed-in owner''s promises to today''s business date: kept, partially kept, broken, and corrected where backdated evidence proves otherwise. Writes history rows; never deletes them.';

-- ---------------------------------------------------------------------------
-- 11. Cancellation — narrow, recorded, and never destructive
-- ---------------------------------------------------------------------------

create or replace function public.cancel_receivable(p_receivable_id uuid, p_reason text)
returns receivables
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_owner uuid := auth.uid();
  v_receivable public.receivables;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_paid bigint;
  v_active public.promises;
begin
  if v_owner is null then
    raise exception 'Authentication is required';
  end if;
  if v_reason is null or char_length(v_reason) > 200 then
    raise exception 'Add a short reason for closing this receivable (up to 200 characters)';
  end if;

  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Receivable is not available for this account';
  end if;
  if v_receivable.status = 'CANCELLED' then
    raise exception 'This receivable is already cancelled';
  end if;
  if v_receivable.status = 'PAID' then
    raise exception 'A settled receivable cannot be cancelled — cancel the promise instead, or record a correction';
  end if;

  -- The boundary this stage refuses to cross: money that arrived is a fact, and
  -- closing the invoice would have to reinterpret it. There is no refund,
  -- credit-note or write-off accounting in v1, so an invoice with any history
  -- of payments simply cannot be cancelled here.
  select coalesce(sum(py.amount_paise), 0)::bigint into v_paid from public.payments py where py.receivable_id = p_receivable_id;
  if v_paid > 0 then
    raise exception 'A receivable with recorded payments cannot be cancelled';
  end if;

  perform set_config('app.ar1_write_context', 'receivable_cancel', true);
  update public.receivables
     set status = 'CANCELLED',
         outstanding_paise = 0
   where id = p_receivable_id
  returning * into v_receivable;

  select * into v_active
    from public.promises
   where receivable_id = p_receivable_id and status = 'ACTIVE'
   order by sequence_no
   for update;
  if found then
    perform public.apply_promise_outcome(v_active, 'CANCELLED', v_reason, 'USER');
  end if;

  insert into public.activities(owner_id, client_id, receivable_id, type, note, metadata)
    values(v_owner, v_receivable.client_id, p_receivable_id, 'RECEIVABLE_CANCELLED', v_reason, jsonb_build_object('reason', v_reason));

  return v_receivable;
end;
$$;

comment on function public.cancel_receivable(uuid, text) is 'Closes an unpaid receivable with a reason: amount_due is preserved, the balance goes to zero, an active promise becomes CANCELLED with history, and nothing is deleted. Refuses where any payment exists.';

create or replace function public.cancel_promise(p_promise_id uuid, p_reason text)
returns promises
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_owner uuid := auth.uid();
  v_promise public.promises;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_owner is null then
    raise exception 'Authentication is required';
  end if;
  if v_reason is null or char_length(v_reason) > 200 then
    raise exception 'Add a short reason for withdrawing this promise (up to 200 characters)';
  end if;

  -- Receivable before promise, as everywhere else in this file. The row is
  -- locked and proven to belong to this account; no column of it is read, so the
  -- statement performs the lock rather than filling a record nobody uses.
  perform r.id
    from public.receivables r
    join public.promises p on p.receivable_id = r.id
   where p.id = p_promise_id and p.owner_id = v_owner
     for update of r;
  if not found then
    raise exception 'Promise is not available for this account';
  end if;

  select * into v_promise from public.promises where id = p_promise_id and owner_id = v_owner for update;
  if v_promise.status = 'CANCELLED' then
    raise exception 'This promise is already cancelled';
  end if;
  if v_promise.status <> 'ACTIVE' then
    raise exception 'Only a promise that has not reached its outcome can be withdrawn';
  end if;

  perform public.apply_promise_outcome(v_promise, 'CANCELLED', v_reason, 'USER');

  select * into v_promise from public.promises where id = p_promise_id;
  return v_promise;
end;
$$;

comment on function public.cancel_promise(uuid, text) is 'Withdraws one ACTIVE promise with a recorded reason. The promise row, its events and its outcome timestamp are kept; a resolved promise is refused.';

-- ---------------------------------------------------------------------------
-- 12. Snooze reads the same calendar as everything else
-- ---------------------------------------------------------------------------
--
-- RE-GRANT REQUIRED BELOW, NOT OPTIONAL: this is a CREATE OR REPLACE of an
-- existing function, and the Stage 3 fail-closed ddl_command_end trigger strips
-- every EXECUTE grant from a function as soon as it is redefined. Without the
-- explicit grant in section 13 the browser loses snooze entirely — measured:
-- authenticated could execute 23 routines instead of the intended 24, and
-- snooze_receivable was the missing one.

create or replace function public.snooze_receivable(p_receivable_id uuid, p_until date)
returns activities
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  v_owner uuid := auth.uid();
  v_receivable public.receivables;
  v_activity public.activities;
begin
  if v_owner is null then
    raise exception 'Authentication is required';
  end if;
  if p_until is null or p_until < public.current_business_date() then
    raise exception 'Choose today or a future snooze date';
  end if;
  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found or v_receivable.status not in ('OPEN', 'PARTIALLY_PAID') then
    raise exception 'Receivable is not available to snooze';
  end if;
  insert into public.activities(owner_id, client_id, receivable_id, type, note, metadata)
    values(v_owner, v_receivable.client_id, p_receivable_id, 'SNOOZED', 'Follow-up snoozed', jsonb_build_object('snoozed_until', p_until::text, 'surface', 'today'))
    returning * into v_activity;
  return v_activity;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Grants — the browser set changes in exactly one way
-- ---------------------------------------------------------------------------
--
-- Before: 22 routines executable by authenticated.
-- After:  24. record_payment and create_promise changed signature but stay in
-- the set; mark_due_promises_broken keeps its name and stays; snooze_receivable
-- keeps its name and stays — but only because it is re-granted here, since
-- redefining it stripped its EXECUTE (measured mid-stage: 23, not 24). Two are
-- added: cancel_receivable and cancel_promise. Nothing else gains browser
-- EXECUTE — promise_outcome, promise_settled_amount, apply_promise_outcome,
-- settle_promises_for_receivable, settle_promises_for_owner and
-- current_business_date are internal by construction: the Stage 3 fail-closed
-- ddl_command_end trigger strips their implicit grants, and this file does not
-- grant them.

grant execute on function public.record_payment(uuid, bigint, date, text, text, uuid, text) to authenticated;
grant execute on function public.create_promise(uuid, bigint, date, text, text, uuid) to authenticated;
grant execute on function public.mark_due_promises_broken() to authenticated;
grant execute on function public.snooze_receivable(uuid, date) to authenticated;
grant execute on function public.cancel_receivable(uuid, text) to authenticated;
grant execute on function public.cancel_promise(uuid, text) to authenticated;

revoke all on function public.record_payment(uuid, bigint, date, text, text, uuid, text) from public, anon;
revoke all on function public.create_promise(uuid, bigint, date, text, text, uuid) from public, anon;
revoke all on function public.mark_due_promises_broken() from public, anon;
revoke all on function public.snooze_receivable(uuid, date) from public, anon;
revoke all on function public.cancel_receivable(uuid, text) from public, anon;
revoke all on function public.cancel_promise(uuid, text) from public, anon;

revoke all on function public.current_business_date() from public, anon, authenticated;
revoke all on function public.promise_settled_amount(public.promises) from public, anon, authenticated;
revoke all on function public.promise_outcome(public.promises, date) from public, anon, authenticated;
revoke all on function public.apply_promise_outcome(public.promises, text, text, text) from public, anon, authenticated;
revoke all on function public.settle_promises_for_receivable(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.settle_promises_for_owner(uuid, date) from public, anon, authenticated;

commit;
