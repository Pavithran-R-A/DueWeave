# DUEWEAVE — CURRENT ROADMAP STAGE 3 — RLS / AUTHORIZATION / CROSS-TENANT ISOLATION

This report is the authoritative Stage 3 record. The historical `stage3_final_report.md` is
left untouched and is not evidence for this qualification.

STATUS: COMPLETE — Phases 0–26 executed, plus one independent-review repair round (defects D10 and D11)
recorded in "FINAL REVIEW & REPAIR". Verdict in "PHASE 25–26 — VERDICT", gate outputs in
"PHASE 23–24" (pre-repair) and "FINAL REVIEW & REPAIR" (post-repair, authoritative).

STARTING SHA: `8e13dbc0b85cc5907eb1a0b77c660f33fb2557d1`
BRANCH: `current-stage-3-authorization` (created from the verified Stage 2 commit)

---

## PHASE 2 — EXECUTED AUTHORIZATION INVENTORY

Inventory source: the **live local Postgres catalog** of the `dueweave` Docker stack after a
from-zero `supabase db reset --local --yes` replaying all 13 committed migrations. Read with
`docker exec supabase_db_dueweave psql` (local administrative inspection only; no hosted
project, no `supabase link`, no `db push`, no `--linked`).

Executed object census in `public`:

| relkind | meaning | count |
| --- | --- | --- |
| `r` | ordinary tables | 13 |
| `v` | views | **0** |
| `m` | materialized views | **0** |
| `S` | sequences | **0** |
| `i` | indexes | 33 |
| — | partitioned / foreign / toast relations | 0 |
| — | row-security policies | 15 |
| — | functions | 36 |
| — | triggers | 20 |
| — | non-internal publications | 1 (0 published tables) |

**Explicit statement required by the brief:** there are **no views and no materialized views
in `public`**, so the "views can bypass RLS" risk has no instance in this schema. There are
also **no sequences** — every primary key is a `uuid` default, so no sequence is reachable to
`anon`/`authenticated`. The single publication (`supabase_realtime`) publishes **zero**
tables, so Realtime is not an anonymous read path.

### 2.1 Per-table executed posture

`anon` / `auth` columns show the executed `relacl` entry. ACL letters are
`a`INSERT `r`SELECT `w`UPDATE `d`DELETE `D`TRUNCATE `x`REFERENCES `t`TRIGGER `m`MAINTAIN.

| table | RLS | FORCE | anon grant | authenticated grant | policies | ownership key |
| --- | --- | --- | --- | --- | --- | --- |
| `profiles` | ON | off | `arwdDxtm` (all) | `arwdDxtm` (all) | 3 (S/U/D) | `id` = auth uid |
| `clients` | ON | off | `arwdDxtm` (all) | `arwdDxtm` (all) | 1 (`FOR ALL`) | `owner_id` |
| `receivables` | ON | off | `arwdDxtm` (all) | `arwdDxtm` (all) | 2 (S/U) | `owner_id` |
| `promises` | ON | off | `arwdDxtm` (all) | `arwdDxtm` (all) | 1 (S) | `owner_id` |
| `payments` | ON | off | `arwdDxtm` (all) | `arwdDxtm` (all) | 1 (S) | `owner_id` |
| `activities` | ON | off | `arwdDxtm` (all) | `arwdDxtm` (all) | 2 (S/I) | `owner_id` |
| `promise_events` | ON | off | `arwdDxtm` (all) | `arwdDxtm` (all) | 1 (S) | `owner_id` |
| `entitlements` | ON | off | `arwdDxtm` (all) | `rDxt` (SELECT + admin only) | 1 (S) | `user_id` |
| `purchase_claims` | ON | off | `arwdDxtm` (all) | `rDxt` (SELECT + admin only) | 1 (S) | `owner_id` |
| `analytics_events` | ON | off | `arwdDxtm` (all) | `rDxt` (SELECT + admin only) | 2 (S/I) | `owner_id` |
| `founder_admins` | ON | off | **none** | **none** | 0 | `user_id` |
| `founder_audit_events` | ON | off | **none** | **none** | 0 | n/a (audit) |
| `founder_offer_config` | ON | off | **none** | **none** | 0 | n/a (server config) |

All 13 tables are RLS-enabled; **none** is `FORCE ROW LEVEL SECURITY` — see §4.3 for why that
is deliberate and load-bearing rather than an oversight.

### 2.2 Every executed policy

All 15 policies are PERMISSIVE, and every one is attached to `polroles = {0}`, i.e. the
implicit **PUBLIC pseudo-role**, not to a named role. `0 of 15` policies name an actual role.

| table | policy | cmd | USING | WITH CHECK |
| --- | --- | --- | --- | --- |
| `profiles` | `profiles_select_own` | SELECT | `id = auth.uid()` | — |
| `profiles` | `profiles_update_own` | UPDATE | `id = auth.uid()` | `id = auth.uid()` |
| `profiles` | `profiles_delete_own` | DELETE | `id = auth.uid()` | — |
| `clients` | `clients_owner_all` | ALL | `owner_id = auth.uid()` | `owner_id = auth.uid()` |
| `receivables` | `receivables_select_own` | SELECT | `owner_id = auth.uid()` | — |
| `receivables` | `receivables_update_own` | UPDATE | `owner_id = auth.uid()` | `owner_id = auth.uid()` |
| `promises` | `promises_select_own` | SELECT | `owner_id = auth.uid()` | — |
| `payments` | `payments_select_own` | SELECT | `owner_id = auth.uid()` | — |
| `activities` | `activities_select_own` | SELECT | `owner_id = auth.uid()` | — |
| `activities` | `activities_insert_own` | INSERT | — | `owner_id = auth.uid()` |
| `promise_events` | `promise_events_select_own` | SELECT | `owner_id = auth.uid()` | — |
| `entitlements` | `entitlements_select_own` | SELECT | `user_id = auth.uid()` | — |
| `purchase_claims` | `purchase_claims_select_own` | SELECT | `owner_id = auth.uid()` | — |
| `analytics_events` | `analytics_owner_select` | SELECT | `owner_id = auth.uid()` | — |
| `analytics_events` | `analytics_owner_insert` | INSERT | — | `owner_id = auth.uid()` |

Every write policy supplies a `WITH CHECK`; **no write policy is missing one**.

---

## PHASE 4 — AUTHORIZATION DESIGN MATRIX

This matrix is the specification the Stage 3 test suites encode. It was written from the
executed inventory and the actual application architecture **before** any test was written.

The architecture fact that drives it: **the browser performs zero direct table writes.**
`grep` over `client/src` finds no `.insert(`, `.update(` or `.delete(` call at all; every
mutation goes through a `SECURITY DEFINER` workflow RPC that derives identity from
`auth.uid()`. Direct table access is therefore read-only by design, and "every owner gets
CRUD" would be the wrong target.

