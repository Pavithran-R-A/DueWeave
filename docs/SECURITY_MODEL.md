# Security model (as executed, not as intended)

Stage 9 PHASE 30. Every number here was measured on 2026-09-29 against the project's own
disposable loopback Supabase (23 committed migrations replayed from zero) by
`pnpm exec supabase db query --local "<sql>"`, `pnpm test:db` (pgTAP) and `pnpm test:live`.
Where a claim could be executed it was; the test citations are the same ones
`docs/SECURITY_CONTRACT_REQUALIFICATION.md` pins, and `tests/security-contract.test.ts` fails the
release if that map drifts. Nothing in this file was run against a hosted project.

## Measured shape of the database

| Fact | Measured |
| --- | --- |
| Public tables | 13, and **13 have `relrowsecurity = true`** |
| Row-level-security policies | 15, spread over the 10 browser-visible tables |
| Functions granted `EXECUTE` to `anon` | **0** |
| Functions granted `EXECUTE` to `authenticated` | 24 (the whole browser RPC surface, listed below) |
| Functions executable by the `PUBLIC` pseudo-role | **0** |
| `SECURITY DEFINER` functions / `SECURITY INVOKER` functions | 28 / 21 |
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

That boundary is executed, not argued: `e2e/stage9-release-journey.spec.ts:210` and `:452` complete
sign-up, onboarding, the whole money lifecycle, an export and a Founder claim, then a profile edit
surviving sign-out and sign-back-in, with only the anon key present — a `service_role` dependency
would fail the run. `scripts/local-stack-check.mjs` requires the same two values and no privileged
key, and refuses a non-loopback URL.

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

24 functions are callable from a browser session; that set is the entire product surface:

```
create_client            update_client                create_receivable       update_receivable_details
create_client_and_receivable                          record_payment         create_promise
cancel_promise           cancel_receivable             record_contacted       snooze_receivable
mark_due_promises_broken get_founder_offer             get_founder_funnel     create_founder_claim
submit_founder_payment   list_pending_founder_claims   list_rejected_founder_claims
approve_founder_claim    reject_founder_claim          reconsider_founder_claim
cancel_founder_claim     revoke_founder_entitlement    record_founder_upgrade_view
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
secrets, private keys, generic assignment shapes) across the tracked tree **and** `dist/` — measured
227 files (207 tracked + 20 bundle artefacts), no finding. Its allowlist is dead-exemption-proof: an
allowlisted path that no longer matches a finding fails the scan, so the exception list cannot rot,
and the `HARD` shapes cannot be allowlisted away at all. The scanner reports shape names and file
locations, never a key value.

## Known gaps that are hosted-only, and therefore not claimed

| Gap | Why this repository cannot close it |
| --- | --- |
| Signup email confirmation and real password-recovery delivery | `supabase/config.toml` disables signup confirmation for the local stack; the recovery journey reads the local Inbucket inbox. A hosted SMTP provider, Site URL and redirect allow-list are Stage 10 configuration. |
| Hosted project's own default privileges and role grants | Row-by-row fail-closed is proved for **this** migration role on the loopback stack; a hosted project may carry pre-grants of its own and must be re-measured after creation. |
| Real UPI/VPA settlement | Founder readiness is proved in `TEST`/fail-closed mode against a `PLACEHOLDER` offer; no live destination, gateway credential or bank reconciliation is exercised. See `docs/FOUNDER_LIVE_ACTIVATION_CHECKLIST.md`. |
| WhatsApp handoff delivery | Only the built URL and the "no contact is recorded without explicit confirmation" rule are proved; the send happens outside DueWeave and cannot be observed. |
| Transport/infra hardening (WAF, rate limits, backups, secret rotation, log retention) | Hosting properties, not repository properties. |
| Accessibility conformance | Stage 6's targeted keyboard/screen-reader/reduced-motion qualification is retained (`e2e/stage6-local-accessibility.spec.ts`); it is not a WCAG certification. |

## Reproducing

```sh
pnpm db:reset:local && pnpm verify:migrations   # 23 migrations, replayed from zero
pnpm test:db                                   # pgTAP: 8 files / 364 assertions (measured)
pnpm test:live                                 # nine database suites incl. the abuse matrix
pnpm test:e2e:smoke                            # the two-account and credential-boundary journeys
pnpm verify:secrets                            # 11 shapes over the tree and dist/
node scripts/local-stack-check.mjs             # the run needs no privileged key
```
