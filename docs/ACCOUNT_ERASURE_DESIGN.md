# Account erasure design (B17) — Arc 3C

Status: **design and source, replayed and executed against the loopback stack on 2026-10-06, and not
deployed anywhere.** Every catalog number below is either read from a committed migration or from the
retained Phase 3B hosted catalog dumps (`fk-delete-action.raw`, `triggers.raw`, captured 2026-10-05
against `ugzdqcytouwfdlcjujqv` at 24/24 migration parity, which Phase 3B proved identical to the local
chain). When this section was first written the executing gates could not run; they have since —
STEP 1's reproduction, the clean 25-migration replay, pgTAP, the ten live suites with the function
served, and `pnpm verify:release:local` at exit 0 — and *Execution status* at the end carries the
measured numbers, the gates that still have not run, and the boundary this phase stops at.

## The defect this closes

B17, found by executing Phase 3B's cleanup step: an account with ledger history cannot be deleted by
any supported path. `auth.admin.deleteUser` deletes the `auth.users` row, PostgreSQL walks the
`ON DELETE CASCADE` edges, and a `BEFORE DELETE` guard on a history row raises, aborting the whole
statement with `Database error deleting user`. The one self-service RPC that would have surfaced this
earlier — `delete_my_business_data()` — is deliberately revoked from `authenticated`
(`20260812160500_revoke_unused_delete_rpc.sql:3`), and re-granting it would fail the same way,
because it deletes `profiles` and walks the identical cascade.

The Phase 3B write-up named three guards. Measuring the graph for this design found **five** guard
functions and **two additional blockers that are not triggers at all**. The brief's warning not to
assume only payments/activities/promise_events are affected was correct.

## STEP 2 — the measured delete graph

23 foreign keys reach these tables (`fk-delete-action.raw`, all 23 rows). The edges that matter for
an erasure, by parent:

| Parent | Child | Constraint | ON DELETE |
| --- | --- | --- | --- |
| `auth.users` | `profiles` | `profiles_id_fkey` | CASCADE |
| `auth.users` | `founder_admins.user_id` | `founder_admins_user_id_fkey` | CASCADE |
| `auth.users` | `founder_admins.created_by` | `founder_admins_created_by_fkey` | SET NULL |
| `auth.users` | `founder_audit_events.actor_user_id` | `founder_audit_events_actor_user_id_fkey` | SET NULL |
| `auth.users` | `founder_audit_events.target_user_id` | `founder_audit_events_target_user_id_fkey` | **RESTRICT** |
| `profiles` | `clients`, `receivables`, `promises`, `payments`, `activities`, `promise_events`, `entitlements`, `purchase_claims`, `analytics_events` (`owner_id`) | `*_owner_id_fkey` ×9 | CASCADE |
| `promises` | `promise_events` | `promise_events_promise_id_fkey` | CASCADE |
| `promises` | `activities.promise_id` | `activities_promise_id_fkey` | **SET NULL** |
| `receivables` | `payments`, `promises`, `promise_events`, `activities` | `*_receivable_id_fkey` ×4 | CASCADE |
| `clients` | `activities` | `activities_client_id_fkey` | CASCADE |
| `clients` | `receivables` | `receivables_client_id_fkey` | **RESTRICT** |
| `purchase_claims` | `founder_audit_events.claim_id` | `founder_audit_events_claim_id_fkey` | **RESTRICT** |

Three blockers, of two different kinds:

1. **Guards that fire on DELETE** (5, from `triggers.raw`): `payments_immutable`,
   `activities_immutable` and `promise_events_immutable` → `prevent_immutable_history_changes()`
   (`20260812150500_secure_foundation.sql:311`, an unconditional raise);
   `promises_guard_history` → `guard_promise_history()`
   (`20260815100000_current_stage5_promise_chronology.sql:251`, `if tg_op = 'DELETE' then raise`);
   and `purchase_claims_protect_workflow` → `prevent_direct_purchase_claim_change()`
   (`20260813030000_stage4_founder_monetization.sql`, `if tg_op = 'DELETE' then raise 'Founder claim
   history is immutable'`), which is declared `BEFORE INSERT OR DELETE OR UPDATE`.