### 4.1 Private, tenant-readable tables

Legend: `S`elect / `I`nsert / `U`pdate / `D`elete. `deny` = must fail or affect zero rows;
`own` = succeeds only for the owner's own row.

| table | ANON S/I/U/D | USER A (owner) S | A insert | A update | A delete | USER B non-owner S/I/U/D |
| --- | --- | --- | --- | --- | --- | --- |
| `profiles` | deny / deny / deny / deny | own row only | deny (no INSERT policy; row is created by the Auth trigger) | own row, except `id` and `plan` (immutable by trigger) | own row only | deny across the board |
| `clients` | deny ×4 | own | own (`owner_id` forced to `auth.uid()` by WITH CHECK) | own; `owner_id` reassignment denied | own and empty of receivables (FK `RESTRICT`) | deny across the board |
| `receivables` | deny ×4 | own | **deny for every role — creation is `create_receivable` RPC only** | own non-financial columns only; `owner_id`/`client_id`/`amount_due_paise`/`outstanding_paise`/`status` require the payment workflow context | deny (no DELETE policy — receivables are closed by workflow, not deleted) | deny across the board |
| `promises` | deny ×4 | own | deny (creation is `create_promise` RPC only) | deny (history guard + no UPDATE policy) | deny | deny across the board |
| `payments` | deny ×4 | own | deny (creation is `record_payment` RPC only) | **deny even for the owner** (`payments_immutable`) | **deny even for the owner** | deny across the board |
| `activities` | deny ×4 | own | own (`WITH CHECK owner_id = auth.uid()`) | deny even for the owner (`activities_immutable`) | deny even for the owner | deny across the board |
| `promise_events` | deny ×4 | own | deny for direct callers (workflow-only provenance) | deny | deny | deny across the board |
| `entitlements` | deny ×4 | own (read) | deny (grant is `approve_founder_claim` only) | deny (`tier`/`plan`/`source` never user-mutable) | deny | deny across the board |
| `purchase_claims` | deny ×4 | own (read) | deny directly — needs the `CREATE` claim context set only inside `create_founder_claim` | deny directly — needs `SUBMIT`/`CANCEL`/`ADMIN` claim context | deny (`claim history is immutable`) | deny across the board |
| `analytics_events` | deny ×4 | own | own (`WITH CHECK owner_id = auth.uid()`) | deny | deny | deny across the board |

### 4.2 Admin / server-controlled tables

Ordinary browser principals must have **no** table path at all; these are already grant-free
and policy-free, and Stage 3 pins that state with pgTAP so a future migration cannot silently
reopen it.

| table | ANON | USER A / USER B | intended reach |
| --- | --- | --- | --- |
| `founder_admins` | deny | deny (no SELECT, no INSERT) | membership changes only through a reviewed server-side workflow; **there is deliberately no RPC that adds an admin**, so no browser path can self-promote |
| `founder_audit_events` | deny | deny | written only by `SECURITY DEFINER` monetization workflows |
| `founder_offer_config` | deny | deny | read only through the narrow `get_founder_offer()` projection; never read from the base table |

`get_founder_offer()` must return exactly its declared projection and must **not** imply any
`founder_offer_config` table privilege; Phase 8 proves the RPC works while the table stays
unreadable for the same caller.

### 4.3 Two deliberately-retained deviations, with reasons

1. **`FORCE ROW LEVEL SECURITY` stays off — and, as measured, would buy nothing.** This
   justification was *written down before it was tested, then disproved by running it*, so the
   executed result replaces the hypothesis rather than being reconciled with it. The original
   claim was that forcing RLS would break `insert into activities` inside `create_client` and
   `insert into profiles` inside `handle_new_user`. Executed (§ Phase 23 experiment log): with
   FORCE switched **on** for `profiles`, `entitlements`, `clients` and `activities`, signup,
   profile reads and `create_client` all kept working, and an owner-role
   `update public.entitlements set plan = plan` reported `UPDATE 7` even though `entitlements`
   has **no UPDATE policy at all**. The reason is in `pg_roles`: every private table is owned
   by `postgres`, which holds `rolbypassrls = t`, and Postgres honours a BYPASSRLS membership
   *over* FORCE ROW LEVEL SECURITY. FORCE is therefore inert on the owner path in this schema,
   and the protection it appears to add would be a comment, not a boundary. The retained reason
   for keeping it off is the first half of the original argument — the `SECURITY DEFINER`
   workflows run as the owner and deliberately write provenance and status transitions the
   browser may not — but it is no longer supported by a claim of breakage. Both facts are now
   pinned by pgTAP (§ Phase 6, section F) so the deviation cannot rot silently.
2. **No policy is narrowed by adding `TO authenticated` alone.** Making the tenant policies
   explicitly `TO authenticated` is a real improvement (it removes the PUBLIC pseudo-role)
   but it is behaviour-preserving only because no `anon` request can ever satisfy
   `owner_id = auth.uid()`. It is therefore paired with actual grant removal rather than
   relying on the policy rewrite.

### 4.4 Workflow invariants the matrix depends on

- `create_client`, `create_receivable`, `create_promise`, `record_payment`, `record_contacted`,
  `snooze_receivable`, `mark_due_promises_broken`: all declare `v_owner uuid := auth.uid()`,
  all raise `'Authentication is required'` when it is null, and all parent lookups are
  `where id = p_x_id and owner_id = v_owner`. **No creation RPC accepts an owner id argument**
  (`revoke_founder_entitlement(p_user_id, …)` is the sole exception and is admin-guarded).
- Independent second line of defence in `SECURITY INVOKER` triggers: `assert_owned_client`,
  `assert_owned_receivable`, `assert_activity_ownership`, `assert_promise_event_ownership`
  compare `new.owner_id` against the parent row's owner, so even a policy mistake cannot attach
  a child to another tenant's parent.
- Free-plan ceiling `enforce_free_receivable_limit` takes a per-owner advisory lock and raises
  at 3 active receivables, so a tenant cannot use volume to widen an attack surface.

---

## PHASE 3 — EXECUTED FUNCTION / RPC CLASSIFICATION

Read from the live catalog after the from-zero replay (`pg_proc` joined to `pg_roles` and
`has_function_privilege()` for `anon` / `authenticated`), not from migration text. 36 functions
in `public`: **24 `SECURITY DEFINER`, 12 `SECURITY INVOKER`**. Every one of the 36 is owned by
`postgres`. After the Stage 3 privilege migration, **`anon` holds EXECUTE on zero of the 36**;
`authenticated` holds EXECUTE on exactly 20 — the 20 browser-callable workflow / founder
routines — and on none of the 12 trigger guards.

