-- Stage 5 closure (current roadmap) — the promise chronology, pinned in the
-- database itself (pgTAP).
--
-- Run with: pnpm test:db   (supabase test db)
--
-- stage5_01_lifecycle.sql pinned the lifecycle that this stage had to repair.
-- Its attribution rule asked which money had been STORED after a promise row was
-- written, which is a question about keyboards and not about the ledger: two
-- customers' commitments on one invoice could be credited in either order, and a
-- receipt entered afterwards could not reach the promise it actually settled.
-- This file pins the replacement — a business window on every promise, the
-- provenance that a correction now carries, and the fact that the repair did not
-- hand the browser a single new door.
--
-- Same discipline as every file before it: no fixtures, no fake tables, nothing
-- rolled back behind the scenes. Structural expectations read the objects the
-- migration created; the behavioural ones run a rule over values the tests
-- assemble in an expression, or audit rows nobody but a real user can write. The
-- one exception is deliberate and labelled: the backfill is measured against the
-- expression that produced it, because that expression is the only claim this
-- database can honestly make about historical rows.

set search_path = public, extensions, tap, core;
create extension if not exists pgtap with schema extensions;

select plan(47);

-- ---------------------------------------------------------------------------
-- A. The origin date is a business fact stored as its own column.
--    Not promised_date wearing a different hat, and not created_at truncated: a
--    third fact, so the ledger can hold all three at once.
-- ---------------------------------------------------------------------------
select has_column('public', 'promises', 'made_on',
    'a promise remembers the day the customer actually made it');

select is((select is_nullable::text from information_schema.columns
           where table_schema = 'public' and table_name = 'promises' and column_name = 'made_on'),
          'NO'::text,
          'no promise may exist without an origin — a silent null would put the old ambiguity back');

select is((select data_type::text from information_schema.columns
           where table_schema = 'public' and table_name = 'promises' and column_name = 'made_on'),
          'date'::text,
          'the origin is a whole business day, so no time-of-day reading can decide attribution');