2. **RESTRICT edges, no trigger involved.** `founder_audit_events.target_user_id` points at
   `auth.users` with RESTRICT, and `create_founder_claim` writes that row itself
   (`20260813030000_stage4_founder_monetization.sql:164`). So an account that ever filed a Founder
   claim cannot be deleted even if every guard were satisfied — the cascade raises a foreign-key
   violation instead. The same table's `claim_id` RESTRICTs against `purchase_claims`, which is a
   CASCADE child of `profiles`, so the claim row cannot be removed underneath its audit either.
3. **A second-order case the guards alone hide.** `activities_promise_id` is SET NULL. Deleting a
   promise therefore issues an **UPDATE** on the dependent `activities` rows, and
   `activities_immutable` fires on UPDATE. A purge that deletes promises before activities does not
   erase a ledger row, it trips the immutability guard through the back door. Order matters, and the
   guard must stay closed to that UPDATE regardless.

Tables with no DELETE guard: `clients`, `receivables`, `entitlements`, `analytics_events`,
`profiles`, `founder_admins`, `founder_audit_events`, `founder_offer_config`.

## STEP 3 — threat model of the brief's preferred architecture

The brief proposes a transaction-local deletion context bound to exactly one auth user UUID, which
the guards honour for DELETE only. Threat-modelled against this repository, as instructed:

- **Can a browser caller forge it?** A custom GUC is settable by any session
  (`select set_config('app.any_name', 'any_value', true)`), so a context whose *presence* is the only
  requirement is forgeable in principle. It is not forgeable **into a delete** here, because
  `20260814120000_current_stage3_authorization_hardening.sql:72-89` revokes all table DML from
  `anon` and `authenticated` and grants back only `select` (plus `update` on `profiles`): a forged
  context has no privileged write to unlock. A delete can only ever run inside a `postgres`-owned
  `SECURITY DEFINER` function, i.e. code that is in this directory and reviewable.
- **The residual risk is real but different.** The repository already uses two such GUCs —
  `app.ar1_write_context` and `app.dueweave_claim_context`. A context that a caller can pre-arm in
  their own session leaks into whatever `SECURITY DEFINER` function the caller invokes next, because
  `set_config(..., true)` is transaction-scoped, not call-scoped. A design that trusts the GUC alone
  is therefore weaker than it needs to be, and it is the kind of weakness that only bites after a
  later migration adds a deleting function.
- **Identity must never be a parameter.** If the erasure RPC accepts a target user id, the browser
  (or a compromised function) can name another account. If it takes no argument and reads
  `auth.uid()`, cross-account erasure is impossible at the data layer, not merely disallowed by
  policy.

### The design this phase adopts

Four conditions, all required, for any DELETE of a guarded history row:

1. `tg_op = 'DELETE'` — UPDATE stays refused unconditionally, including the SET NULL case above.
2. The transaction-local context `app.dueweave_erasure_owner` is set, and its value equals the
   **row's own** `owner_id`.
3. `auth.uid()` of the session equals that same value — so a caller who pre-arms the GUC still cannot
   name anyone but themselves, and a function that is handed the wrong context aborts.
4. `current_user` is the migration owner role (`postgres`), which a plain `authenticated` session
   cannot become except through a function written here.

Condition 3 makes the GUC self-limiting; condition 4 makes the path auditable. The RPC takes **zero
arguments**, is `SECURITY DEFINER` with a pinned `search_path`, is granted to `authenticated` only,
and deletes in explicit child-first order so no cascade is relied on and no SET NULL UPDATE is
generated:

```
promise_events → payments → activities → promises → purchase_claims
→ entitlements → analytics_events → receivables → clients → founder_admins → profiles
```

each as `… where owner_id = v_owner`, with `v_owner := auth.uid()` and a `founder_admins` row keyed
by `user_id = v_owner`. The `auth.users` row itself is **not** touched by the RPC: the Edge Function
removes it afterwards through the admin API, by which time the cascade has nothing left to trip on.