### 3.1 The 24 `SECURITY DEFINER` routines, with disposition

"All 24 keep owner `postgres`, a pinned `search_path`, and an unchanged body except where the
'Stage 3 change' column says otherwise." `auth_exec` is the post-migration state.

| routine | auth_exec | identity anchor | Stage 3 change |
| --- | --- | --- | --- |
| `create_client` | t | `v_owner := auth.uid()`, raises `Authentication is required` | EXECUTE narrowed from PUBLIC/anon to `authenticated` only; body unchanged — it is the supported creation path and takes no owner argument |
| `create_receivable` | t | same | EXECUTE narrowed; body unchanged — owner lookup `where id = p_client_id and owner_id = v_owner` |
| `create_client_and_receivable` | t | transitive: calls `create_client()` then `create_receivable()`, each resolving `auth.uid()` itself | EXECUTE narrowed; body unchanged — it never touches a table directly, so the composite inherits both owner checks |
| `create_promise` | t | same | EXECUTE narrowed; body unchanged |
| `record_payment` | t | same | EXECUTE narrowed; body unchanged |
| `record_contacted` | t | same | EXECUTE narrowed; body unchanged |
| `snooze_receivable` | t | same | EXECUTE narrowed; body unchanged |
| `mark_due_promises_broken` | t | `v_owner := auth.uid()`, sweep is `where owner_id = v_owner` | EXECUTE narrowed; body unchanged — no argument can widen the sweep |
| `create_founder_claim` | t | same | EXECUTE narrowed from PUBLIC/anon to `authenticated`; body unchanged |
| `submit_founder_payment` | t | same | EXECUTE narrowed; body unchanged |
| `cancel_founder_claim` | t | same | EXECUTE narrowed; body unchanged |
| `record_founder_upgrade_view` | t | same | EXECUTE narrowed; body unchanged |
| `get_founder_offer` | t | none needed — projects `founder_offer_config`, no tenant row | EXECUTE narrowed from PUBLIC/anon to `authenticated`; body unchanged; Phase 8 proves the RPC works while the base table stays unreadable for the same caller |
| `approve_founder_claim` | t | `perform public.assert_founder_admin()` first | EXECUTE narrowed from PUBLIC/anon to `authenticated`; body unchanged — the admin gate is inside, and Phase 14 shows a non-admin is refused |
| `reject_founder_claim` | t | same | EXECUTE narrowed; body unchanged |
| `reconsider_founder_claim` | t | same | EXECUTE narrowed; body unchanged |
| `revoke_founder_entitlement` | t | same; the only routine taking a `p_user_id` | EXECUTE narrowed; body unchanged — admin-guarded, so the cross-tenant parameter is reachable only by a reviewer (§4.2) |
| `list_pending_founder_claims` | t | `assert_founder_admin()` | EXECUTE narrowed; body unchanged |
| `list_rejected_founder_claims` | t | `assert_founder_admin()` | **D8 fix** — `owner_email` cast to `text`; EXECUTE narrowed. Signature, owner, security type and `search_path` unchanged, so generated types stay identical |
| `get_founder_funnel` | t | `assert_founder_admin()` | EXECUTE narrowed; body unchanged |
| `is_founder_admin` | **f** | `auth.uid()` vs `founder_admins` | EXECUTE revoked from PUBLIC / anon / `authenticated`; body unchanged — called internally, so PostgREST must not expose it |
| `assert_founder_admin` | **f** | raises unless `is_founder_admin()` | EXECUTE revoked; body unchanged — trigger-style internal guard |
| `handle_new_user` | **f** | `new.id` (Auth trigger row), so zero `auth.uid()` references by design | EXECUTE revoked; body unchanged — trigger firing is privilege-independent |
| `delete_my_business_data` | **f** | `v_owner := auth.uid()` | **stayed closed** — EXECUTE not granted to `authenticated`; Phase 18 audit below |

### 3.2 The 12 `SECURITY INVOKER` guards

`set_updated_at`, `assert_activity_ownership`, `assert_owned_client`, `assert_owned_receivable`,
`assert_promise_event_ownership`, `assert_stage3_client_input`, `enforce_free_receivable_limit`,
`guard_promise_history`, `guard_receivable_financial_fields`,
`prevent_direct_purchase_claim_change`, `prevent_immutable_history_changes`,
`prevent_profile_entitlement_change`.

Eleven of the twelve were found EXECUTE-granted to `public`/`anon` (defect D5) and are now
granted to nobody; `assert_stage3_client_input` had already been revoked by the historical
workflow migration, which is why it is absent from the D5 list. Post-migration,
`has_function_privilege('authenticated', …, 'EXECUTE')` is false for **every one of the 12**.
**Bodies left unchanged deliberately:** they are row triggers,
and Postgres fires a trigger without requiring the session role to hold EXECUTE on the function,
so revoking removes a callable REST surface (`/rpc/guard_promise_history`) while every guard
keeps firing exactly as before — verified by the Phase 15 immutability matrix, which is entirely
guard-driven and still refuses all 23 attempts after the revoke. Keeping them `SECURITY
INVOKER` is also load-bearing: a guard must evaluate the *invoker's* row, not the owner's.
Phase 14 confirms the removal is real from the browser's side — nine non-executable routines,
guards included, return `42501` when called as `authenticated`.

---

## PHASE 5 — FORWARD SECURITY MIGRATIONS

Four new migrations, applied forward-only on the local stack. No existing migration was edited,
renamed or removed, and applied history was not rewritten. The fourth landed in the repair round
documented at the end of this report.

| migration | class | what it changes |
| --- | --- | --- |
| `20260814120000_current_stage3_authorization_hardening.sql` | privileges / policy roles / one index | D1–D7: `TO authenticated` on all 15 policies; `revoke all` then `grant select` (10 tables) + `grant update` (`profiles` only) for `authenticated`, nothing for `anon`; EXECUTE revoked from `public`/`anon` on the founder surface and from everyone but the owner path on 13 internal guards; `alter default privileges … revoke … grant select` so D2–D5 cannot return with the next migration; `purchase_claims_owner_idx`. **The `grant select … to authenticated` half of that default-privileges line was itself defect D10 and is closed forward by `20260814150000`; this file was not edited** |
| `20260814130000_current_stage3_reviewer_queue_typing.sql` | availability defect | D8: casts `owner_email` in `list_rejected_founder_claims()` so the plpgsql tuple assignment matches the declared `text` column |
| `20260814140000_current_stage3_policy_initplan.sql` | policy evaluation strategy | D9: rewrites all 15 policies to `(select auth.uid())`, restating both `using` and `with check` on every policy that has them, plus one policy comment |
| `20260814150000_current_stage3_default_privileges_fail_closed.sql` | future-object privileges | D10: revokes every browser-role and PUBLIC default privilege the migration role installs on future `public` tables, sequences and functions. D11: a `ddl_command_end` event trigger strips the implicit PUBLIC EXECUTE that `ALTER DEFAULT PRIVILEGES` cannot remove from a newly created function |

