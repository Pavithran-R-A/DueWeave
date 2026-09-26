-- Stage 5 closure (current roadmap) — promise chronology and correction evidence.
--
-- Forward-only. The 20 migrations before this one are not edited by a single
-- character; every definition below is a CREATE OR REPLACE of an existing
-- object, plus one new column on each of two tables. The defects it closes are
-- D-S5-16 and D-S5-17 in current_stage5_financial_lifecycle_report.md, and each
-- was reproduced by a failing test in tests/stage5-local-lifecycle.test.ts
-- against the previous migration set before any SQL here was written.
--
-- WHAT WAS WRONG, IN ONE PARAGRAPH
--
-- promise_settled_amount asked the database when it had STORED the rows:
--
--   payment.created_at > promise.created_at and payment.paid_on <= promise.promised_date
--
-- A promise's created_at is the instant DueWeave happened to write the row, and
-- a payment's created_at is the instant its receipt was typed in. Neither is a
-- fact about the customer. A customer who paid ₹5,000 on the 10th, promised
-- ₹5,000 again on the 12th for the 15th, and entered the 10th's receipt on the
-- 13th, was credited as though the 10th's money had kept the 12th's promise.
-- The money physically predates the commitment it was said to satisfy, and the
-- same receipt was counted twice: once correcting the older broken promise and
-- once settling the newer one. The Stage 5 report claimed "money from last
-- month cannot retroactively discharge a commitment made today"; the SQL did
-- not enforce it.
--
-- THE RULE THIS FILE INSTALLS
--
-- A promise now stores the business date it was actually made on (made_on),
-- next to the date it promised payment BY (promised_date) and apart from the
-- audit instant the row was written (created_at). Attribution asks one question
-- of that window and no other:
--
--   payment.receivable_id = promise.receivable_id
--   and payment.paid_on >= promise.made_on
--   and payment.paid_on <= promise.promised_date
--
-- Write ordering is out of the money rule entirely. created_at stays exactly
-- what it always was — audit metadata — and is used nowhere in this file for
-- attribution.
--
-- GRANULARITY (Phase 8). DueWeave v1 records business DATES, not customer-event
-- timestamps. When paid_on equals made_on the ledger cannot know the intra-day
-- order, so it does not pretend to: a payment dated on the day the promise was
-- made is eligible. Same-day payments count. No time-of-day column was added
-- for this repair.
--
-- CORRECTION EVIDENCE (Phase 11, D-S5-17). promise_events gained a nullable
-- metadata jsonb column, and every correction (BROKEN -> KEPT, BROKEN ->
-- PARTIALLY_KEPT, PARTIALLY_KEPT -> KEPT) now stores the payment ids and
-- paid_on dates that caused it, read from the same window rule as the money.
-- The reason text is no longer the only provenance, and the original event is
-- still never touched.
--
-- SEARCH PATH (Phase 17). Each redefined function keeps the search_path it was
-- qualified with in Stage 5: the internal helpers pinned to '' and fully
-- qualified, the browser RPCs pinned to 'public', 'auth', 'pg_temp' because
-- they call auth.uid() and return bare table types. This file widens nothing.

-- ---------------------------------------------------------------------------
-- 1. The missing business fact: when the promise was made
-- ---------------------------------------------------------------------------
--
-- promised_date is the day the customer committed to pay BY. created_at is the
-- instant DueWeave stored the row. Neither is the day the promise was made, and
-- no attribution rule can be honest without it, so the column is added rather
-- than a date being inferred from a timestamp.

alter table public.promises add column made_on date;

