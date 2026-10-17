-- Stage 4 (current roadmap) — the SQLSTATE the stale-edit refusal raises (pgTAP).
--
-- Run with: pnpm test:db   (supabase test db)
--
-- The edit routines refuse a stale `p_expected_updated_at` so that a second tab can never
-- silently overwrite a money record. The refusal has to REACH the customer to be worth having,
-- and the code it is raised with decides what the HTTP layer in front of Postgres does with it:
-- SQLSTATE 40001 (serialization_failure) and 40P01 (deadlock_detected) tell the reader "roll
-- back and try that transaction again", and a PostgREST built on that reading re-runs the raise
-- instead of answering it. Measured live on the production project on 2026-10-16: the same
-- session answered a P0002 refusal in 76 ms and 128 ms, while the stale-token call was still
-- unanswered after 30 s and the edge returned HTTP 504 "upstream request timeout" at 125 s. The
-- row was untouched either way — the customer simply waits two minutes for a message that
-- already exists in the code. Reproduced on the pinned local build (postgrest:v14.18) on
-- 2026-10-17 in one run: 40001 unanswered at 40 s and 40P01 unanswered at 20 s, while P0001
-- answered in 253 ms and a private-use DW001 in 181 ms, and P0001/DW001 answered again
-- (124 ms / 15 ms) after both stalls, so the stall belonged to the code and not to the session
-- or a wedged pool.
--
-- So the conflict is raised with a private-use SQLSTATE outside the retryable pair, which every
-- transport forwards as an ordinary refusal, and the customer-facing words stay exactly as they
-- were, because the client's conflict copy is keyed on both the code and that wording.

set search_path = public, extensions, tap, core;
create extension if not exists pgtap with schema extensions;

select plan(5);

-- ---------------------------------------------------------------------------
-- A. The stale-token branch of each routine raises the conflict code, read out
--    of the routine's own source next to its own message, so this expectation
--    cannot be satisfied by some unrelated `errcode` elsewhere in the body.
-- ---------------------------------------------------------------------------
select is(
  (select substring(prosrc from 'changed in another session'' using errcode = ''([0-9A-Z]{5})''')
     from pg_proc where oid = 'public.update_client(uuid, text, text, text, text, text, timestamptz)'::regprocedure),
  'DW001',
  'a stale client edit is refused with the private conflict code, not a class-40 serialization failure');

select is(
  (select substring(prosrc from 'changed in another session'' using errcode = ''([0-9A-Z]{5})''')
     from pg_proc where oid = 'public.update_receivable_details(uuid, text, text, text, timestamptz)'::regprocedure),
  'DW001',
  'a stale receivable edit is refused with the same private conflict code');

-- ---------------------------------------------------------------------------
-- B. The wording the conflict copy also keys on must not drift while the code
--    is being changed — a silent rephrase would drop the customer to a generic
--    "could not save" and nothing else in this file would notice.
-- ---------------------------------------------------------------------------
select ok(
  (select position('This client changed in another session' in prosrc) > 0
     from pg_proc where oid = 'public.update_client(uuid, text, text, text, text, text, timestamptz)'::regprocedure),
  'the client edit refusal still says the client changed in another session');

select ok(
  (select position('This receivable changed in another session' in prosrc) > 0
     from pg_proc where oid = 'public.update_receivable_details(uuid, text, text, text, timestamptz)'::regprocedure),
  'the receivable edit refusal still says the receivable changed in another session');

-- ---------------------------------------------------------------------------
-- C. The sweep, not just the two routines this was found in. Any public routine
--    that raises one of the codes the transport retries is a refusal that never
--    reaches the customer, so none may exist — including in routines added later.
--    The sweep is scoped to the two codes that were measured swallowing a reply,
--    not to all of class 40: `40901` (the Stage 5 idempotency-key refusal) is also
--    class 40 but answers promptly — measured HTTP 500 in 27 ms on the same build
--    and session — and the adapter already renders its own wording for it
--    (client/src/data/supabase-adapters.ts), so it is a rough edge, not this defect.
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ 'errcode\s*=\s*''(40001|40P01)'''),
  0::bigint,
  'no public routine raises serialization_failure or deadlock_detected, the two codes that stall the reply');

select * from finish();