Every statement is predicate-preserving: the same owner column is compared to the same
`auth.uid()` value. `supabase db reset --local --yes` replays all 17 migrations from zero (13
pre-existing + 4 Stage 3) with no errors and no manual repair step.

---

## PHASE 6 — pgTAP STRUCTURE SUITE (`supabase test db`)

Two files under `supabase/tests/`, run against the local stack with `pnpm test:db`. pgTAP is
installed into the `extensions` schema, so `public` and the generated client types are unchanged
by running the suite. **Result after the repair round: 93 of 93 assertions pass, 0 fail, 0 skip** —
32 in `stage3_01_rls_structure.sql` + 61 in `stage3_02_privileges.sql`. Before the repair the same
two files carried 71 (32 + 39); the privileges file was strengthened to 61 first, observed RED at
`Failed 9/61`, and only then made green by `20260814150000`.

`stage3_01_rls_structure.sql` pins: RLS on for all 13 tables and off for none; no `FORCE`
(any change becomes a reviewed decision); no views, materialized views or sequences in
`public`; the exact per-table policy name set (`policies_are`) so an extra policy fails the
suite; every policy naming exactly the `authenticated` role, permissive, anchored to
`auth.uid()`, and comparing **only** a documented owner column; every write policy carrying a
`WITH CHECK`; all 36 functions pinning `search_path` and resolving from `public` first; no
definer routine owned by a superuser or a browser role; every browser-executable writing definer
anchored to an owner check; and (section G) that every non-null `USING` / `WITH CHECK`
deparse to the hoisted `( SELECT auth.uid() AS uid)` form.

`stage3_02_privileges.sql` pins the grant surface: `anon` holds no table or function privilege
in `public`; `authenticated` holds `SELECT` on the ten tenant-readable tables and `UPDATE` on
`profiles` only; the three admin tables hold no grants for either browser role; the 16 internal
/trigger functions are not executable by `authenticated`; and (sections D–G, added in the repair
round) that a future `public` table, sequence or function installs **zero** automatic privilege for
`anon`, `authenticated` or the PUBLIC pseudo-role — checked both as a recorded default and as the
ACL of objects actually created during the test run, with a second created table proving that an
explicit `grant` plus an RLS policy still reaches exactly the policy's own rows, and a final
section proving the probes cleaned themselves up.

---

## DEFECT REGISTER — D1 … D11

Every entry below was **observed as a failing assertion or a live error before it was fixed**,
and the same attack was re-run afterwards. None was found only by reading migration text.

| id | class | executed symptom | fix | re-run evidence |
| --- | --- | --- | --- | --- |
| D1 | policy role | `pg_policy.polroles = {0}` for **15 of 15** policies — the PUBLIC pseudo-role | `alter policy … to authenticated` | pgTAP: `polroles <> array['authenticated'::regrole::oid]` count 0; live matrix unchanged in behaviour |
| D2 | grant | `anon` held `arwdDxtm` on all 10 application tables; isolation rested on RLS alone | `revoke all … from anon`, no re-grant | pgTAP asserts empty `anon` ACL; Phase 16: 71 anonymous probes, 71 refused, and the denial is now `42501` rather than an RLS-filtered empty set |
| D3 | grant | `authenticated` held INSERT/UPDATE/DELETE/TRUNCATE on the 7 owner-scoped tables though the browser writes only via RPC | `revoke all`, then `grant select` (10 tables) + `grant update` on `profiles` only | pgTAP ACL assertions; the 31 cross-update and 20 cross-delete probes still refuse, now for privilege *and* policy reasons |
| D4 | function privilege | **25 of 36** public functions were EXECUTE-granted to `anon`, including `approve_founder_claim()`, `revoke_founder_entitlement()` and every trigger guard — PostgREST exposes any executable public function as `/rpc/<name>` | revoke from `public`/`anon`, grant `authenticated` on the 20 browser-callable routines | Phase 13/14 anonymous and non-admin probes; pgTAP `has_function_privilege('anon', …)` count 0 |
| D5 | function privilege | the 11 trigger guards carried a PUBLIC EXECUTE entry | revoked from everyone but the owner path | Phase 15 immutability matrix unchanged at 23/23 refused — firing never depended on EXECUTE |
| D6 | future drift | `ALTER DEFAULT PRIVILEGES` for `postgres` re-granted `anon = arwdDxtm` on tables and `EXECUTE` on functions to every **future** object in `public`, so D2–D5 would silently return with the next migration | scoped `alter default privileges … revoke … / grant select … to authenticated` — **partial: it closed browser writes on future tables but opened a browser read, which is D10** | pgTAP inspects `pg_default_acl` directly |
| D7 | index / planning | `purchase_claims` had no owner-leading index; its only owner-scoped index is partial (`where status in ('DRAFT','PENDING_REVIEW')`), so an owner-filtered read plans as a sequential scan | `create index … (owner_id)` | performance advisor and `explain` review (§ Phase 21) |
| D8 | type / availability | live call through `authenticated` failed: `42804 structure of query does not match function result type — Returned type character varying(255) does not match expected type text in column 3`; a real reviewer could not open the rejected queue at all. Also the only error reported by `supabase db lint --local` | cast `owner_email` to `text` | that probe is now `accepted  a reviewer lists the rejected queue` + `unchanged  the rejected queue keeps its declared columns`; `db lint` reports **No schema errors found** |
| D9 | policy performance | `supabase db advisors --local --type performance` → **15 `auth_rls_initplan` WARN findings**; measured on a synthetic 20,005-row `clients` scan as an authenticated non-owner with index/bitmap scans off: `Seq Scan … Rows Removed by Filter: 20005`, **Execution Time 21.1–26.3 ms**, filter inlined as the raw `current_setting('request.jwt.claim.sub' …)::jsonb ->> 'sub'` expression tree | wrap in `(select auth.uid())`, restating `using` **and** `with check` | same plan after: **1.513 ms**, `InitPlan 1` and `Filter: (owner_id = (InitPlan 1).col1)`; performance advisor now **No issues found**; full 274-probe ledger totals identical before and after |
| D10 | future drift, read exposure | found by independent review of D6, then reproduced against the live catalog before any edit: `pg_default_acl` for (`postgres`, `public`, tables) resolved to `authenticated=r/postgres`, and `create table public.d10_red_probe_table (id bigint);` with **no GRANT at all** produced `has_table_privilege('authenticated', …, 'SELECT') = t`. So a future migration that forgets RLS, forgets a policy or forgets a revoke ships a table every signed-in account can read through the Data API | `20260814150000`: revoke all default table/sequence/function privileges from `public`, `anon`, `authenticated` for the migration role in `public` | strengthened pgTAP observed RED first (`Failed 9/61`, assertions 38, 40, 44, 46, 55 for D10); after the migration all 93 pass, the created-probe ACLs are empty of browser and PUBLIC entries, and sections A–C prove the 20 approved RPCs and the 10 tenant reads are untouched |
| D11 | future drift, anonymous RPC exposure | found *while* reproducing D10, and invisible to any `pg_default_acl` assertion: a function created by the migration role in `public` carries `proacl = {postgres=X/postgres, =X/postgres, service_role=X/postgres}` — the `=X` entry is PostgreSQL's **initial** PUBLIC EXECUTE, merged in *after* the recorded default ACL, and five supported `alter default privileges … revoke` forms were measured not to remove it (including revoking every grantee, which deletes the row and falls back to `acldefault()`, i.e. re-adds it). `anon` inherits from PUBLIC, so `has_function_privilege('anon', <new function>, 'EXECUTE') = t` and PostgREST publishes it as `/rpc/` | a narrow `ddl_command_end` event trigger, `stage3_default_privileges_fail_closed`, that revokes from `public, anon, authenticated` for `CREATE/ALTER FUNCTION/PROCEDURE` only in `public` and only when the executing role owns the new function — the one supported mechanism that can strip an initial privilege | pgTAP RED at assertions 49–52 (anon / authenticated / PUBLIC EXECUTE all `t`, probe ACL count 1) before the migration; all four green after, with 53–54 holding that `postgres` and `service_role` still execute the same function and 56–58 holding that an explicit later `grant execute` still works |