select is((select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.promises'::regclass and conname = 'promises_made_on_not_after_promised_date'),
          'CHECK ((made_on <= promised_date))',
          'a window cannot open after it closes');

select is((select count(*) from pg_constraint
           where conrelid = 'public.promises'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%made_on%'), 1::bigint,
          'exactly one constraint governs the origin, so no second definition can drift beside it');

-- The comment is part of the contract: it is where this database says out loud
-- that a legacy origin is compatibility metadata rather than evidence.
select ok(col_description('public.promises'::regclass,
           (select attnum from pg_attribute where attrelid = 'public.promises'::regclass and attname = 'made_on'))
          ~~ '%compatibility metadata%',
          'the column documents that a backfilled origin is compatibility metadata');

select ok(col_description('public.promises'::regclass,
           (select attnum from pg_attribute where attrelid = 'public.promises'::regclass and attname = 'made_on'))
          ~~ '%not proof%',
          'and says plainly that it is not proof of when the promise was made');

select is((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'promises'
             and column_name in ('made_on', 'promised_date', 'created_at')), 3::bigint,
          'origin, deadline and recording instant are three separate facts — the recording instant is kept for the audit trail, not reused as a business date');

-- ---------------------------------------------------------------------------
-- B. The backfill, executed.
--    The migration's rule is least(the India day the row was stored on, the
--    promised day). Both branches satisfy made_on <= promised_date by
--    construction, and neither invents an origin earlier than the row's own
--    facts allow. The India day matters: reading the UTC calendar instead would
--    silently widen every evening-entered legacy window by a day.
-- ---------------------------------------------------------------------------
select is(((timestamp with time zone '2026-09-24T20:15:00+00') at time zone 'Asia/Kolkata')::date,
          date '2026-09-25',
          'a promise stored late on the 24th UTC belongs to the 25th in the only calendar this ledger uses');

select is(((timestamp with time zone '2026-09-24T02:00:00+00') at time zone 'Asia/Kolkata')::date,
          date '2026-09-24'::date,
          'and a promise stored early on the 24th UTC stays on the 24th — the rule follows the calendar, it does not add a day');

select is(least(((timestamp with time zone '2026-09-24T20:15:00+00') at time zone 'Asia/Kolkata')::date, date '2026-09-20'),
          date '2026-09-20',
          'a historical promise entered after its own deadline has its window collapsed onto the deadline rather than given an invented earlier origin');

select is((select count(*) from (values
            (timestamptz '2026-09-24T20:15:00+00', date '2026-09-30', date '2026-09-25'),
            (timestamptz '2026-09-24T02:00:00+00', date '2026-09-24', date '2026-09-24'),
            (timestamptz '2026-09-24T20:15:00+00', date '2026-09-20', date '2026-09-20'),
            (timestamptz '2026-10-01T18:45:00+00', date '2026-10-01', date '2026-10-01')
          ) v(recorded, promised_date, made_on)
          where v.made_on is distinct from least((v.recorded at time zone 'Asia/Kolkata')::date, v.promised_date)
             or v.made_on > v.promised_date), 0::bigint,
          'the backfill rule accepts every legacy row it could legitimately have produced, including a same-day promise and one entered after its deadline');

select is((select count(*) from (values
            (timestamptz '2026-09-24T20:15:00+00', date '2026-09-30', date '2026-09-26'),
            (timestamptz '2026-09-24T20:15:00+00', date '2026-09-30', date '2026-09-24'),
            (timestamptz '2026-10-01T18:45:00+00', date '2026-10-01', date '2026-10-02')
          ) v(recorded, promised_date, made_on)
          where v.made_on is distinct from least((v.recorded at time zone 'Asia/Kolkata')::date, v.promised_date)
             or v.made_on > v.promised_date), 3::bigint,
          'the same rule reports all three planted faults: an origin pulled from the UTC day, one widened a day early, and a window that opens after it closes');

select is((select count(*) from public.promises where made_on > promised_date), 0::bigint,
          'no stored promise holds a window that opens after it closes');

select is((select count(*) from public.promises where request_id is null
             and made_on is distinct from least((created_at at time zone 'Asia/Kolkata')::date, promised_date)),
          0::bigint,
          'every pre-closure row carries exactly the origin its own recording instant and deadline can justify — nothing more');

-- ---------------------------------------------------------------------------
-- C. Attribution is the window, and the clock appears nowhere in it.
--    These are the only two clauses a payment has to satisfy, and they are
--    pinned as text because the whole point is what the money rule must NOT look
--    at: no created_at, no insert order, no time of day.
-- ---------------------------------------------------------------------------
select ok(position('py.paid_on >= p_promise.made_on' in prosrc) > 0,
          'the credit rule opens at the day the promise was made')
  from pg_proc where oid = 'public.promise_settled_amount(public.promises)'::regprocedure;

select ok(position('py.paid_on <= p_promise.promised_date' in prosrc) > 0,
          'and closes on the promised day, inclusively — money paid that day counts')
  from pg_proc where oid = 'public.promise_settled_amount(public.promises)'::regprocedure;

select ok(position('created_at' in prosrc) = 0,
          'no recording instant appears anywhere in the credit rule')
  from pg_proc where oid = 'public.promise_settled_amount(public.promises)'::regprocedure;

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'promise_settled_amount'
             and p.pronargs = 1 and p.proargtypes[0] = 'public.promises'::regtype::oid
             and p.pronargdefaults = 0), 1::bigint,
          'credit is computed from the promise row alone: one overload, taking the promise, with nothing to default');

select is((select count(*) from pg_proc p
           where p.oid in ('public.settle_promises_for_receivable(uuid,uuid,date)'::regprocedure,
                           'public.settle_promises_for_owner(uuid,date)'::regprocedure)
             and position('py.paid_on >= p.made_on' in p.prosrc) > 0
             and position('py.paid_on <= p.promised_date' in p.prosrc) > 0), 2::bigint,
          'both reconciliation sweeps look for money inside the window, so a receipt entered before the promise row is still found by the promise it settled');

select is((select count(*) from pg_proc p
           where p.oid in ('public.settle_promises_for_receivable(uuid,uuid,date)'::regprocedure,
                           'public.settle_promises_for_owner(uuid,date)'::regprocedure)
             and position('created_at' in p.prosrc) > 0), 0::bigint,
          'and neither sweep asks when anything was stored to decide what is worth re-judging');

select ok(position('made_on, promised_date, source, note, request_id' in prosrc) > 0,
          'create_promise writes the origin in the same statement as the promise, so no row can be saved without it')
  from pg_proc where oid = 'public.create_promise(uuid,bigint,date,date,text,text,uuid)'::regprocedure;

