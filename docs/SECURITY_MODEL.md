# Security model (as executed, not as intended)

Stage 9 PHASE 30, carried forward through Arc 3C. The catalog numbers below were measured on
2026-09-29 against the project's own disposable loopback Supabase (23 committed migrations replayed
from zero) by `pnpm exec supabase db query --local "<sql>"`, `pnpm test:db` (pgTAP) and
`pnpm test:live`. The chain now carries **25** committed migrations: `20261004170000_current_arc2_ledger_required_blank_class.sql`
and `20261006120000_current_arc3c_account_erasure_path.sql`. Nothing in Arc 3C's migration has been
replayed — the Docker daemon on this machine answers neither the host nor WSL, so the replay, pgTAP
and live gates did not run. Anything sourced rather than measured is marked
**(source, not yet measured)**, and `docs/ACCOUNT_ERASURE_DESIGN.md` keeps the full list of blocked
gates. Where a claim could be executed it was; the test citations are the same ones
`docs/SECURITY_CONTRACT_REQUALIFICATION.md` pins, and `tests/security-contract.test.ts` fails the
release if that map drifts. None of the figures in this section were run against a hosted project;
the hosted re-measurement Phase 3B performed is recorded in `docs/CONSUMER_LIVE_PROGRESS.md`.

## Measured shape of the database

| Fact | Measured |
| --- | --- |
| Public tables | 13, and **13 have `relrowsecurity = true`** |
| Row-level-security policies | 15, spread over the 10 browser-visible tables |
| Functions granted `EXECUTE` to `anon` | **0** |
| Functions granted `EXECUTE` to `authenticated` | 24 measured (the whole browser RPC surface, listed below); **25** once the Arc 3C migration replays, the extra one being `delete_my_account()` **(source, not yet measured)** |
| Functions executable by the `PUBLIC` pseudo-role | **0** |
| `SECURITY DEFINER` functions / `SECURITY INVOKER` functions | 28 / 21 measured; 29 / 22 with the erasure path — `delete_my_account()` is definer, `erasure_allows_delete(uuid)` is invoker so that `current_user` stays the caller's real role **(source, not yet measured)** |
| User triggers on public tables | 21 |
| Event triggers | 7 — 6 Supabase-managed, 1 written here (`stage3_default_privileges_fail_closed`) |
| Tables with **no** browser-role grant at all | `founder_admins`, `founder_audit_events`, `founder_offer_config` |

Re-measure with:

```sql
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policies p where p.tablename = c.relname and p.schemaname = 'public') as policies,
       (select string_agg(distinct r.rolname, ',')
          from aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee
         where r.rolname in ('anon','authenticated')) as browser_grants
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by c.relname;

select r.rolname, count(*) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace, aclexplode(p.proacl) a
  join pg_roles r on r.oid = a.grantee
 where n.nspname = 'public' and a.privilege_type = 'EXECUTE'
   and r.rolname in ('anon','authenticated','public') group by r.rolname;
```

## Auth boundary