Three notes on process. D9 was written first as **failing pgTAP assertions** (section G observed RED
at 13 and 5 offending clauses) before the migration existed, per the test-first requirement, and the
same rule held for D10/D11: the assertions were strengthened against the 16-migration database, run,
and seen failing before `20260814150000` was written. D1's fix is documented in §4.3 item 2 as
behaviour-preserving only *because* it is paired with actual grant removal (D2/D3) — the policy
rewrite alone would not have narrowed anything. And D10 is a lesson recorded rather than hidden: the
D6 repair was accepted because its own assertion permitted `SELECT`, i.e. the test encoded the
assumption it was meant to check.

---

## PHASE 7–17 — LIVE TWO-USER AUTHORIZATION MATRIX

`tests/stage3-local-rls.test.ts` runs the browser path only: the published `anon` key plus real
JWTs from `auth.signUp`/`signInWithPassword` for User A, User B, a controlled local reviewer
fixture and an anonymous client. **No `service_role` key is used anywhere in the suite**, and the
one place a service credential would have been convenient — provisioning the reviewer fixture —
is done by a local administrative insert into `auth.users`/`public.profiles` followed by a
password sign-in, so the *assertions* still run as `authenticated`.

**Result: 110 of 110 tests pass, 0 failed, 0 skipped, recording 274 ledger probes.**

### 8.1 Ledger vocabulary

`refused` = the request came back with a security error (`42501 permission denied`, `P0001` with
a raised message, or an owner-check refusal). `unchanged` = the stored state was re-read and is
identical to before the attempt — required because an RLS-filtered `UPDATE`/`DELETE` returns HTTP
200 with an empty representation, so a "no error" response proves nothing on its own. `accepted`
= a legitimate owner action that must succeed (the non-vacuity control). `changed` = a private
row mutated by a principal that should not have been able to touch it.

**Totals: `{"probes":274,"refused":178,"accepted":17,"unchanged":79,"changed":0}`.**

### 8.2 Per-phase results

| phase | probes | refused | accepted | unchanged | changed | what it proves |
| --- | --- | --- | --- | --- | --- | --- |
| 7 legitimate owner + launch gate | 24 | 2 | 17 | 5 | 0 | owner paths work, so every denial below is not a blanket outage; `create_founder_claim` and `submit_founder_payment` are refused pre-launch |
| 8 read isolation | 15 | 14 | 0 | 1 | 0 | `select` from B against all 13 tables refused; reviewer holds no client rows of its own |
| 9 update isolation | 21 | 11 | 0 | 10 | 0 | B `update` refused on all 11 private tables and A's column value re-read as unchanged |
| 10 delete isolation | 20 | 10 | 0 | 10 | 0 | B `delete` refused; each victim row still present |
| 11 owner-id spoofing | 32 | 11 | 0 | 21 | 0 | `insert` attributing a row to the other tenant refused on every table, both victim and attacker row counts unchanged |
| 12 cross-parent FK | 9 | 5 | 0 | 4 | 0 | a child cannot be attached to another tenant's parent via RPC or direct insert, and no orphan row was created |
| 13 workflow RPC boundaries | 16 | 6 | 0 | 10 | 0 | `record_payment` / `create_promise` / `record_contacted` / `snooze_receivable` against B's receivable refused, and B's balance, status, label, payment and activity rows unchanged; A's overdue sweep left B's promise history untouched |
| 14 admin / founder escalation | 39 | 31 | 0 | 8 | 0 | all 7 admin RPCs refused for A and B; direct `founder_admins` read/insert and `founder_offer_config` update refused; `profiles.plan` and `entitlements` writes refused; A cannot approve its own claim and consumes no founder seat; the 9 internal/non-executable routines (incl. `delete_my_business_data`, `handle_new_user`, `set_updated_at`, 3 guards) return `42501` |
| 15 immutability | 23 | 15 | 0 | 8 | 0 | owner cannot update/delete own payments, activities, promise_events, promises, receivables, clients or claim amount; history survives |
| 16 anonymous surface | 71 | 71 | 0 | 0 | 0 | every private table read, write and RPC refuses without a user token — now at the privilege layer as well as row security |
| 17 session / token boundary | 4 | 2 | 0 | 2 | 0 | A's client is invisible under B's token; a raw REST call carrying A's identity but no user token, and one carrying only the anon key, are both refused |

Full per-probe labels are reproducible by rerunning `pnpm test:stage3`, which writes
`test-results/stage3-ledger.json`.

### 8.3 Negative control — proving the matrix is sensitive

With one deliberately widened policy in place (a permissive `using` clause on an owner-scoped
table, applied inside a transaction and rolled back), **7 live tests failed with a message naming
the leak**. The matrix therefore detects a real authorization mistake rather than passing because
nothing can ever fail. No denial assertion was weakened at any point to reach green.

---

## PHASE 18 — `delete_my_business_data` AUDIT