-- BACKFILL — measured, and honestly labelled.
--
-- Existing rows never stored a promise-origin date, so nothing in this database
-- can prove when those historical customers actually made their promises. The
-- expression below is compatibility metadata chosen so that no legacy row gains
-- a window wider than the facts already in it allow:
--
--   least(the India business date the row was recorded on, promised_date)
--
-- A promise is normally recorded on or after the day it was made, so the
-- recording date is an upper bound for the origin; where the row was recorded
-- after its own deadline (a late-entered historical promise), least() collapses
-- the window onto promised_date instead of inventing an earlier origin. Both
-- branches therefore satisfy made_on <= promised_date by construction, which is
-- what the constraint in a moment asserts.
--
-- Measured against the local database at the point this migration was written:
-- the replayed 20-migration schema held 0 rows in public.promises (no seed.sql
-- exists and the qualification suites purge their own fixtures), so the
-- constraint below was armed against an empty relation and the expression's
-- behaviour was verified row by row against synthetic timestamps spanning the
-- IST/UTC boundary in the pgTAP file (stage5_02). No hosted database exists, so
-- no remote backfill has run or will run from here.

update public.promises
   set made_on = least((created_at at time zone 'Asia/Kolkata')::date, promised_date)
 where made_on is null;

alter table public.promises alter column made_on set not null;
alter table public.promises
  add constraint promises_made_on_not_after_promised_date check (made_on <= promised_date);

comment on column public.promises.made_on is 'Business date the customer actually made the commitment. With promised_date it forms the interval a payment must fall inside to count toward this promise. For rows created before Stage 5 closure it is compatibility metadata derived from the recording date, not proof of when the promise was made.';

-- ---------------------------------------------------------------------------
-- 2. Attribution: the business window, and nothing else
-- ---------------------------------------------------------------------------

create or replace function public.promise_settled_amount(p_promise public.promises)
returns bigint
language sql
stable
set search_path = ''
as $$
  -- Deterministic, and every input is a business fact rather than a recording
  -- accident: the money's own date against the promise's own window. No clock
  -- reading, no write ordering, no floating point.
  select coalesce(sum(py.amount_paise), 0)::bigint
    from public.payments py
   where py.receivable_id = p_promise.receivable_id
     and py.paid_on >= p_promise.made_on
     and py.paid_on <= p_promise.promised_date;
$$;

comment on function public.promise_settled_amount(public.promises) is 'Payments attributable to one promise: dated inside the business interval the promise itself describes, [made_on, promised_date]. Recording order is irrelevant. Internal — not executable from the browser.';

-- ---------------------------------------------------------------------------
-- 3. Reconciliation: which promises are worth re-judging
-- ---------------------------------------------------------------------------
--
-- The candidate filter used to ask "is there money stored after this row's
-- outcome was written?". Under the window rule that question is both too narrow
-- (a payment entered before the promise row is real evidence for it) and too
-- loose (any late write re-locks a promise no evidence can reach). Both sweeps
-- now ask the business question instead. It is idempotent: apply_promise_outcome
-- returns without writing when the outcome has not changed, so a promise whose
-- evidence is already reflected is re-read and then left exactly as it was.

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
       -- broken/partial one that money dated inside its own window could
       -- legitimately improve.
       and (
         p.status = 'ACTIVE'
         or (p.status in ('BROKEN', 'PARTIALLY_KEPT') and exists (
              select 1 from public.payments py
               where py.receivable_id = p.receivable_id
                 and py.paid_on >= p.made_on
                 and py.paid_on <= p.promised_date))
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
        'Historical payment recorded for a date inside the promise window', 'SYSTEM');
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
                      and py.paid_on >= p.made_on
                      and py.paid_on <= p.promised_date))
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
-- 4. made_on is a promise fact, so it joins the frozen list
-- ---------------------------------------------------------------------------
--
-- The row was backfilled before this redefinition, which is why the order of
-- sections 1 and 4 matters: the guard could not have let the backfill through
-- once made_on was a fact.

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
    or new.made_on is distinct from old.made_on
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
    raise exception 'A broken promise can only be corrected by evidence dated inside its promise window';
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

-- ---------------------------------------------------------------------------
-- 5. The evidence a correction stands on
-- ---------------------------------------------------------------------------

alter table public.promise_events add column metadata jsonb;
alter table public.promise_events
  add constraint promise_events_metadata_is_object check (metadata is null or jsonb_typeof(metadata) = 'object');

