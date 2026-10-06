-- Arc 3C — the account-erasure path (pgTAP).
--
-- Run with: pnpm test:db   (supabase test db)
--
-- B17 was found by executing Phase 3B's cleanup: an account with ledger history could not be
-- deleted by any supported path, because the `auth.users` cascade walks into `BEFORE DELETE`
-- guards on history rows and the whole statement aborts. The repair is ONE narrow, deliberate
-- erasure context, designed in docs/ACCOUNT_ERASURE_DESIGN.md. This file pins the shape that
-- makes it narrow, and — just as importantly — pins the things that had to stay closed so the
-- fix did not become the usual way to make a deletion work: relax the guard, drop the trigger,
-- grant the table.
--
-- The four conditions every guarded DELETE must satisfy are all checked here or in
-- tests/arc3c-local-account-erasure.test.ts: the operation is DELETE, the transaction-local
-- context names the row's own owner, the session's verified `auth.uid()` names the same account,
-- and the statement runs as the migration owner role rather than as a browser role.
--
-- STATUS: written but NOT EXECUTED. `pnpm test:db` needs a loopback Supabase and the Docker daemon
-- on this machine answers neither the host nor WSL, so the plan below has never run. Every assertion
-- here is a claim waiting for a database, not a pass.

select plan(41);

-- ---------------------------------------------------------------------------
-- A. The erasure RPC exists, and it cannot be pointed at anybody but the caller.
--    Zero arguments is the security property: there is no parameter to spoof,
--    so "never accept a target user id from the browser" is enforced by the
--    signature rather than by a check that a later edit can forget.
-- ---------------------------------------------------------------------------
select has_function('public', 'delete_my_account',
    'a self-service erasure path exists at all (the gap B17 recorded)');

select is((select count(*) from pg_proc where oid = 'public.delete_my_account()'::regprocedure
           and pronargs = 0), 1::bigint,
          'it takes no arguments, so no caller can name another account');

select is((select prorettype::regtype::text from pg_proc
           where oid = 'public.delete_my_account()'::regprocedure), 'void',
          'it returns nothing: an erasure has no payload to leak');

select is((select prosecdef from pg_proc where oid = 'public.delete_my_account()'::regprocedure), true,
    'it runs as its owner, because a purge must reach rows RLS deliberately hides from a cascade');

select ok((select array_to_string(proconfig, ',') like '%search_path%=public, auth, pg_temp%'
           from pg_proc where oid = 'public.delete_my_account()'::regprocedure),
    'and its search path is pinned, including `auth` so auth.uid() is the one that resolves');

select is((select count(*) from pg_proc p
           cross join aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
           join pg_roles r on r.oid = a.grantee
           where p.oid = 'public.delete_my_account()'::regprocedure
             and a.privilege_type = 'EXECUTE' and r.rolname = 'authenticated'), 1::bigint,
    'authenticated can invoke it — it is the account holder''s own path');

select is(has_function_privilege('anon', 'public.delete_my_account()', 'EXECUTE'), false,
    'anon cannot invoke it');

select is(has_function_privilege('service_role', 'public.delete_my_account()', 'EXECUTE'), false,
    'not even the privileged key can invoke it: erasure is driven by a real user token, so a leaked '
    || 'service key is not an erasure capability');