Executed through the browser role, not by inspection: as `authenticated` with a valid user JWT the
call is **refused, `42501 permission denied for function delete_my_business_data`**, and the
following stored-state probe (`unchanged  A's business data survives the attempt`) confirms zero
rows disappeared. The owner-side behaviour was then exercised directly: run as the table owner,
the routine deletes only the caller's own rows through cascading foreign keys. Disposition:
**left closed to browsers on purpose.** It is the one destructive routine in the schema, its
`authenticated` EXECUTE grant from the historical migration was removed during Phase 19, and no
screen in `client/src` calls it — so opening it would add a self-service data-loss path the
product does not offer. Stage 2's deletion story therefore stays a documented server-side
operation rather than a browser capability.

---

## PHASE 21 — PLAN, INDEX AND POLICY PERFORMANCE

Executed on the local stack as an `authenticated` principal with the JWT claims set by hand, so
planning sees the same policy predicates the app sees:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"<uuid>"}',true);
set local enable_indexscan = off;   set local enable_bitmapscan = off;
explain (analyze, buffers, costs off) select * from public.clients;
rollback;
```

- **D9 before:** `Seq Scan on clients … Rows Removed by Filter: 20005`, `Execution Time
  21.1–26.3 ms`, with the inlined settings-lookup/jsonb-arrow/uuid-cast tree repeated per row.
  A bare `auth.uid()` is a SQL-language function, so the planner inlines its body into the
  per-row filter.
- **D9 after:** the same query at **1.513 ms**, plan node `InitPlan 1` and
  `Filter: (owner_id = (InitPlan 1).col1)` — the request user is resolved once per statement.
  ~14–17× on this shape, and it stops scaling with rows scanned.
- **Indexes:** 34 measured in `pg_indexes`. Every owner-scoped table has an owner-leading index
  (`clients` 2, `purchase_claims` 6 after D7, `entitlements` 2 including `user_id`,
  `founder_admins` 1 on `user_id`, `profiles` 1 on `id`);
  `founder_offer_config` and `founder_audit_events` have no owner column by design and are read
  only behind admin-gated definers, so no per-tenant index is meaningful for them.
- **Advisors:** `supabase db advisors --local --type security` → **No issues found** (before the
  D-migrations it reported the PUBLIC-role policies and the anon write grants listed as D1–D6).
  `--type performance` → **No issues found**, down from **15** `auth_rls_initplan` WARN findings
  facing EXTERNAL.
- **`supabase db lint --local`** → **No schema errors found**, down from the single D8 `42804`
  error, which is why the lint gate is re-run in Phase 24 rather than assumed.
- The `FORCE ROW LEVEL SECURITY` question was settled by experiment, not assertion; see §4.3 and
  the Phase 23 log.

---

## PHASE 22 — BROWSER TWO-ACCOUNT ISOLATION E2E

`e2e/stage3-local-isolation.spec.ts`, gated behind `STAGE3_LOCAL_E2E=1` so CI is unaffected; run
with `pnpm test:e2e:stage3` against the local stack and the real UI. Two isolated Playwright
contexts sign up as separate accounts, and **each seeds a client and a receivable through the app
itself** (Add-receivable sheet, "New client" mode), so the private data under test was created by
the product path rather than inserted for it. **Result: 5 of 5 tests pass** (19.6 s on the second,
warm run; 1.3 m on the cold first pass).

1. each account's ledger shows exactly one `<article>` — the record it created;
2. the second account sees none of the first account's client name, invoice label or email on
   Today, Receivables or Clients, with a positive control in the same test proving each account
   *does* see its own row (so absence is not a broken selector);
3. the Add-receivable client picker cannot even *discover* the other tenant's client by name
   search — B's own option is present, then A's token returns "No matching client…" with
   `getByRole("option")` count 0;
4. the Founder review surface stays closed to both signed-in accounts: `<h1>Founder review is
   restricted.</h1>`, the server's denial message, and zero queue headings and zero `<article>`
   cards;
5. an unauthenticated browser cannot open `/` or `/admin/founder-claims` (both redirect to
   `/auth`), and signing out a third context closes it again.

Non-vacuity from the database side was checked after the run: the fixture owners each still own
their own client / receivable / activity rows that the other cannot see, so test 2's "count 0"
assertions are not observing an empty database.

---

## PHASE 23–24 — REPLAY FROM ZERO, EXPERIMENTS AND REGRESSION GATES

Two from-zero replays were executed on `supabase db reset --local --yes` (13 → 16 migrations as
the Stage 3 files landed), each followed by the full gate set, so every number below is a
post-replay measurement rather than an incremental state. `supabase db push`, `supabase link` and
any `--linked` flag were never used; there is no hosted project and no remote mutation. Local
administrative `psql` was used only for catalog inspection, pgTAP setup, the two experiments
below and fixture cleanup.

| gate | command | result |
| --- | --- | --- |
| clean install | `pnpm install --frozen-lockfile` | pass, no lockfile change |
| build | `pnpm build` | pass |
| typecheck | `pnpm check` | pass |
| dependency audit | `pnpm audit --prod --audit-level=high` | **No known vulnerabilities found**, exit 0 |
| unit + integration | `pnpm test` | **205 passed \| 1 skipped \| 0 failed** — reproduced identically on 6 runs including one started immediately after a reset |
| live authorization matrix | `pnpm test:stage3` | **110 passed**, 274 probes, 0 accepted attacks, 0 stored-state changes |
| database structure | `pnpm test:db` | **71 passed / 0 failed** (32 + 39 pgTAP assertions) |
| security advisors | `supabase db advisors --local --type security` | No issues found |
| performance advisors | `supabase db advisors --local --type performance` | No issues found (was 15) |
| schema lint | `supabase db lint --local` | No schema errors found |
| generated types | `pnpm db:types` | byte-identical to the committed `database.types.ts`; the pgTAP install into `extensions` does not leak into `public` |
| Stage 2 browser journey | `pnpm test:e2e:stage2` | 1 passed |
| Stage 3 browser isolation | `pnpm test:e2e:stage3` | 5 passed |

**Experiment log (executed, not asserted).**

1. *RLS negative control* — see §8.3. 7 live tests fail while a leak is open.
2. *FORCE ROW LEVEL SECURITY* — switching it on for `profiles`, `entitlements`, `clients`,
   `activities` broke nothing and stopped nothing: signup, profile reads and `create_client`
   kept working and an owner-role `UPDATE` still reported `UPDATE 7` on a table with no UPDATE
   policy, because `pg_roles.rolbypassrls` is `t` for the owning `postgres` role and BYPASSRLS
   outranks FORCE. This **disproved the justification previously written in §4.3**, which has
   been corrected rather than quietly kept; the same facts are now pinned by pgTAP section F.
3. *Planner shape* — the `InitPlan` measurement behind D9, above.

**One unexplained observation, recorded rather than smoothed over.** The very first `pnpm test`
run after the first post-hardening reset reported `3 failed | 202 passed | 1 skipped`. Only one
of the three was attributable — the Stage 2 assertion
`keeps the ledger closed to unauthenticated readers`, which failed with
`expected { code: '42501' … } to be null` because D2/D3 had just removed `anon` table grants
under a test written when RLS alone was the boundary. That assertion was **strengthened, not
loosened**: it still requires zero rows and now also names the `42501` denial, so a future
migration that quietly re-grants `anon` SELECT fails here instead of passing on an
RLS-filtered empty result. The remaining two failures were never reproduced: six subsequent full
runs, including one begun immediately after a fresh reset, returned
`205 passed | 1 skipped | 0 failed`. Treat this as a residual risk of ordering-sensitive state in
the shared local stack (the same stack also hosts the pgTAP and E2E suites), not as a proven
flaky test, and re-run `pnpm test` twice after any future privilege-bearing migration.

**Post-run database posture.** 13 tables, RLS on for all, `FORCE` off for all, 15 policies. 5
`auth.users` rows of which 2 are `stage3-%` browser accounts, 5 profiles, 3 clients, 2
receivables, and **0 rows in `purchase_claims`, `founder_admins` and `founder_audit_events`**.
`founder_offer_config` remains `FOUNDER_V1 | 49900 | cap 50 | payee 'DueWeave' |
upi_id NULL | PLACEHOLDER destination | payment_destination_status PENDING |
support_contact_status PENDING | refund_policy_status PENDING_APPROVAL | enabled t`. No real
payment destination exists or was enabled.

---

## FINAL REVIEW & REPAIR — D10 / D11 (future access must fail closed)

The numbers in the PHASE 23–24 table above are the pre-repair measurements and are kept as recorded.
Every gate was re-run after the repair; those results are here, and this section is authoritative.

**What independent review found.** Stage 3 was not rejected: the three forward migrations, the
274-probe live matrix, the 110 API tests, the pgTAP suites and the 5 browser isolation tests were all
confirmed present and passing. One fail-open remained, in the D6 block of
`20260814120000_current_stage3_authorization_hardening.sql`:

```sql
alter default privileges for role postgres in schema public
  grant select on tables to authenticated;