comment on column public.promise_events.metadata is 'For a correction, the payments that caused it: reason_type, payment_ids and payments[{id, paid_on}]. Null for ordinary transitions, which need no more than their reason.';

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
  v_metadata jsonb;
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
    -- Evidence that arrived later, dated inside this promise's own window,
    -- corrects the record. The original BROKEN event is not touched.
    if p_to_status not in ('KEPT', 'PARTIALLY_KEPT') then
      raise exception 'A broken promise can only be corrected to KEPT or PARTIALLY_KEPT' using errcode = '42601';
    end if;
    v_is_correction := true;
  elsif p_promise.status = 'PARTIALLY_KEPT' then
    -- One direction only: the rest of the promised sum turned up late but dated
    -- in time. A kept promise never becomes less than it was recorded.
    if p_to_status <> 'KEPT' then
      raise exception 'A partially kept promise can only be corrected to KEPT' using errcode = '42601';
    end if;
    v_is_correction := true;
  else
    raise exception 'A % promise is final', p_promise.status using errcode = '42601';
  end if;

  if v_is_correction then
    -- D-S5-17. "Historical payment recorded" on its own names no evidence. The
    -- payments that justify this correction are read through the same window the
    -- money rule uses, so the stored provenance cannot disagree with the
    -- attribution that produced it.
    select jsonb_build_object(
             'reason_type', 'historical_payment_evidence',
             'payment_ids', coalesce(jsonb_agg(py.id order by py.paid_on, py.id), '[]'::jsonb),
             'payments', coalesce(
               jsonb_agg(
                 jsonb_build_object('id', py.id, 'paid_on', to_char(py.paid_on, 'YYYY-MM-DD'))
                 order by py.paid_on, py.id
               ),
               '[]'::jsonb
             )
           )
      into v_metadata
      from public.payments py
     where py.receivable_id = p_promise.receivable_id
       and py.paid_on >= p_promise.made_on
       and py.paid_on <= p_promise.promised_date;
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

  insert into public.promise_events(owner_id, promise_id, receivable_id, from_status, to_status, reason, actor_type, metadata)
    values(p_promise.owner_id, p_promise.id, p_promise.receivable_id, p_promise.status, p_to_status, p_reason, p_actor_type, v_metadata);

  insert into public.activities(owner_id, client_id, receivable_id, promise_id, type, note, metadata)
    select p_promise.owner_id, r.client_id, p_promise.receivable_id, p_promise.id, v_activity_type,
           case v_activity_type
             when 'PROMISE_CORRECTED' then 'Promise record corrected'
             when 'PROMISE_CANCELLED' then 'Promise cancelled'
             else 'Promise outcome recorded'
           end,
           -- The activity keeps its Stage 4 shape: activities.metadata is pinned
           -- to an allowlist of keys by a CHECK, and the payment evidence belongs
           -- on the promise event that records the correction, not on the
           -- timeline row beside it.
           jsonb_build_object('reason', p_reason)
      from public.receivables r
     where r.id = p_promise.receivable_id;
end;
$$;

comment on function public.apply_promise_outcome(public.promises, text, text, text) is 'The single writer of promises.status. Enforces the transition matrix and appends promise_events + activities for every change, carrying the payment evidence behind a correction. Internal — not executable from the browser.';

-- ---------------------------------------------------------------------------
-- 6. create_promise now takes the promise's own origin date
-- ---------------------------------------------------------------------------
--
-- made_on is an explicit parameter: it is never derived from promised_date and
-- never derived from created_at, because either derivation would be the
-- recording date dressed up as a business fact. Historical entry stays possible
-- (a promise made on the 1st for the 5th, typed in on the 10th, is exactly the
-- case the correction path exists to honour); a promise dated ahead of today is
-- not, because the customer cannot have made a commitment in the future.

drop function if exists public.create_promise(uuid, bigint, date, text, text, uuid);

