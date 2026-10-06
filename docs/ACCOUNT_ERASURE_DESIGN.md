# Account erasure design (B17) — Arc 3C

Status: **design and source only. Nothing here has been executed against a database.** Every
catalog number below is either read from a committed migration or from the retained Phase 3B hosted
catalog dumps (`fk-delete-action.raw`, `triggers.raw`, captured 2026-10-05 against
`ugzdqcytouwfdlcjujqv` at 24/24 migration parity, which Phase 3B proved identical to the local
chain). The gates that would normally turn this design into measurement — clean replay, pgTAP, the
live suites, the browser journeys — need Docker, and the Docker daemon on this machine does not
answer; see *Execution status*
at the end.

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
| `index.ts` | the wiring: read the request, ask GoTrue who the caller is, run the two privileged steps in order | the same file, structurally (source assertions), and behaviourally by the `F.*` claims in `tests/arc3c-local-account-erasure.test.ts` (**not executed**) |

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

Local serving, when a machine has the disk for it: `supabase functions serve delete-account
--env-file supabase/functions/.env` (copy from `.env.example`), with `ALLOWED_APP_ORIGIN` set to the
Vite origin, otherwise every `F.*` claim in the live suite fails with the 501 rather than passing
vacuously.

## Execution status

Both authorised Docker passes reclaimed **0 B** — the build cache measured 0 B total and there were 0
dangling images, so the two permitted pruning commands had nothing to remove, and volumes are
untouched because 168 of them are anonymous and the same daemon hosts another product's running
stack. Free space on C: then rose on its own to `6,986,805,248` bytes (6.51 GiB, measured
2026-10-06), which is above the agreed 4 GB floor — so the floor is no longer what blocks these
gates. What blocks them is the daemon itself, re-probed on 2026-10-06 and unresponsive from both
sides of the machine:

| Probe | Result |
| --- | --- |
| `docker version --format …` (host) | exit 124 after 25 s, **0 bytes** of output |
| `docker ps --format …` (host) | exit 124 after 40 s, **0 bytes** |
| `docker info …` inside WSL Ubuntu | exit 124 after 75 s, **0 bytes** (`wsl -l -v` shows Ubuntu *Running*, so the distro answers and the daemon does not) |

Nothing was started, restarted or killed to try to fix that: the daemon is shared, and a wedged
Docker Desktop is the other product's runtime as much as DueWeave's.

| Gate | Status |
| --- | --- |
| STEP 1 local RED reproduction (A/B/C) | **NOT EXECUTED** — mechanism is measured from the catalog and the guards' committed text; the aborting function per table is named above |
| Migration apply + clean replay | **NOT EXECUTED** |
| pgTAP (incl. the 24→25 routine-count pins at `supabase/tests/stage3_02_privileges.sql:137` and `stage5_02_promise_chronology.sql:300`) | **NOT EXECUTED** — assertions written, awaiting a database |
| Live DB suites, account-deletion regression suite | **NOT EXECUTED** |
| Browser smoke / full E2E / `verify:release:local` | **NOT EXECUTED** |
| `pnpm lint`, `pnpm check`, `pnpm build`, `pnpm test:unit`, `pnpm verify:secrets`, `pnpm audit --prod` | runs without Docker — see the phase record |
| Edge Function served locally | **NOT EXECUTED** — no Deno on either side and no `edge-runtime` image cached |
| Production migration apply, Edge Function deploy, hosted Auth change | **NOT PERFORMED, by instruction** |

No line above is claimed as passing. The B17 verdict stays **NOT READY FOR PRODUCTION DEPLOY** until
the database gates execute somewhere with a working container runtime.