```

and, in the pgTAP file, a default-ACL assertion written as `privilege_type not in ('SELECT','USAGE')`
— i.e. the test tolerated exactly the privilege that made the migration unsafe.

**Why that is unsafe.** `ALTER DEFAULT PRIVILEGES` governs objects that do not exist yet. With that
line in place, any table a later migration creates in `public` as the migration role is
`SELECT`-able by every signed-in account unless the author remembers RLS, a policy *and* a revoke.
The failure mode is invisible at review time, because the dangerous object is written by someone
else, later.

**D10 reproduced before it was fixed (executed, not inferred from migration text).** Against the
16-migration database:

```
pg_default_acl (defaclrole = postgres, defaclnamespace = public, defaclobjtype = 'r')
  postgres=<all>, service_role=<all>, authenticated=r/postgres      <- the defect

begin; create table public.d10_red_probe_table (id bigint);
  has_table_privilege('anon', …, 'SELECT')          = f
  has_table_privilege('authenticated', …, 'SELECT') = t              <- RED
rollback;
```

**D11 found on the way, and not detectable by default-ACL inspection at all.** The same probe on a
newly created function returned `proacl = {postgres=X/postgres, =X/postgres, service_role=X/postgres}`
with `anon` and `authenticated` EXECUTE both `t`. The `=X` (PUBLIC) entry is a PostgreSQL *initial*
privilege for functions, applied after the recorded default ACL; measured forms that failed to remove
it: `revoke all on functions from public`, `revoke execute on functions from public`, revoking from
`public, anon, authenticated` with a following owner grant, grant-then-revoke, and revoking every
remaining grantee (which deletes the `pg_default_acl` row and falls back to `acldefault()`). Since
PostgREST exposes every EXECUTE-reachable public function as `/rpc/<name>`, a future helper function
written to be called only from a `SECURITY DEFINER` routine would have been anonymously callable.

**Test strengthened first, then the forward migration.** `supabase/tests/stage3_02_privileges.sql`
went from 39 to 61 assertions — section D now demands *zero* browser or PUBLIC privilege on any
future table/function/sequence rather than "no write", section E creates a real table, sequence and
function with no GRANT and inspects the ACLs they actually carry, section F creates a second table,
confirms it is unreadable, then exposes it on purpose with `grant select` + RLS + an `auth.uid()`
policy and resolves that policy as a genuine authenticated principal, and section G drops everything
and asserts nothing was left behind. Run against the 16-migration database before any new migration
existed:

```
# Failed test 38:  "the migration role installs no privilege of any kind on a future public object"   have: 1   want: 0
# Failed test 40:  "a future public table inherits no browser-role privilege"                          have: {authenticated}   want: {}
# Failed test 44:  "authenticated cannot read a table created by a later migration"                    have: true  want: false
# Failed test 46:  "a future table carries no browser-role or PUBLIC entry in its own ACL"              have: 1     want: 0
# Failed test 49:  "a future function is not anonymously callable"                                     have: true  want: false
# Failed test 50:  "a future function is not callable by an ordinary account"                          have: true  want: false
# Failed test 51:  "a future function does not inherit the implicit PUBLIC EXECUTE"                     have: true  want: false
# Failed test 52:  "a future function carries no browser-role or PUBLIC entry in its own ACL"           have: 1     want: 0
# Failed test 55:  "a new table is unreadable before the deliberate grant"                             have: true  want: false
Failed 9/61 subtests
```

Test 55 is the defect in one line: a fresh table was readable **before anybody granted anything**.

**The repair** is `supabase/migrations/20260814150000_current_stage3_default_privileges_fail_closed.sql`
— forward-only, and none of the three earlier Stage 3 migrations was touched:

```sql
alter default privileges for role postgres in schema public revoke all on tables   from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;
```

plus the `ddl_command_end` event trigger described under D11, which is the only supported way to strip
an initial privilege, narrowed to `CREATE/ALTER FUNCTION|PROCEDURE` in `public` and guarded so it only
acts when the role running the DDL owns the function — so no session can use it to strip another
owner's grants, and unrelated DDL cannot be aborted by it. `ALTER DEFAULT PRIVILEGES` was sufficient
for tables and sequences; the trigger exists only because functions are not covered by it.

**Executed posture after the repair.** The same disposable probe, replayed as the migration role:

```
anon_tab=f  auth_tab=f  auth_seq=f  anon_fn=f  auth_fn=f  public_fn=f  owner_fn=t  srvc_fn=t
grant execute on function <probe> to authenticated  ->  auth_fn=t        (explicit opt-in works)
```

`pg_default_acl` for (`postgres`, `public`) now resolves to `postgres` and `service_role` only for
tables, sequences and functions alike — no `anon`, no `authenticated`, no PUBLIC entry. The event
trigger is registered (`evtevent = ddl_command_end`, `evtenabled = O`) and its own function carries
`{postgres=X/postgres,service_role=X/postgres}` rather than the PUBLIC entry it was created with.

**Current application access is unchanged**, which was the risk of over-revoking: 20 browser-executable
RPCs and 0 anonymous ones, `authenticated` `SELECT` on exactly the 10 tenant-readable tables and
nothing on the three admin tables, `UPDATE` on `profiles` only — asserted by pgTAP sections A–C, and
again by the live suites below.

**One residual, disclosed rather than smoothed over.** This repair closes defaults for role
`postgres`, which is the role that applies this repository's migrations and owns all 13 tables and all
37 functions. `supabase_admin` keeps its own `pg_default_acl` rows that grant browser roles wide
access to objects *that role* creates; `postgres` cannot change them — measured, `alter default
privileges for role supabase_admin …` fails with `ERROR: permission denied to change default
privileges` because that role is a superuser and `postgres` is not. No application object is owned by
`supabase_admin`, so nothing in DueWeave's surface depends on it today; if a future migration is ever
applied by a different role, its defaults must be closed by whoever holds that role. This is the
Stage 3 boundary, not a silent pass.

### Post-repair gate set (all re-run after `pnpm db:reset:local`)

| gate | command | result |
| --- | --- | --- |
| replay from zero | `pnpm db:reset:local` | all **17** migrations applied, no errors; `supabase_migrations.schema_migrations` = **17** rows |
| database structure | `pnpm test:db` | **93 passed / 0 failed** (32 + 61), strictly greater than the previous 71 |
| live authorization matrix | `pnpm test:stage3` | **110 passed / 0 failed**, 274 probes: 178 refused, 17 accepted owner controls, 79 stored-state re-reads unchanged, **0 private rows changed by a non-owner** |
| Stage 2 contracts | `pnpm test:stage2` | 12 passed / 0 failed |
| Stage 2 browser journey | `pnpm test:e2e:stage2` | 1 passed |
| Stage 3 browser isolation | `pnpm test:e2e:stage3` | **5 passed / 0 failed** (after one non-reproducing first attempt, below) |
| schema lint | `pnpm exec supabase db lint --local` | **No schema errors found** |
| security advisors | `pnpm exec supabase db advisors --local --type security` | **No issues found** — the new fail-closed default produced no finding |
| performance advisors | `pnpm exec supabase db advisors --local --type performance` | **No issues found** |
| generated types | `pnpm db:types` | **byte-identical** — `git status` shows no change to `client/src/types/database.generated.ts`; the probe objects and the event-trigger function leave nothing in `public` that reaches the client |
| clean install | `pnpm install --frozen-lockfile` | pass, no lockfile change |
| lint / typecheck | `pnpm lint`, `pnpm check` | pass (`--max-warnings=0`), pass |
| unit + integration | `pnpm test` | **205 passed \| 1 skipped \| 0 failed**, reproduced identically on the last **4 consecutive** runs |
| build | `pnpm build` | pass |
| dependency audit | `pnpm audit --prod --audit-level=high` | **No known vulnerabilities found** |

**Two first-attempt failures, recorded with what was and was not ruled out.** The first `pnpm test`
run after this repair's reset reported `2 failed | 203 passed | 1 skipped`; both failures were in
`tests/stage2-local-foundation.test.ts`, and the second was the downstream consequence of the first
(`fixture.profileId` was still `undefined` at the assertion on line 161, so the earlier
profile-provisioning read had returned nothing). The same file passes standalone against the
post-repair schema (12/12) and four consecutive full runs afterwards returned 205/206 green. The
failing path is the Auth signup trigger plus a `profiles` read — code this migration does not touch,
since it changes only defaults for objects created *afterwards* and only for functions newly defined.
The first `pnpm test:e2e:stage3` attempt failed in `beforeAll` with
`page.goto: net::ERR_ABORTED at http://127.0.0.1:3000/auth` and a 30 s hook timeout on the very first
navigation of a Chromium context; the immediate re-run passed 5/5 and the same server answered
`200` for both `/` and `/auth` throughout. Both are treated the same way as the observation in
PHASE 23–24: unreproduced, in a stack shared by four suites and restarted just before the run, and
the reason `pnpm test` is now run more than once after any privilege-bearing migration. Neither was
answered by weakening an assertion.