create or replace function public.create_promise(
  p_receivable_id uuid,
  p_promised_amount_paise bigint,
  p_made_on date,
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
  if p_made_on is null then
    raise exception 'Choose the date the customer made this promise';
  end if;
  if p_promised_date is null then
    raise exception 'Choose the date the customer promised';
  end if;
  -- The window has to be a window: origin first, deadline second, and neither
  -- ahead of the day the ledger is standing on.
  if p_made_on > p_promised_date then
    raise exception 'The promise date cannot be earlier than the day the promise was made';
  end if;
  if p_made_on > public.current_business_date() then
    raise exception 'A promise cannot be dated as made in the future';
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
      and v_prior.made_on = p_made_on
      and v_prior.promised_date = p_promised_date
      and v_prior.source = v_source
      and coalesce(v_prior.note, '') = coalesce(v_note, '') then
      return v_prior;
    end if;
    -- A retry that disagrees with what was already stored is a different act,
    -- and the earlier one is a fact. It is refused rather than appended to.
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
    -- One live commitment at a time. A replacement cannot claim to have been
    -- made before the commitment it replaces, or the invoice would hold two
    -- open windows in an order the facts do not support. Measured against the
    -- still-open row only: an already-graded promise (KEPT, BROKEN,
    -- PARTIALLY_KEPT) is history, and entering an older commitment beside
    -- history stays allowed, which is what the historical-entry case needs.
    if p_made_on < v_active.made_on then
      raise exception 'A new promise cannot be dated as made before the promise it replaces';
    end if;
    perform public.apply_promise_outcome(v_active, 'RENEGOTIATED', 'Replaced by a new promise before its date arrived', 'USER');
  end if;

  -- Safe under the receivable lock taken above: every writer of a promise for
  -- this receivable holds that same lock first, so the sequence cannot race.
  select coalesce(max(sequence_no), 0) + 1 into v_sequence from public.promises where receivable_id = p_receivable_id;

  insert into public.promises(owner_id, receivable_id, sequence_no, promised_amount_paise, made_on, promised_date, source, note, request_id)
    values(v_owner, p_receivable_id, v_sequence, p_promised_amount_paise, p_made_on, p_promised_date, v_source, v_note, p_request_id)
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

comment on function public.create_promise(uuid, bigint, date, date, text, text, uuid) is 'Records a commitment with the business date it was made on, reconciling any earlier active promise first so that only a genuinely still-open commitment is marked RENEGOTIATED. Idempotent per (owner, request_id), including made_on.';

-- ---------------------------------------------------------------------------
-- 7. Grants — the browser set does not change size, only shape
-- ---------------------------------------------------------------------------
--
-- Before: 24 routines executable by authenticated. After: 24 — create_promise
-- returns with one more parameter, so it is a new OID with no grants, and the
-- Stage 3 fail-closed default-privilege machinery leaves it that way unless this
-- file asks for it. Every other routine touched above is internal: redefining it
-- strips whatever it had, and nothing here hands any of it back. No PUBLIC or
-- anon EXECUTE appears in this file, and no service-role key is anywhere near it.

grant execute on function public.create_promise(uuid, bigint, date, date, text, text, uuid) to authenticated;
revoke all on function public.create_promise(uuid, bigint, date, date, text, text, uuid) from public, anon;

revoke all on function public.promise_settled_amount(public.promises) from public, anon, authenticated;
revoke all on function public.promise_outcome(public.promises, date) from public, anon, authenticated;
revoke all on function public.apply_promise_outcome(public.promises, text, text, text) from public, anon, authenticated;
revoke all on function public.settle_promises_for_receivable(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.settle_promises_for_owner(uuid, date) from public, anon, authenticated;
revoke all on function public.current_business_date() from public, anon, authenticated;

-- The routines Stage 5 handed the browser and this file did not redefine keep
-- their grants; they are listed so the count is checkable from one place.
grant execute on function public.record_payment(uuid, bigint, date, text, text, uuid, text) to authenticated;
grant execute on function public.mark_due_promises_broken() to authenticated;
grant execute on function public.snooze_receivable(uuid, date) to authenticated;
grant execute on function public.cancel_receivable(uuid, text) to authenticated;
grant execute on function public.cancel_promise(uuid, text) to authenticated;

commit;