select is((select count(*) from pg_proc p
           cross join aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
           where p.oid = 'public.delete_my_account()'::regprocedure
             and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 0::bigint,
    'the PUBLIC pseudo-role holds nothing on it (the D11 shape: PostgreSQL grants it implicitly)');

select is(has_function_privilege('authenticated', 'public.delete_my_business_data()', 'EXECUTE'), false,
    'the old blunt RPC stays revoked — the repair did not re-open it to get a test green');

-- ---------------------------------------------------------------------------
-- B. The decision lives in exactly one place, and that place is not browser-reachable.
--    One helper means one review; a guard that asks a question in four different
--    bodies is four chances to get one wrong.
-- ---------------------------------------------------------------------------
select has_function('public', 'erasure_allows_delete',
    'the DELETE allowance is decided by one function, not by each guard improvising');

select is(has_function_privilege('authenticated', 'public.erasure_allows_delete(uuid)', 'EXECUTE'), false,
    'the helper is internal — a browser role cannot ask it whether a delete would be allowed');

select is(has_function_privilege('anon', 'public.erasure_allows_delete(uuid)', 'EXECUTE'), false,
    'and it is not callable anonymously either');

select ok((select position('auth.uid()' in prosrc) > 0
           from pg_proc where oid = 'public.erasure_allows_delete(uuid)'::regprocedure),
    'the helper re-checks the session''s verified caller, so a pre-armed context cannot name someone else');

select ok((select position('current_user' in prosrc) > 0
           from pg_proc where oid = 'public.erasure_allows_delete(uuid)'::regprocedure),
    'and it requires the migration owner role, so only a definer path written here can delete a guarded row');

select ok((select position('app.dueweave_erasure_owner' in prosrc) > 0
           from pg_proc where oid = 'public.erasure_allows_delete(uuid)'::regprocedure),
    'reading the transaction-local context is the helper''s own job');

-- ---------------------------------------------------------------------------
-- C. Every guard consults the helper from inside a DELETE branch, once.
--    If the call sat outside the tg_op test, arming the context would also open
--    history to rewriting — which is the claim the product makes about its ledger.
-- ---------------------------------------------------------------------------
select ok((select position('tg_op = ''DELETE'' and public.erasure_allows_delete(old.owner_id)' in prosrc) > 0
           from pg_proc where oid = 'public.prevent_immutable_history_changes()'::regprocedure),
    'the payments/activities/promise_events guard asks the helper only for DELETE');

select is((select count(*) from regexp_split_to_array(
             (select prosrc from pg_proc where oid = 'public.prevent_immutable_history_changes()'::regprocedure),
             'erasure_allows_delete')) - 1, 1::bigint,
    'and asks it exactly once, so there is no second branch that opened UPDATE by mistake');

select ok((select position('tg_op = ''DELETE'' and public.erasure_allows_delete(old.owner_id)' in prosrc) > 0
           from pg_proc where oid = 'public.guard_promise_history()'::regprocedure),
    'the promise-history guard asks the helper only for DELETE');

select is((select count(*) from regexp_split_to_array(
             (select prosrc from pg_proc where oid = 'public.guard_promise_history()'::regprocedure),
             'erasure_allows_delete')) - 1, 1::bigint,
    'once, in the promise guard too');

select ok((select position('tg_op = ''DELETE'' and public.erasure_allows_delete(old.owner_id)' in prosrc) > 0
           from pg_proc where oid = 'public.prevent_direct_purchase_claim_change()'::regprocedure),
    'the Founder-claim guard asks the helper only for DELETE');

select is((select count(*) from regexp_split_to_array(
             (select prosrc from pg_proc where oid = 'public.prevent_direct_purchase_claim_change()'::regprocedure),
             'erasure_allows_delete')) - 1, 1::bigint,
    'once, in the claim guard too');

-- ---------------------------------------------------------------------------
-- D. What had to stay shut.
--    These are the assertions that turn "we did not weaken immutability" from a
--    sentence into a measurement: the same five triggers, still enabled, still
--    firing on UPDATE, still refusing a browser role at the privilege layer.
-- ---------------------------------------------------------------------------
select is((select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and t.tgname in ('payments_immutable', 'activities_immutable', 'promise_events_immutable',
                              'promises_guard_history', 'purchase_claims_protect_workflow')
             and t.tgenabled = 'O'), 5::bigint,
    'all five DELETE guards are still enabled — no trigger was disabled or dropped to make deletion work');

select is((select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and t.tgname in ('payments_immutable', 'activities_immutable', 'promise_events_immutable',
                              'promises_guard_history', 'purchase_claims_protect_workflow')
             and (t.tgtype & 16) <> 0), 5::bigint,
    'and all five still fire on UPDATE, so the erasure path opened DELETE only');

select is((select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and t.tgname in ('payments_immutable', 'activities_immutable', 'promise_events_immutable',
                              'promises_guard_history', 'purchase_claims_protect_workflow')
             and (t.tgtype & 8) <> 0), 5::bigint,
    'and still fire on DELETE, so the guard is the thing deciding, not an absent trigger');

select is((select coalesce(array_agg(c.relname order by c.relname), '{}'::text[])
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           cross join aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
           join pg_roles r on r.oid = a.grantee
           where n.nspname = 'public'
             and c.relname in ('payments', 'activities', 'promise_events', 'promises', 'purchase_claims')
             and r.rolname = 'authenticated'
             and a.privilege_type in ('DELETE', 'INSERT', 'UPDATE')), '{}'::text[],
    'a browser role still holds no table DML on any guarded history table — history cannot be '
    || 'deleted directly no matter what a session sets (profiles is excluded on purpose: its '
    || 'owner-side UPDATE grant is Stage 3''s measured exception)');

select is((select confdeltype from pg_constraint
           where conname = 'founder_audit_events_target_user_id_fkey'), 'r',
    'the RESTRICT edge from Founder audit to auth.users is untouched: review provenance was not '
    || 'loosened to make accounts deletable');

select is((select confdeltype from pg_constraint
           where conname = 'founder_audit_events_claim_id_fkey'), 'r',
    'and so is the RESTRICT edge from Founder audit to the claim it records');

select is((select confdeltype from pg_constraint
           where conname = 'activities_promise_id_fkey'), 'n',
    'the SET NULL edge from activities to promises is untouched — the purge avoids it by ordering '
    '(activities before promises), not by changing it');

-- ---------------------------------------------------------------------------
-- E. The RPC''s own body: refuse-when-entangled, derive-identity, and ordering.
-- ---------------------------------------------------------------------------
select ok((select position('founder_audit_events' in prosrc) > 0
             and position('target_user_id' in prosrc) > 0
             and position('c.owner_id = v_owner' in prosrc) > 0
           from pg_proc where oid = 'public.delete_my_account()'::regprocedure),
    'it checks BOTH Founder entanglements — review subject and owner of a reviewed claim — so neither '
    || 'RESTRICT edge can stop the purge halfway through (B19 refuses rather than erases)');

select ok((select position('founder_audit_events' in prosrc)
                 < position('app.dueweave_erasure_owner' in prosrc)
           from pg_proc where oid = 'public.delete_my_account()'::regprocedure),
    'and it checks them before arming the erasure context, so a refusal cannot be half-applied');

select ok((select position('auth.uid()' in prosrc) > 0
           from pg_proc where oid = 'public.delete_my_account()'::regprocedure),
    'and it derives the account from the verified token');

select ok((select position('app.dueweave_erasure_owner' in prosrc) > 0
             and position('delete from public.promise_events' in prosrc) > 0
           from pg_proc where oid = 'public.delete_my_account()'::regprocedure),
    'the context is armed by the RPC itself, and its first delete is the deepest child');

select ok((select position('delete from public.activities' in prosrc) > 0
             and position('delete from public.activities' in prosrc)
                 < position('delete from public.promises' in prosrc)
           from pg_proc where oid = 'public.delete_my_account()'::regprocedure),
    'activities go before promises, so removing a promise never issues a SET NULL update on history');

select ok((select position('delete from public.receivables' in prosrc) > 0
             and position('delete from public.receivables' in prosrc)
                 < position('delete from public.clients' in prosrc)
           from pg_proc where oid = 'public.delete_my_account()'::regprocedure),
    'receivables go before clients, for the same reason on the clients RESTRICT edge');

select ok((select position('delete from public.purchase_claims' in prosrc) > 0
             and position('delete from public.founder_admins' in prosrc) > 0
           from pg_proc where oid = 'public.delete_my_account()'::regprocedure),
    'claims and reviewer enrollment are both covered, so no orphaned owner row survives the purge');

select ok((select position('delete from public.profiles' in prosrc) > 0
             and position('delete from public.profiles' in prosrc)
                 > position('delete from public.clients' in prosrc)
           from pg_proc where oid = 'public.delete_my_account()'::regprocedure),
    'and the profile is removed last, after every guarded child of it is gone');

-- ---------------------------------------------------------------------------
-- F. The browser surface, counted.
--    The count is the point: 24 routines were the whole product surface through
--    Phase 3B, and a 25th is a deliberate capability added by this repair, with
--    its own proofs — not drift.
-- ---------------------------------------------------------------------------
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           cross join aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee
           where n.nspname = 'public' and a.privilege_type = 'EXECUTE'
             and r.rolname = 'authenticated'), 25::bigint,
    'authenticated can now execute 25 public routines: the 24 the application called, plus delete_my_account()');

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           cross join aclexplode(p.proacl) a
           where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 'anon'::regrole::oid),
          0::bigint,
          'and still nothing at all for anon');

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           cross join aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
           where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0), 0::bigint,
          'and nothing reachable through the PUBLIC pseudo-role');

select is((select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and t.tgenabled = 'O' and not t.tgisinternal), 21::bigint,
          'the user-trigger count is unchanged at 21 — the repair rewrote guard bodies, it did not add or remove triggers');