-- ---------------------------------------------------------------------------
-- D. The four refusals a browser can provoke, and the replay that must not lie.
--    Every message below is one the client can show; a request id that recorded a
--    different promise is refused rather than appended to.
-- ---------------------------------------------------------------------------
select ok(position('Choose the date the customer made this promise' in prosrc) > 0,
          'an absent origin is refused rather than guessed')
  from pg_proc where oid = 'public.create_promise(uuid,bigint,date,date,text,text,uuid)'::regprocedure;

select ok(position('The promise date cannot be earlier than the day the promise was made' in prosrc) > 0,
          'an inverted window is refused in the words the form uses')
  from pg_proc where oid = 'public.create_promise(uuid,bigint,date,date,text,text,uuid)'::regprocedure;

select ok(position('A promise cannot be dated as made in the future' in prosrc) > 0,
          'a commitment cannot be dated ahead of the working day the ledger stands on')
  from pg_proc where oid = 'public.create_promise(uuid,bigint,date,date,text,text,uuid)'::regprocedure;

select ok(position('A new promise cannot be dated as made before the promise it replaces' in prosrc) > 0,
          'a replacement cannot claim to predate the live commitment it supersedes')
  from pg_proc where oid = 'public.create_promise(uuid,bigint,date,date,text,text,uuid)'::regprocedure;

select ok(position('v_prior.made_on = p_made_on' in prosrc) > 0,
          'the idempotent replay compares the origin, so the same request id with a different made_on is a mismatch and not a second promise')
  from pg_proc where oid = 'public.create_promise(uuid,bigint,date,date,text,text,uuid)'::regprocedure;

-- The order of these two calls is the whole of the honesty in renegotiation:
-- grade the old promise on its own facts first, only then decide whether it was
-- still open to be superseded.
select ok(position('public.settle_promises_for_receivable' in prosrc) > 0
          and position('public.settle_promises_for_receivable' in prosrc)
              < position('''RENEGOTIATED''' in prosrc),
          'existing promises are reconciled before any of them can be marked superseded')
  from pg_proc where oid = 'public.create_promise(uuid,bigint,date,date,text,text,uuid)'::regprocedure;

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'create_promise' and p.pronargs = 6), 0::bigint,
          'the origin-less signature is dropped outright, not left as an overload to slip through');

-- ---------------------------------------------------------------------------
-- E. History holds the origin still.
--    made_on is a promise fact, so the guard that stops a status being rewritten
--    now stops the window being re-pointed: re-dating an old promise would
--    retroactively move money in or out of it.
-- ---------------------------------------------------------------------------
select ok(position('new.made_on is distinct from old.made_on' in prosrc) > 0,
          'the promise-history guard treats a changed origin as a rewrite of history')
  from pg_proc p where p.oid = 'public.guard_promise_history()'::regprocedure;

select is((select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_proc p on p.oid = t.tgfoid
           where c.relname = 'promises' and p.proname = 'guard_promise_history' and t.tgenabled = 'O'),
          1::bigint,
          'and that guard is live on the table rather than defined and disabled');

-- ---------------------------------------------------------------------------
-- F. A correction says which money it stands on.
--    A BROKEN -> KEPT flip used to be a sentence with no evidence behind it: the
--    timeline said a promise was rescued by late money without naming any of it,
--    so a reader could not check the claim. The evidence now travels with the
--    event, in a column that is allowed to hold an object and nothing else.
-- ---------------------------------------------------------------------------
select has_column('public', 'promise_events', 'metadata',
    'an outcome event can carry its evidence');

select is((select (data_type || '/' || is_nullable)::text from information_schema.columns
           where table_schema = 'public' and table_name = 'promise_events' and column_name = 'metadata'),
          'jsonb/YES'::text,
          'the evidence is structured, and optional — an ordinary transition needs no more than its reason');

