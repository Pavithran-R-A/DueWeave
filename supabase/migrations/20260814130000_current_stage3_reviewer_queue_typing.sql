-- Stage 3 / Phase 19-20 — the Founder review queue must actually execute.
--
-- Executed defect D8. tests/stage3-local-rls.test.ts enrols a controlled local
-- reviewer fixture and calls list_rejected_founder_claims() through the browser
-- role. Before this migration that call failed:
--
--   42804  structure of query does not match function result type
--   Returned type character varying(255) does not match expected type text
--   in column 3
--
-- Cause: auth.users.email is varchar(255) while the declared OUT column is
-- text, and plpgsql refuses the row assignment into the function's result
-- tuplestore. `supabase db lint --local` reports this as the only error in the
-- public schema. The sibling list_pending_founder_claims() already casts, so
-- the rejected queue was the one path that had drifted.
--
-- Effect of the defect: a real reviewer could never open the rejected-claim
-- list, so a reconsideration could not be worked. This is an availability
-- break in an authorization surface, not a bypass — no row was ever exposed.
--
-- The signature, owner, security type and search_path are all unchanged, so
-- generated client types and every existing caller stay byte-identical.

create or replace function public.list_rejected_founder_claims()
 returns table(
   claim_id text,
   owner_id uuid,
   owner_email text,
   payer_name text,
   utr_reference text,
   amount_paise bigint,
   rejected_at timestamp with time zone,
   rejection_note text
 )
 language plpgsql
 stable security definer
 set search_path to 'public', 'auth', 'pg_temp'
as $fn$
begin
  perform public.assert_founder_admin();
  return query
    select c.claim_id,
      c.owner_id,
      u.email::text,
      c.payer_name,
      c.utr_reference,
      c.amount_paise,
      c.reviewed_at,
      c.review_note
    from public.purchase_claims c
    join auth.users u on u.id = c.owner_id
    where c.status = 'REJECTED'
    order by c.reviewed_at desc nulls last;
end;
$fn$;

-- Re-assert the Stage 3 execution posture so the grant set is explicit in the
-- migration history rather than inherited from whatever the object had before.
revoke all on function public.list_rejected_founder_claims() from public, anon;
grant execute on function public.list_rejected_founder_claims() to authenticated;

comment on function public.list_rejected_founder_claims() is
  'Founder review queue of rejected claims. SECURITY DEFINER, gated by '
  'assert_founder_admin(). auth.users.email is cast to text so the returned '
  'row matches the declared projection (42804 otherwise).';