Authentication is Supabase Auth (email/password) and nothing else: the browser holds only
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` plus its own session token, and every authorized
database access is decided from `auth.uid()` inside Postgres. There is no Node server, no tRPC
layer, no proxy holding a privileged key, and no browser code path that can name a role — the
PostgREST role comes from the JWT, not from the client.

Arc 3C adds the first server-side component the repository has ever had, and it is source that has
not been deployed: `supabase/functions/delete-account/`. It is the only place a privileged key
appears at all, it uses that key for exactly one call (`auth.admin.deleteUser`, on the id GoTrue
just confirmed for the caller), it accepts no target user id from the browser, and the ledger purge
it triggers runs on the caller's own token so `auth.uid()` stays truthful inside it. The whole
threat model, the four conditions the guards require, and the deploy runbook are in
`docs/ACCOUNT_ERASURE_DESIGN.md`. Everything else in the app still reaches Postgres through the
caller's JWT and nothing else.

That boundary is executed, not argued: `e2e/stage9-release-journey.spec.ts:210` and `:452` complete
sign-up, onboarding, the whole money lifecycle, an export and a Founder claim, then a profile edit
surviving sign-out and sign-back-in, with only the anon key present — a `service_role` dependency
would fail the run. `scripts/local-stack-check.mjs` requires the same two values and no privileged
key, and refuses a non-loopback URL.

### Password posture

Three layers touch a password, and they do not enforce the same thing:

| Layer | Enforces | Measured |
| --- | --- | --- |
| DueWeave's own sign-up and password-change forms | at least `PASSWORD_MIN_LENGTH = 8` characters | executed — `client/src/lib/auth-validation.test.ts`, 9 tests: the floor refuses 7 and accepts 8, the recovery form carries the same floor, sign-in is deliberately not length-gated, and a refusal names the rule without echoing the password |
| Hosted Supabase Auth | `password_min_length = 6` | read on 2026-10-06 from `GET /v1/projects/…/config/auth`, keys allowlisted so no credential field was printed; raising it to 8 is a **production Auth configuration action**, deliberately not performed here |
| Hosted Supabase Auth | leaked-password (HIBP) protection: `password_hibp_enabled = false` | same read. Phase 3B's advisor capture carried the matching `auth_leaked_password_protection` WARN. Turning it on is an owner decision about the plan, and this phase was instructed to spend nothing and write nothing — so it is recorded as an **accepted limitation**, not a repair |

The reason the application owns the rule rather than trusting the server: the hosted floor is 6, and
this repository cannot raise it without a production configuration write. So an eight-character
password is guaranteed for accounts created through DueWeave's forms — which is every account today.
Sign-in is not length-gated, on purpose: a person who set a shorter password before the floor existed
must still be able to open their ledger. The form runs with `noValidate`, so the refusal is DueWeave's
own and not the browser's, and a server-side password refusal is mapped through `friendlyAuthError`
to the same sentence rather than shown verbatim.

## `owner_id` isolation and RLS

Every business row carries `owner_id`, and the ten browser-visible tables are reachable by
`authenticated` with policies that filter on the owner. `anon` holds no table privilege and no
function privilege, so an unauthenticated request reads nothing
(`tests/stage3-local-rls.test.ts:1737`, "the anonymous role gets nothing from").

Cross-account behaviour is proved with two real accounts, per table, per verb:
read (`:572`), update (`:709`), the silent-success case where the API reports no error and the row is
re-read to prove nothing changed (`:744`), delete (`:769`), foreign-key insertion
(`:895`), reparenting a receivable onto another owner's client through the table (`:989`) and
through the workflow RPCs (`:1009`). Over the browser plus direct REST, `e2e/stage9-account-isolation.spec.ts:432`
runs 8 attacks and reads the other account's identifiers as nothing, table by table.

`profiles` is the narrow exception on purpose: the owner may write only `display_name` and
`business_name`; writes aimed at `id`, `plan`, `timezone` or `currency` are refused by the database
(`tests/stage6-local-profile.test.ts`), and views never query that table outside the owner policy.

## The `SECURITY DEFINER` RPC model

24 functions are callable from a browser session — 25 once the Arc 3C migration replays, the 25th
being `delete_my_account()`; that set is the entire product surface:

```
create_client            update_client                create_receivable       update_receivable_details
create_client_and_receivable                          record_payment         create_promise
cancel_promise           cancel_receivable             record_contacted       snooze_receivable
mark_due_promises_broken get_founder_offer             get_founder_funnel     create_founder_claim
submit_founder_payment   list_pending_founder_claims   list_rejected_founder_claims
approve_founder_claim    reject_founder_claim          reconsider_founder_claim
cancel_founder_claim     revoke_founder_entitlement    record_founder_upgrade_view
delete_my_account   (takes no argument; erases only the caller's own rows — see docs/ACCOUNT_ERASURE_DESIGN.md)
```

Definer functions exist so a write can check more than a policy can express (an ownership join,
the Free-plan active-receivable limit, a seat cap, an allowlist) while the caller still holds no
table privilege beyond `EXECUTE`. Each is `security definer` with a pinned `search_path`, executes as
its owner, and re-checks the caller inside the function; the invoker-side half of the surface (21
functions, including the views the app reads through) never escalates.

Two consequences of that split are measured rather than assumed:

- **Reviewer privileges do not become ledger privileges.** `approve_founder_claim` and friends are
  granted to `authenticated` — the authority check is the `founder_admins` allowlist *inside* the
  function. A signed-in non-admin calling it is refused (`tests/stage3-local-rls.test.ts:1383`), and
  an enrolled reviewer that runs the review RPCs still reads no other account's rows (`:1560`).
- **Internal Founder machinery is not browser-executable.** `founder_admins`, `founder_audit_events`
  and `founder_offer_config` carry **no** browser-role entry in their ACL at all (measured above),
  the internal helpers are not callable over `/rpc` (`tests/stage3-local-rls.test.ts:602, :1859,
  :1880`), and `get_founder_offer()` has `REVOKE ... FROM public` pinned in pgTAP
  (`supabase/tests/stage3_02_privileges.sql`).

## Default privileges stay fail-closed

`20260814150000_current_stage3_default_privileges_fail_closed.sql` plus
`20260814160000_current_stage3_routine_hardening.sql` install an event trigger that repairs the
privileges of objects created *after* the migration, so a future migration cannot accidentally open
the schema to a browser role or to `PUBLIC`.

The proof is not the recorded `pg_default_acl` — it is the ACL a real new object actually carries.
`supabase/tests/stage3_02_privileges.sql:184, :261, :265` create a probe table, sequence and
function with no `GRANT` statement at all and assert that `anon`, `authenticated` and `PUBLIC` hold
nothing on them, while `postgres` and `service_role` still work — closed, not broken. This is the
section that caught D11 (PostgreSQL's implicit `PUBLIC EXECUTE` on new functions survives
`ALTER DEFAULT PRIVILEGES ... REVOKE`) and D12 (revoking `FUNCTION` syntax on a *procedure* raises
42809 and aborts the migration that created it). Explicit opt-in still works: a later migration can
`GRANT`, and that grant is what the tests then require.

## Money authority

Money is integer paise end to end (`bigint`), and the database is the authority for what is
outstanding: `record_payment` / `create_promise` validate the amount, the date and the state
transition, and the remaining balance is derived rather than stored as a claim. Writes that move
money take a `p_request_id` and are idempotent at the database level, so a double-click or a retry
cannot double-book a payment (`tests/stage5-local-lifecycle.test.ts`, races in
`docs/STAGE9_ABUSE_MATRIX.md`). The business calendar is pinned to `Asia/Kolkata`; a promise's
attribution follows its own chronology (`promise_events` provenance), and no client-side clock or
client-side total is trusted.

## Immutable history

`promises` never overwrite: a renegotiation appends, and corrections keep their provenance. History
rows are immutable against their own owner too — `tests/stage3-local-rls.test.ts:1662`, "the owner
cannot rewrite or destroy its own" — and the lifecycle triggers (21 user triggers, measured above)
reject state transitions the model does not allow rather than silently coercing them. Founder review
decisions land in `founder_audit_events`, a table no browser role can read or write directly.

The one exception is erasure, and it is narrow by construction **(source, not yet measured)**. Arc
3C's migration does not weaken these guards; it gives each of them a DELETE branch that consults a
single internal function, `erasure_allows_delete(uuid)`, which returns true only when the statement
is a DELETE (an UPDATE — including the SET NULL update a cascade would generate — is refused
unconditionally), the transaction-local context `app.dueweave_erasure_owner` names **this row's own**
owner, `auth.uid()` is that same account, and `current_user` is `postgres`. The context helper is
`SECURITY INVOKER` so the fourth condition reads the caller's real role, and it is revoked from
`public`, `anon`, `authenticated` **and** `service_role`, so no session can call it directly. The only
browser-reachable path through it is `delete_my_account()`, which takes no argument and deletes in
explicit child-first order. `delete_my_business_data()` stays revoked exactly where Stage 2 left it.
An account that appears in the Founder review ledger is refused before the context is armed (B19).
Full design, threat model and the blocked gates: `docs/ACCOUNT_ERASURE_DESIGN.md`.

## Export privacy

Exports are generated in the owner's browser from rows the owner is already allowed to read, and are
saved by the browser's download mechanism; nothing is uploaded, queued or stored server-side, and
there is no import path. The executed proofs are
`e2e/stage7-local-export.spec.ts:334` ("the ledger never lands in web storage", which dumps both
storages and fails on any needle from the ledger),
`tests/stage7-data-export.unit.test.ts:170` ("carries no credential, token or server-side secret in
the archive"), and `e2e/stage7-local-export.spec.ts` reading the bytes Chromium actually saved to
prove a second account's data cannot appear in the first account's file. The CSV writer neutralises
formula injection, escapes quotes/newlines, keeps UTF-8, and the JSON envelope is versioned.

## Browser credential boundary

No privileged credential exists in the client, the source tree or the shipped bundle. Three
mechanisms hold that line: `tests/credential-boundary.contract.test.ts` and
`tests/production-module-graph.contract.test.ts` over the built `dist/`, and
`pnpm verify:secrets` (`scripts/verify-secrets.mjs`), which scans 11 credential shapes
(`service_role` JWTs, `sb_secret_`, Supabase service keys, database URLs/passwords, UPI/payment
secrets, private keys, generic assignment shapes) across the tracked tree **and** `dist/` — re-run
2026-10-06 at **241 files**, no finding. Its allowlist is dead-exemption-proof: an allowlisted path
that no longer matches a finding fails the scan, so the exception list cannot rot, and the `HARD`
shapes cannot be allowlisted away at all. The scanner reports shape names and file locations, never a
key value.

Two Arc 3C notes on that scan, because the new Edge Function is the first server-side secret this
repository has had to keep out of a bundle. `supabase/functions/` is not tracked yet, so the 241
count above does not include it; the directory was scanned on its own with
`node scripts/verify-secrets.mjs --dir supabase/functions` — 3 files, no finding — and it will join
the tracked count when the phase is committed. The function's key is only ever an environment value:
`SUPABASE_SERVICE_ROLE_KEY` is read with `Deno.env.get` in `index.ts`, `supabase/functions/.env` is
ignored by the `.env` rule at `.gitignore:11` (verified with `git check-ignore`), and only
`supabase/functions/.env.example` is checked in. The client bundle cannot gain a privileged key
through this path because the browser calls the function through the caller's own session —
`client/src/data/supabase-account-deletion-repository.ts` sends one field and sets no bearer.

## Known gaps that are hosted-only, and therefore not claimed

| Gap | Why this repository cannot close it |
| --- | --- |
| Signup email confirmation and real password-recovery delivery | `supabase/config.toml` disables signup confirmation for the local stack; the recovery journey reads the local Inbucket inbox. A hosted SMTP provider, Site URL and redirect allow-list are Stage 10 configuration. |
| Hosted project's own default privileges and role grants | Row-by-row fail-closed is proved for **this** migration role on the loopback stack; a hosted project may carry pre-grants of its own and must be re-measured after creation. |
| Real UPI/VPA settlement | Founder readiness is proved in `TEST`/fail-closed mode against a `PLACEHOLDER` offer; no live destination, gateway credential or bank reconciliation is exercised. See `docs/FOUNDER_LIVE_ACTIVATION_CHECKLIST.md`. |
| WhatsApp handoff delivery | Only the built URL and the "no contact is recorded without explicit confirmation" rule are proved; the send happens outside DueWeave and cannot be observed. |
| Transport/infra hardening (WAF, rate limits, backups, secret rotation, log retention) | Hosting properties, not repository properties. |
| Accessibility conformance | Stage 6's targeted keyboard/screen-reader/reduced-motion qualification is retained (`e2e/stage6-local-accessibility.spec.ts`); it is not a WCAG certification. |
| Leaked-password protection on the hosted project | Measured off: `password_hibp_enabled = false` (read 2026-10-06). It is a project-level Auth configuration write, and enabling it is an owner decision about the plan; this phase was instructed to spend nothing and write nothing hosted. The application-side eight-character floor is what this repository can enforce — see *Password posture*. |
| Erasure of a Founder-entangled account (B19) | The purge refuses an account named in `founder_audit_events` because two RESTRICT edges protect review provenance. Erasing it would mean deleting reviewer evidence Stage 8 made immutable, which is a product decision about the review ledger, not a detail of this repair. |
| The Arc 3C gates themselves | `20261006120000_current_arc3c_account_erasure_path.sql` and `supabase/functions/delete-account/` have never executed: the machine's Docker daemon answers neither from the host nor from WSL, so replay, pgTAP, the live suites and every browser gate are open. `docs/ACCOUNT_ERASURE_DESIGN.md` keeps the list, and B17's verdict is **NOT READY** until it closes. |

## Reproducing

```sh
pnpm db:reset:local && pnpm verify:migrations   # 25 migrations, replayed from zero
pnpm test:db                                   # pgTAP: 9 files / 364 assertions measured at 8 files on 2026-09-29
pnpm test:live                                 # ten database suites incl. the abuse matrix and the erasure suite
pnpm test:e2e:smoke                            # the two-account and credential-boundary journeys
pnpm verify:secrets                            # 11 shapes over the tree and dist/
node scripts/local-stack-check.mjs             # the run needs no privileged key
```

The first four of those, plus `local-stack-check.mjs`, need Docker and did **not** run for Arc 3C: the
daemon on this machine timed out on `docker version`, `docker ps` and the equivalent calls through
WSL, so the 25th migration, the 9th pgTAP file (`supabase/tests/arc3c_01_account_erasure.sql`) and the
10th database suite (`tests/arc3c-local-account-erasure.test.ts`) are written and classified, not
executed. `pnpm verify:secrets` needs no stack and ran green on 2026-10-06.