select is((select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.promise_events'::regclass and conname = 'promise_events_metadata_is_object'),
          'CHECK (((metadata IS NULL) OR (jsonb_typeof(metadata) = ''object''::text)))',
          'a correction payload must be an object: no bare list or stray scalar can be filed as evidence');

select is((select count(*) from pg_constraint
           where conrelid = 'public.promise_events'::regclass
             and pg_get_constraintdef(oid) ilike '%metadata%'), 1::bigint,
          'exactly one constraint governs the evidence column, so there is no second definition to drift');

select ok(col_description('public.promise_events'::regclass,
           (select attnum from pg_attribute where attrelid = 'public.promise_events'::regclass and attname = 'metadata'))
          ~~ '%payment_ids%',
          'the column documents the shape it expects, including the ids of the payments behind a correction');

select ok(position('''reason_type'', ''historical_payment_evidence''' in prosrc) > 0
          and position('''payment_ids''' in prosrc) > 0,
          'the single writer of outcomes labels a correction and lists the receipts that caused it')
  from pg_proc where oid = 'public.apply_promise_outcome(public.promises,text,text,text)'::regprocedure;

-- The evidence is dated the way the window is dated. A timestamp here would
-- reintroduce, in the audit trail, the precision the money rule deliberately
-- refuses to look at.
select ok(position('''paid_on'', to_char(py.paid_on, ''YYYY-MM-DD'')' in prosrc) > 0,
          'the evidence records each payment''s business day, matching the day-granular window')
  from pg_proc where oid = 'public.apply_promise_outcome(public.promises,text,text,text)'::regprocedure;

select ok(position('jsonb_build_object(''reason'', p_reason)' in prosrc) > 0,
          'the timeline row keeps the Stage 4 shape its own allowlist permits, so provenance was added without widening activities')
  from pg_proc where oid = 'public.apply_promise_outcome(public.promises,text,text,text)'::regprocedure;

-- ---------------------------------------------------------------------------
-- G. The repair opened no new door.
--    create_promise is a fresh OID with no grants, and the Stage 3 fail-closed
--    default-privilege machinery keeps it that way until a migration asks
--    otherwise — so "the browser set is the same size as before" is something to
--    measure rather than assert.
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('authenticated',
            'public.create_promise(uuid,bigint,date,date,text,text,uuid)', 'EXECUTE'),
          'the signed-in browser may still record a promise');

select ok(not has_function_privilege('anon',
            'public.create_promise(uuid,bigint,date,date,text,text,uuid)', 'EXECUTE')
          and not has_function_privilege('public',
            'public.create_promise(uuid,bigint,date,date,text,text,uuid)', 'EXECUTE'),
          'the anonymous role and PUBLIC may not');

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and exists (select 1 from aclexplode(p.proacl) a
                          where a.grantee = 0 and a.privilege_type = 'EXECUTE')),
          0::bigint,
          'not one routine in this schema grants EXECUTE to PUBLIC');

select is((select count(*) from pg_proc p
           where p.oid in ('public.promise_settled_amount(public.promises)'::regprocedure,
                           'public.promise_outcome(public.promises,date)'::regprocedure,
                           'public.apply_promise_outcome(public.promises,text,text,text)'::regprocedure,
                           'public.settle_promises_for_receivable(uuid,uuid,date)'::regprocedure,
                           'public.settle_promises_for_owner(uuid,date)'::regprocedure,
                           'public.current_business_date()'::regprocedure)
             and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                  or has_function_privilege('anon', p.oid, 'EXECUTE')
                  or has_function_privilege('public', p.oid, 'EXECUTE'))),
          0::bigint,
          'every lifecycle helper this file redefined stayed out of reach after being redefined');

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
          24::bigint,
          'the browser-reachable routine count is unchanged at 24: the repair reshaped one signature, it did not add a capability');

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('promise_settled_amount', 'promise_outcome', 'apply_promise_outcome',
                               'settle_promises_for_receivable', 'settle_promises_for_owner', 'current_business_date')
             and array_to_string(p.proconfig, ',') = 'search_path=""'), 6::bigint,
          'all six internal helpers pin an empty search path, so the window rule cannot be re-pointed by a caller');

select is((select array_to_string(proconfig, ',') from pg_proc
           where oid = 'public.create_promise(uuid,bigint,date,date,text,text,uuid)'::regprocedure),
          'search_path=public, auth, pg_temp',
          'the browser-facing routine pins its path too, with pg_temp last so a temporary schema cannot shadow a table it reads');

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'create_promise'
             and p.prosecdef and p.provolatile = 'v'), 1::bigint,
          'create_promise remains a single SECURITY DEFINER entry point, so the origin checks cannot be bypassed by table privileges');

select * from finish();