**Founder accounts fail closed.** Two RESTRICT edges reach into the Founder review ledger, and the
RPC refuses on either one before it arms the erasure context, so a refusal cannot be half-applied:

- an audit row naming the caller as `target_user_id` (`20260813030000:33`) blocks the caller's own
  `auth.users` delete;
- an audit row naming one of the caller's claims as `claim_id` (`:32`) blocks the claim delete
  itself, which would otherwise abort the purge partway through.

In practice `create_founder_claim` writes both at once (`:164-165`), so every account that reaches
the second branch is already caught by the first; the second exists so a future claim shape that
skips `target_user_id` still gets a clean refusal instead of a foreign-key error. Erasing such an
account would require deleting Founder review provenance, which Stage 8 made immutable on purpose,
or rewriting a RESTRICT edge — a product decision about the review ledger, not a detail of this
repair. Reviewers are unaffected: `actor_user_id` (`:34`) and `founder_admins.created_by` (`:26`)
are SET NULL and no guard fires on either cascade UPDATE, so a reviewer can erase their own account
and the audit trail survives with a null actor. Recorded as **B19**.

## STEP 4 — `delete-account`, the endpoint that owns the deletion

The RPC emptied the business rows but left `auth.users` standing, and the only supported way to
remove that row (`auth.admin.deleteUser`) is a privileged call that cannot live in a browser. So the
user-facing entry point is an Edge Function at `supabase/functions/delete-account/`, and it is the
place where all of STEP 4's rules are enforced together.

Two files, split on purpose:

| File | Role | Executed by |
| --- | --- | --- |
| `contract.ts` | every decision — confirmation shape, bearer extraction, origin policy, method policy, failure copy. No Deno, no fetch, no client import | `tests/arc3c-erasure-contract.test.ts`, **run and green (19 tests)** |
| `index.ts` | the wiring: read the request, ask GoTrue who the caller is, run the two privileged steps in order | the same file, structurally (source assertions), and behaviourally by the `F.*` claims in `tests/arc3c-local-account-erasure.test.ts` — **run and green (22 tests, 2026-10-06, with the function served)** |

The three properties that make it safe, in the order they are checkable:

1. **No target from the browser.** The endpoint has no field for a user id; a body that carries one is
   refused with copy that does not repeat the identifier. The target is `user.id` from a token GoTrue
   confirmed, and `delete_my_account()` takes no argument either, so neither half can be aimed at
   somebody else (`F.6`, and the confirmation tests).
2. **The purge runs as the caller.** `caller.rpc(ERASURE_RPC)` uses the caller's own token, so
   `auth.uid()` is truthful inside the erasure context and condition 3 of the design above is the one
   doing work. `service_role` is revoked on that RPC by the migration, which is what makes the
   next property meaningful.
3. **The privileged key is only ever an environment value.** `SUPABASE_SERVICE_ROLE_KEY` is read with
   `Deno.env.get`, used for exactly one call (`auth.admin.deleteUser`, on the id GoTrue just
   returned), and never interpolated into a response, a log line, or `VITE_*`. A leaked key can
   therefore remove an auth row that has already been emptied — it cannot erase another account's
   ledger, because it cannot call the RPC.

Order is the repair, not an optimisation: the RPC must run first so the cascade from `auth.users`
finds no guarded row (B17), and if the second step fails the endpoint answers
`{"status":"incomplete"}` — never a success, because that account holder's records are gone while
their login still works, and only they can retry.

`supabase/config.toml` pins `verify_jwt = true` for this function so the gateway rejects an
unverifiable token before the handler runs. That is a second line, not the first: the handler
still calls `getUser()` because a config default is not a security boundary.

### Deploy and run (owner action — deliberately NOT performed in this phase)

The brief stops this phase before any production write, so the sequence below is a runbook, not a
record of something done:

1. Land the migration: `release/consumer-live` must show a three-job green run at the exact SHA that
   carries `20261006120000_current_arc3c_account_erasure_path.sql`, then that SHA's chain is applied
   with `pnpm exec supabase db push` against the linked reference.
2. Set the origin before deploying, so the function never starts life answering every caller:
   `pnpm exec supabase secrets set ALLOWED_APP_ORIGIN=https://<the app's exact origin>` — scheme, host
   and port must match what the browser sends, no trailing slash, no wildcard.
3. `pnpm exec supabase functions deploy delete-account`. The platform injects `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`; nothing is pasted into the dashboard for this
   function beyond the origin.
4. Verify with the QA accounts, in this order: an unentangled account deletes itself end-to-end
   (`auth.users` row gone, zero owned rows), a second QA account is untouched row-for-row, a
   Founder-entangled account is refused with the B19 message, and `GET`/anonymous/no-JWT/wrong-origin
   requests get 405/401/401/403.
5. Rollback posture: the migration is forward-only. `delete_my_account()` and its context helper can
   be revoked (`revoke execute on function public.delete_my_account() from authenticated;`) to close
   the self-service path without touching any deployed schema or any row, and the Edge Function can be
   undeployed. Neither action is a data migration, and neither is needed to leave the app as it is
   today — until steps 1-3 run, production behaves exactly as it did at Phase 3B.