---

## PHASE 25–26 — VERDICT

**PASS — qualified by execution, including one repair round after independent review.** One
authenticated DueWeave user cannot read, modify, delete, spoof-own, or workflow-reach another user's
private data, and cannot reach an admin surface, across 274 live browser-role probes (178 refused, 79
stored-state re-reads unchanged, 0 private rows changed by a non-owner), 93 pgTAP assertions, and 5
real-browser isolation tests driven through the app's own screens. Eleven executed defects (D1–D11)
were found, each reproduced failing first, then fixed by forward-only migrations and re-run; the two
deviations that remain (`FORCE ROW LEVEL SECURITY` off, `delete_my_business_data` closed to browsers)
are justified by executed experiments and pinned by assertions instead of by prose. The last two
defects are the ones a review — not a test — caught, and they are the reason the contract now reads
**default = closed, access = an explicit decision in the migration that makes it**: 17 migrations
replay from zero, a future `public` table, sequence or function starts with no privilege for `anon`,
`authenticated` or PUBLIC, and a deliberate grant plus a policy still works and still narrows to the
policy's own rows.

BOUNDARIES AND CARRIED-FORWARD STATE

- REMOTE SUPABASE MUTATIONS: **NONE**
- HOSTED PROJECT CREATED: **NO**
- PAYMENT ACTIVATION: **NONE** — placeholder destination, `upi_id` still NULL, all three
  operational statuses still PENDING
- RLS was never disabled to make a test pass; no denial assertion was weakened; no historical
  test was modified except the one Stage 2 assertion made stricter — and, in the repair round, the
  one default-privilege assertion that had been tolerating `SELECT` was made stricter
- None of the three earlier Stage 3 migrations was edited for D10/D11; the repair is the fourth
  file, applied forward, and the D1–D9 evidence above stands as originally recorded
- `main` untouched, no PR opened or merged, PR #1 unmodified, branch
  `current-stage-3-authorization` pushed normally (no force)
- GitHub Actions availability remains an **external blocker** and is not evidence against this
  stage; every gate above was run locally
- Stage 4 not started

DO NOT START STAGE 4.
DO NOT MERGE ANY PR.
