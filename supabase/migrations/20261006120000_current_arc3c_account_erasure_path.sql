-- Arc 3C — one narrow account-erasure path, so B17 stops being true without making the ledger
-- deletable by anybody who merely wants it to be.
--
-- What was measured before this file was written (docs/ACCOUNT_ERASURE_DESIGN.md carries the full
-- map, and docs/CONSUMER_LIVE_PROGRESS.md carries B17's discovery):
--
--   * 23 foreign keys reach the owner-scoped tables. 9 of them cascade from `profiles`, and
--     `profiles` cascades from `auth.users`. That is the whole of B17: `auth.admin.deleteUser`
--     deletes one auth row, PostgreSQL walks the cascade, and a `BEFORE DELETE` guard on a history
--     row aborts the statement with `Database error deleting user`.
--   * FIVE guard functions fire on DELETE, not three: `prevent_immutable_history_changes()`
--     (payments, activities, promise_events), `guard_promise_history()` (promises) and
--     `prevent_direct_purchase_claim_change()` (purchase_claims). Phase 3B's write-up named the
--     first group only because it never reached the others.
--   * TWO blockers are not triggers at all. `founder_audit_events.target_user_id` and
--     `.claim_id` RESTRICT against `auth.users` and `purchase_claims`, and `create_founder_claim`
--     writes that audit row itself. An account that has ever been through a Founder review is
--     therefore undeletable even with every guard satisfied, and the repair does not loosen the
--     edge to pretend otherwise — see B19 below.
--   * ONE blocker is second-order. `activities_promise_id` is `on delete set null`, so deleting a
--     promise issues an UPDATE on `activities`, and `activities_immutable` fires on UPDATE. A purge
--     that removed promises before activities would trip the immutability guard through the back
--     door. The guard is not relaxed for that UPDATE; the delete order avoids generating it.
--   * `20260814120000_current_stage3_authorization_hardening.sql:72-89` leaves `authenticated` with
--     SELECT on the ledger tables and nothing else. So no session-settable context can unlock a
--     direct delete: the only DELETEs this schema can execute are the ones inside a function owned
--     by the migration role.
--
-- The design therefore puts four conditions between "somebody wants a history row gone" and the
-- row actually going, and all four have to hold at once:
--
--   1. the operation is DELETE — UPDATE stays refused unconditionally, including the SET NULL case;
--   2. a transaction-local context names an account, and it names *this row's own* owner;
--   3. `auth.uid()` of the session is that same account, so a context pre-armed in somebody's
--      session can never be pointed at anybody else;
--   4. the statement runs as the migration owner role, which a browser session cannot become except
--      through a function that is in this directory and reviewable.
--
-- Conditions 2-4 are evaluated in one place, `erasure_allows_delete(uuid)`, so there is one
-- decision to review instead of three guards improvising. That helper is SECURITY INVOKER on
-- purpose: it has to report the role that is really executing the statement, and a definer helper
-- would report its own owner and make condition 4 meaningless. It is revoked from every browser
-- role, so a session cannot even ask it whether a delete would be allowed; the consequence is that
-- if a future migration ever handed a browser role table DELETE, the guard would refuse it with
-- `permission denied for function` instead of its own message. Both are refusals.
--
-- Nothing was disabled, dropped or re-enabled by this file. Every guard trigger still exists, is
-- still enabled, and still fires on UPDATE.
--
-- B19 (recorded, not fixed here): an account entangled with the Founder review ledger is refused by
-- this path rather than erased. There are two entangling edges and the RPC checks both: being named
-- as the subject of an audit event (`target_user_id`, RESTRICT into auth.users), and owning a claim
-- that audit events point at (`claim_id`, RESTRICT into purchase_claims). In practice they arrive
-- together, since `create_founder_claim` writes a CLAIM_CREATED row carrying both
-- (`20260813030000_stage4_founder_monetization.sql:164-165`), but checking only the first would
-- leave a future claim shape that skips it to fail as a raw foreign-key abort halfway through the
-- purge instead of as the clean refusal the caller sees today. Erasing such an account means
-- deleting review provenance that Stage 8 made immutable, or rewriting a RESTRICT edge — a product
-- decision about the Founder ledger, not a detail of this repair.
--
-- Reviewers are NOT caught by B19: `actor_user_id` (`20260813030000:34`) and `founder_admins.created_by`
-- (`:26`) are SET NULL and no guard fires on that cascade UPDATE, so a reviewer can erase their own
-- account and the audit trail survives with the actor blanked.

-- ---------------------------------------------------------------------------
-- 1. The single decision point.
-- ---------------------------------------------------------------------------

create or replace function public.erasure_allows_delete(p_owner uuid)
returns boolean
language plpgsql
stable
set search_path = public, auth, pg_temp
as $$
declare
  v_context text := current_setting('app.dueweave_erasure_owner', true);
begin
  if p_owner is null then
    return false;
  end if;
  if v_context is null or v_context <> p_owner::text then
    return false;
  end if;
  if auth.uid() is distinct from p_owner then
    return false;
  end if;
  if current_user <> 'postgres' then
    return false;
  end if;
  return true;
end;
$$;

comment on function public.erasure_allows_delete(uuid) is 'The only thing that may permit a DELETE of a guarded history row: a transaction-local erasure context naming this row''s own owner, the verified session user being that same account, and the statement running as the migration owner role. SECURITY INVOKER so current_user is the caller''s real role. Internal: not executable from any browser role.';

-- ---------------------------------------------------------------------------
-- 2. The three guards consult it, from inside a DELETE branch and nowhere else.
-- ---------------------------------------------------------------------------

create or replace function public.prevent_immutable_history_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and public.erasure_allows_delete(old.owner_id) then
    return old;
  end if;
  raise exception 'Historical records cannot be changed';
end;
$$;

comment on function public.prevent_immutable_history_changes() is 'payments, activities and promise_events are append-only: UPDATE is always refused, and DELETE only inside the account-erasure workflow this row''s own owner is being removed under.';

create or replace function public.guard_promise_history()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and public.erasure_allows_delete(old.owner_id) then
    return old;
  end if;
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

create or replace function public.prevent_direct_purchase_claim_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_context text := current_setting('app.dueweave_claim_context', true);
begin
  if tg_op = 'INSERT' then
    if v_context <> 'CREATE' then raise exception 'Founder claims must be created through the protected claim workflow'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' and public.erasure_allows_delete(old.owner_id) then
    return old;
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

-- ---------------------------------------------------------------------------
-- 3. The account holder's own path. Zero arguments: there is no parameter to point at someone
--    else, so "a caller cannot erase another account" is a property of the signature.
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'Authentication is required';
  end if;

  -- B19, checked before anything is removed so the refusal cannot be half-applied. Both Founder
  -- edges are tested, because either one alone would stop the purge partway through.
  if exists (select 1 from public.founder_audit_events a
             where a.target_user_id = v_owner
                or a.claim_id in (select c.id from public.purchase_claims c where c.owner_id = v_owner)) then
    raise exception 'This account is part of a Founder review record, so DueWeave cannot erase it from the self-service path';
  end if;

  perform set_config('app.dueweave_erasure_owner', v_owner::text, true);

  -- Child-first, and in the one order that generates no second-order write: activities before
  -- promises (or a promise delete would SET NULL onto activity history), receivables before
  -- clients (the clients edge RESTRICTs), claims and reviewer rows before the profile, and the
  -- profile last so nothing is left orphaned behind a cascade nobody ordered.
  delete from public.promise_events where owner_id = v_owner;
  delete from public.payments where owner_id = v_owner;
  delete from public.activities where owner_id = v_owner;
  delete from public.promises where owner_id = v_owner;
  delete from public.purchase_claims where owner_id = v_owner;
  delete from public.entitlements where user_id = v_owner;
  delete from public.analytics_events where owner_id = v_owner;
  delete from public.receivables where owner_id = v_owner;
  delete from public.clients where owner_id = v_owner;
  delete from public.founder_admins where user_id = v_owner;
  delete from public.profiles where id = v_owner;
end;
$$;

comment on function public.delete_my_account() is 'Erase the signed-in account''s own business data, history included. The auth.users row is removed afterwards by the delete-account Edge Function through the admin API; by then the cascade has nothing left to trip on. This is the only browser-reachable path that can delete guarded history, it takes no target, and it refuses an account entangled with the Founder review ledger (as a review subject or as the owner of a reviewed claim) rather than erasing review provenance — B19.';

-- ---------------------------------------------------------------------------
-- 4. Privileges. Fail-closed defaults mean nothing is granted by accident, and a new function is
--    new: the explicit revoke is what the event trigger and D11 taught this repository to require.
-- ---------------------------------------------------------------------------

revoke all on function public.erasure_allows_delete(uuid) from public, anon, authenticated, service_role;
revoke all on function public.delete_my_account() from public, anon, service_role;
grant execute on function public.delete_my_account() to authenticated;

revoke all on function public.prevent_immutable_history_changes() from public, anon, authenticated;
revoke all on function public.guard_promise_history() from public, anon, authenticated;
revoke all on function public.prevent_direct_purchase_claim_change() from public, anon, authenticated;

-- The blunt RPC stays revoked exactly where Stage 2 left it: the repair did not re-open
-- `delete_my_business_data()` to make a deletion path work.
revoke all on function public.delete_my_business_data() from public, anon, authenticated;