Local serving, for the machine that has a working container runtime: `node
scripts/local-functions-serve.mjs start` — which runs `supabase functions serve delete-account
--env-file supabase/functions/.env` detached, waits until the endpoint answers 401 for a caller with
no token (404 means the function is not mounted, 501 means `ALLOWED_APP_ORIGIN` never reached the
runtime), and writes its pid and log under the gitignored `supabase/.temp/`; `stop` terminates that
pid, stops only `supabase_edge_runtime_<this checkout's project id>`, and then proves the endpoint
stopped answering. The env file it creates carries `ALLOWED_APP_ORIGIN` and nothing else, because the
CLI injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` into the runtime
container itself — no privileged value has to exist on disk for the battery to run. Without the origin
set, every `F.*` claim fails with the 501 rather than passing vacuously.

## Execution status

These gates ran on 2026-10-06 between roughly 10:15 UTC and 11:36 UTC, and the machine then wedged
again; both halves are recorded, because "the daemon answers" is a property of the moment rather than
of the repository. Disk stopped being the constraint the same day: the two authorised prune passes
reclaimed **0 B** (build cache already 0 B, 0 dangling images; `image prune -a`, every `system prune`
form and every volume prune were refused by rule — 168 anonymous volumes, and another product's live
stack shares this daemon) and free space rose on its own to `6,986,805,248` bytes, above the agreed
4 GB floor.

| Gate | Measured result |
| --- | --- |
| STEP 1 RED reproduction, on a clean replay of the 24 committed migrations | **EXECUTED.** Direct `DELETE` by an `authenticated` session on `payments` / `activities` / `promise_events` → `42501 permission denied for table`; `delete_my_business_data()` as `authenticated` → `42501 permission denied for function`; `auth.admin.deleteUser` against an account holding history → `Database error deleting user`. Probing the same deletes as the migration role names the function that aborts each one: `prevent_immutable_history_changes()` raises `Historical records cannot be changed [P0001]` on `payments`, `activities` and `promise_events`; `guard_promise_history()` raises `Promise history cannot be deleted [P0001]` on `promises`, on `profiles` (reached through the `auth.users → profiles → promises` cascade) and on the whole `auth.users` delete — that is the message B17 answers with. `purchase_claims` is held by `prevent_direct_purchase_claim_change()`, and the Founder edge is not a trigger at all: deleting `auth.users` while a Founder audit row exists dies at `23503 … violates foreign key constraint "founder_audit_events_target_user_id_fkey"`. Every statement rolled back, and the probe fixture read back intact (`payments 1, activities 7, promise_events 3, promises 2, clients 1, receivables 2, profiles 1, auth_users 1`) |
| 25th migration applied, clean zero replay | **EXECUTED.** `pnpm db:reset:local` recreated the database and applied all 25 in order, ending `Finished supabase db reset on branch release/consumer-live`; `pnpm verify:migrations` → "Migrations on disk: 25. Applied in the local database: 25." |
| Generated types re-cut | **EXECUTED.** `pnpm db:types` against the replayed schema added `delete_my_account` and `erasure_allows_delete`, and `pnpm verify:types` → "client\\src\\types\\database.generated.ts matches the local schema (38464 bytes)." |
| pgTAP, incl. the 24→25 routine-count pins | **EXECUTED — red twice, then green.** Run 1: `function is(name[], text[], text) does not exist` at `supabase/tests/arc3c_01_account_erasure.sql:170`, with subtests 18, 20 and 22 red. Run 2: `function is(integer, bigint, unknown) does not exist` at `:109` (planned 41, ran 17). Run 3: `Files=9, Tests=405 … Result: PASS`, with `stage3_02_privileges.sql` and `stage5_02_promise_chronology.sql` both answering 25. The two repairs are pgTAP-signature fixes (count the rows instead of comparing an array, cast to `bigint`) and neither relaxed a claim: the privilege assertion that could not parse now counts DML grants held by `authenticated` **or** `anon` across the five guarded tables and demands 0, which is wider than the version it replaced |
| Schema lint | **EXECUTED.** `pnpm db:lint` → "No schema errors found" |
| The ten live DB suites with `delete-account` served | **EXECUTED.** `pnpm test:live` → `Test Files 10 passed (10)`, `Tests 331 passed (331)`, with `tests/arc3c-local-account-erasure.test.ts` 22/22 and its destructive journey F.8 at 4413 ms. The caveat has to travel with the number: that serve is the WSL-side one (`serve-wsl.log`: 1 setup, 0 change events, 104 served requests), and the `supabase/functions/.env` in front of it still held this stack's own values. Those values are skipped by the CLI itself (`Env name cannot start with SUPABASE_, skipping: …`), so the runtime saw only `ALLOWED_APP_ORIGIN` either way — but the battery has **not** been re-executed against the single-variable env file `scripts/local-functions-serve.mjs` writes, which is the shape CI uses, and that re-run needs `docker exec` |
| `pnpm verify:release:local` | **EXECUTED, exit 0** (its `test:live` stage started 11:31:24Z and `test:unit` 11:35:14Z, host clock +5:30): `verify:db:local` (reset → types → migrations → pgTAP → lint), the `test:live` above, `pnpm build` (`✓ built in 13.56s`), `pnpm test:unit` (33 files / 463 tests), `pnpm lint` 0, `pnpm check` 0, `pnpm verify:secrets` 0, `pnpm audit --prod` 0 |
| Two findings the execution produced | (1) **PostgREST version sensitivity.** `tests/stage4-local-edit-workflows.test.ts` and `tests/stage4-local-repository-edit.test.ts` first failed (4 of 21, then 3 of 14 even at a 60 s ceiling) with requests that hung rather than answered. This laptop's stack was serving `postgrest v14.18` while the pinned CLI (2.117.0) asks for `postgrest:v16.2`; the same database and the same suites answered **21/21 in 4.85 s** behind a v16.2 process. The hang therefore belongs to a stale local image, not to the schema, and CI — which starts a CLI-pinned stack for every job — never inherits it. The laptop's own v14.18 container was stopped, not deleted; restoring it is phase-close work. (2) **Serving from a Windows path is not stable.** A watcher started against the `C:\…` checkout logged 12 "File change detected" events and re-created the edge runtime 7 times, which is what produced the 502s in the 9-of-22 red run; the WSL-side serve of the same tree logged 1 setup and 0 change events. Counted from the serve logs, the difference is not subtle: the churning window (`supabase/.temp/functions-serve.log`, 11:46:30Z→11:48:33Z) let only **2** requests reach `serving the request`, while the stable serve (`serve-wsl.log`, 10:35:46Z→11:37:15Z) served **104** — the battery whose 22/22 is the row above. The churn is not one serve misbehaving: all three Windows-side captures this phase churned (24 events / 8 setups at 10:23–10:28Z in `functions-serve.log`, 19 / 7 at 10:29–10:32Z in `serve-debug.log`, 12 / 7 in the red run). A 502 is Kong's answer when the mounted route has no upstream worker, which is why even the tokenless probe that answers 401 on a stable serve answered 502 there. The events are also **not writes**: `index.ts` and `contract.ts` carry host mtimes of 13:34:30 and 13:35:50 (= 08:04Z, 08:05Z, ~3.5 h before the window), their directory 13:35:50, and `.env`'s two later events postdate that file's only write at 11:46:25Z — so no content changed while the runtime was being torn down and rebuilt. What is **not** established is *why* a Windows-side watcher reports those writes at all, which is a bind-mount question rather than a repository one. CI serves from the WSL path, and readiness is decided from the endpoint's own answer (404 not mounted, 501 unconfigured, 401 served-and-configured) so a mis-served function is reported rather than absorbed |
| F.8's measured ceiling | 4413 ms inside a full-suite run, 4.28 s with the file alone, and over Vitest's 5 s default once the other nine suites had just used the same Postgres. The file carries `{ timeout: 30_000, hookTimeout: 60_000 }` for that reason — a ceiling, not a retry: a wedged request still fails |
| Browser smoke, React-warning gate, full E2E | **PARTLY EXECUTED.** `node scripts/run-e2e.mjs` over 5 of the 7 smoke specs (14:24:36Z→14:32:40Z): `47 passed / 1 failed / 10 did not run (8.0 m)`, `--workers=1`, `retries: 0`; the single red was the describe's shared console guard (`e2e/stage7-local-export.spec.ts:157`) receiving `net::ERR_NAME_NOT_RESOLVED` for the Google Fonts stylesheet `client/index.html:16-18` loads — the test body itself passed, including `:256`'s assertion that no Import/Restore/Delete-my-account affordance was invented beside the export files. Classified against the network rather than inherited: `getent hosts fonts.googleapis.com` and `curl` of the same URL answered (200) minutes later, and the file alone re-ran **13 passed (3.4 m)** — the failed test plus all 10 that had not run. **58 slots green across the two executions, 0 failed, 0 skipped.** `pnpm test:e2e:react-warnings` → **3 passed (43.8 s)**, exit 0. Still NOT executed: the two Stage 8 Founder specs (they shell to `docker exec`, which this host cannot give) and therefore the **complete** smoke gate — and **the erasure sheet has never been rendered in a browser**, so STEP 5's UX claims rest on source plus DOM-level tests |
| CI at a Phase 3C head | **NOT RUN.** The commits are local. The runner is self-hosted on this same machine, and the Docker **CLI** stopped answering during the phase — `docker version` exit 124 at 25 s and again at 100 s, `docker ps` exit 124 at 40 s and 130 s, `docker version` inside WSL exit 124 at 20 s — while the already-running containers kept answering HTTP (a tokenless `POST /functions/v1/delete-account` still returned 401, and `node scripts/local-stack-check.mjs` was **exit 0** at 15:18Z). The retained proof that the CLI is the blocker is the battery's own fail-fast at **14:18:36Z: exit 1, 22 tests skipped**, ``docker exec` against supabase_db_dueweave did not answer within 30000 ms (ETIMEDOUT)`. Pushing now would buy a run whose container steps fail for that reason, so nothing was pushed and no CI pass is claimed. Nothing was restarted, killed or pruned to chase the daemon |
| Production migration apply, Edge Function deploy, hosted Auth change | **NOT PERFORMED, by instruction.** This phase made no hosted write of any kind |

B17's verdict moves from "written, blocked" to **replayed and executed against a real Postgres and a
real function runtime, not yet proven in CI and not deployed**. What still separates the row from
closed: the browser half, the battery re-executed under the script-managed serve, the delivered SHA's
own three-job green, and the owner's `db push` plus `functions deploy`.
