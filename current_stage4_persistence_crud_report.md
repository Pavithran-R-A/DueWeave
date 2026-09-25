# DUEWEAVE CURRENT ROADMAP — STAGE 4: REAL PERSISTENCE + SAFE CRUD + RELOGIN DURABILITY

Brief id: `d0d61d01-f4d7-4205-88d2-3b26a408a5ea`
Branch: `current-stage-4-persistence-crud` (base `bfb35cd5168945b22013f98dd04927fe6c3cad63`)
Qualified: 2026-09-25/26 against the project-local Supabase Docker stack only.
Verdict: **STAGE 4 PASSES its exit criteria**, with one carried-forward open item (`PGRST303`, environment-side, §8) and the caveats in §10. This is not a Stage 5 verdict and not a merge recommendation.

---

## 1. Boundaries actually observed

| Boundary | Evidence |
| --- | --- |
| Local stack only, no hosted project | No `supabase link` / `db push` / `--linked` invoked. `supabase/config.toml` is unmodified in this work (absent from `git status`). `git grep supabase\.co -- scripts tests e2e client supabase package.json` → no matches; the only repo mentions are prose in the historical Stage 2 report, which was not edited. |
| No PR created, PR #1 untouched, no merge | No `gh pr` invocation; branch has no upstream until the single push in §11. |
| No Stage 5 work | Nothing in the diff touches entitlement lifecycle, payments, notifications, exports, or multi-user sharing. |
| No `service_role` in any browser/test path | `git grep` over the commit set: `service_role` appears once, inside an assertion that forbids it (`tests/security-contract.test.ts:228`). |
| No RLS disabled, no denial weakened | Stage 3's cross-tenant assertions were re-run unchanged and still pass; the receivable financial-column guard trigger is still armed (§6 D-S4-2 measurement). |
| No demo/seed data committed | Only 13 tables' DDL + 19 migrations + tests are tracked; `dist/`, `test-results/`, all `.env*` variants and `supabase/.temp/`+`supabase/.branches/` are gitignored and untracked. |

## 2. Persistence inventory (P2) — measured on the zero-replayed database

`public` tables (13): `activities, analytics_events, clients, entitlements, founder_admins, founder_audit_events, founder_offer_config, payments, profiles, promise_events, promises, purchase_claims, receivables`.

| Surface | How the browser reaches it | Writable in Stage 4? | Notes |
| --- | --- | --- | --- |
| `clients` | `SELECT` via `SupabaseClientRepository.list()`; writes only via RPC | **Yes — 5 columns** (`name, company, phone, email, notes`) through `update_client` | `id, owner_id, created_at, archived_at, updated_at` are not parameters and are not in the UPDATE set. |
| `receivables` | `SELECT` via `SupabaseReceivableRepository.list()`; writes only via RPC | **Yes — 3 columns** (`label, invoice_ref, notes`) through `update_receivable_details` | `amount_due_paise, outstanding_paise, status, owner_id, client_id, due_date, created_at` unreachable; `guard_receivable_financial_fields` independently refuses them outside the payment context. |
| `promises`, `payments`, `activities`, `promise_events` | RPC write paths from Stages 2–3 | No (unchanged) | Row-level immutability triggers remain armed; Stage 4 added no edit or delete surface. |
| `profiles` | direct `UPDATE` (self-scoped, pre-existing) | unchanged | The **only** table `authenticated` may `UPDATE` directly — measured from `information_schema.table_privileges`. |
| `entitlements`, `purchase_claims`, `founder_*` | founder RPCs | unchanged | Out of Stage 4 scope. |
| `analytics_events` | write-only RPCs | unchanged | Out of scope. |

Measured privilege posture after replay (`pg_proc` + `aclexplode`):
- `authenticated` has **UPDATE on exactly one table** (`profiles`) — so Stage 4 did **not** widen table UPDATE to reach the edit columns; the brief's prohibition was honoured mechanically, not just in intent.
- `authenticated` can `EXECUTE` exactly **22** routines (20 carried from Stages 2–3 **+** `update_client`, `update_receivable_details`), matching the exact-set pgTAP assertion.
- `anon` can `EXECUTE` **zero** public routines (`anon_execute=none`). Both new routines were re-`REVOKE`d from `public, anon` after creation because the Stage 3 fail-closed `ddl_command_end` trigger strips implicit grants — the explicit `GRANT EXECUTE TO authenticated` is the only browser door.

## 3. What Stage 4 changed

**Database (forward-only).** One new migration, `20260814170000_current_stage4_persistent_edits.sql`. None of the 18 existing migrations was edited (`git status` shows only this one new file under `supabase/migrations`). Owner is taken from `auth.uid()`; there is no caller-supplied `owner_id`; identity columns are copied from the locked row, never from arguments; the row is selected `FOR UPDATE` before the token comparison; `updated_at` is advanced only by the pre-existing `set_updated_at` trigger, so the token cannot be forged or left stale.

**Concurrency decision (P8).** Last-write-wins was evaluated and rejected: both routines require `p_expected_updated_at` and raise `SQLSTATE 40001` on mismatch (`P0002` when the row is not in the caller's ledger). No version table, no column added, no advisory lock.

**Deliberate exclusions (P7 boundary record).** `due_date` editing is *not* implemented: moving a due date silently re-grades every stored promise as kept/broken and rewrites queue priority, which is promise-lifecycle work with a provenance requirement, not a wording edit. Client re-parenting is not implemented and is already impossible at the database layer. No delete surface was added anywhere.

**Types (P11).** `client/src/types/database.generated.ts` is regenerated from the replayed schema; the only delta is +58 lines for the two new RPC signatures. No `any`, no `@ts-ignore`; `pnpm check` proves the repositories compile against the generated RPC types.

**Repositories and the honest read (P12, P13).** `ClientRepository.list/create/update`, `ReceivableRepository…updateDetails`, plus `SupabaseDashboardRepository.settleDuePromises()` split out of `read()`, which previously performed a database write while being named as a read. `tests/security-contract.test.ts` was **updated to assert the new split**, not deleted. No raw `supabase.from()`/`rpc()` in `Home.tsx`, `finance-ui.tsx`, `sheets.tsx` or any page — enforced by the new `tests/repository-boundary.contract.test.ts` source-boundary test (P26), with the auth hook as its only documented exception.

**Edit UI (P14–P21).** `EditClientSheet` (4 inputs + 1 textarea, wording/contact only) and `EditReceivableSheet` (2 inputs + 1 textarea, plus a read-only context block showing amount/due date/client as text, never as controls). Quiet Ledger styling reused as-is — no redesign, new colors, or layout change. Failed saves keep the sheet open with typed content and show an understandable toast; a save in flight disables the submit button and is guarded by a ref so a double-submit cannot write twice.

**Errors (P20).** `userFacingDataError(message, code)` now takes PostgREST's `error.code`: `40001` becomes "This record changed while you were editing…", a `P0002` "private ledger" refusal becomes "That record is no longer available in your ledger." Raw SQLSTATE, policy and permission text never reach the customer (unit-tested for the three real raw strings).

**Domain vocabulary and clock (P5, P6).** `DemoState` → `LedgerState`; `todayInIndia` moved to a testable `BusinessClock` (`client/src/lib/business-clock.ts`) injected into `getQueue`/`priorityBreakdown`/`priorityReasons`/`getSuggestion`/`addIndiaBusinessDays` with `systemClock` as the default. **No scoring weight changed** — the extracted `breakdownFor` is the same arithmetic, and the rule tests still pin every band.

## 4. Gate results (all measured after the final zero replay)

| Gate | Command | Result |
| --- | --- | --- |
| Zero replay | `supabase stop` → `supabase start` → `pnpm db:reset:local` | `Applying migration` lines = **19**, `Finished supabase db reset`, no seed warning other than the pre-existing `supabase/seed.sql` absence. Replayed 4× during this stage with identical counts. |
| Type regeneration determinism | `pnpm db:types` ×2 | Three consecutive generations byte-identical: `sha1 eedacce24ab298d73c2d57cba8994a66761915b3`. |
| Database tests | `pnpm test:db` | `Files=3, Tests=143 … Result: PASS` (Stage 3 structure + privileges, plus the new `stage4_01_edit_routines.sql`). |
| Schema lint | `supabase db lint --local` | `No schema errors found`. |
| Performance advisor | `supabase db advisors --local --type performance` | `No issues found` (equal to the Stage 3 baseline ⇒ **no new unresolved finding**). |
| Security advisor | `supabase db advisors --local --type security` | `No issues found`. |
| Types | `pnpm check` (`tsc --noEmit`) | clean, no output. |
| Lint | `pnpm lint --max-warnings=0` | clean, no warnings. |
| Unit + integration | `pnpm test` | **268 passed \| 1 skipped (269)** — the mandated consecutive pair, twice: 16 files passed \| 1 skipped. The single skip is the pre-existing gated `tests/supabase.public-config.live.test.ts`. |
| Stage 2 browser | `STAGE2_LOCAL_E2E=1 pnpm test:e2e:stage2` | **1 passed** (signup → ledger → signout → signin). |
| Stage 3 browser | `STAGE3_LOCAL_E2E=1 pnpm test:e2e:stage3` | **5 passed** (two-account isolation, picker non-discovery, founder surface closed, unauthenticated route refusal). |
| Stage 4 browser (P17, central exit criterion) | `STAGE4_LOCAL_E2E=1 npx playwright test e2e/stage4-local-persistence.spec.ts` | **10 passed** on a freshly zero-replayed stack, including the concurrency describe. |

`e2e/stage4-local-persistence.spec.ts` provisions its own accounts through the **sign-up form**, edits through the app's own screens, and never uses `E2E_EMAIL`/`E2E_PASSWORD`, a `service_role` key, a direct insert, or a React-state inspection. What it proves:

1. the journey really created the record it goes on to edit (guards a vacuous pass);
2. editing a client leaves its money and history context untouched;
3. the receivable sheet **offers** wording fields and **refuses to offer** money fields — `Amount due / ₹1,800 / Due date / Client` are plain text, and the sheet contains exactly 3 controls (2 inputs + 1 textarea), zero number/date inputs and zero selects;
4. editing details leaves amount and due date intact;
5. a **reload** re-reads both edits from the database;
6. **sign out → sign back in** returns the same persisted records (1 card, not 2);
7. nothing from the ledger is kept in `localStorage`/`sessionStorage` (P25 audit — `sessionStorage` is empty and no client name/label appears in either store);
8. a **second account** (P18) never sees the edited names, and sees **zero** `Edit client` / `Edit details` affordances;
9. **real concurrency**: two tabs on one account — the stale tab is refused with "changed while you were editing", keeps its typed value, shows no SQLSTATE/policy text, creates no second row (`.client-row` count 1), and the newer save is not silently lost;
10. resubmitting after a refusal saves exactly once and duplicates nothing.

Persistence through a *fresh repository instance* (P16) is separately proven without React state in `tests/stage4-local-repository-edit.test.ts`, which constructs a second `SupabaseClientRepository()` and reads the edit back.

## 5. Baseline discipline (P3)

Before any Stage 4 code, the Stage 2 and Stage 3 batteries were run on `bfb35cd` and passed at their recorded counts, so no authorization/security regression was inherited into this stage. The Stage 3 cross-tenant matrix (110 checks), its pgTAP structure/privilege files, and both browser suites were then re-run at the end (§4) and still pass — cross-tenant attacks remain regression, per P10.

## 6. Defects found and repaired (each with before → after evidence)

**D-S4-1 — `read()` was a write.** `SupabaseDashboardRepository.read()` called `markDuePromisesBroken()` internally, so every "refresh" performed a database mutation while the name and the security contract asserted a read. Fixed by extracting `settleDuePromises()` and calling it explicitly before `read()` in `Home.tsx`; `tests/security-contract.test.ts` was updated (not removed) to pin the new shape and `pnpm test` re-run to confirm the RED→GREEN transition.

**D-S4-2 — the Stage 3 fixture purge left history immutability disarmed.** Its `afterAll` ran `disable trigger` on five guards (`activities_immutable`, `payments_immutable`, `promise_events_immutable`, `promises_guard_history`, `purchase_claims_protect_workflow`) inside one transaction and committed **without re-enabling them** — `git show HEAD:tests/stage3-local-rls.test.ts | grep -c "enable trigger"` → `0`, while the adjacent comment already claimed it "re-enables them before committing". After the repair, measured live after two full-suite runs: all five `tgenabled = 'O'`, and the Stage 4 repository suite now asserts `4/4` enabled triggers in its own `afterAll` so a future purge cannot go quiet.

**D-S4-3 — demo fixture identifiers shipped in the production bundle.** The new `tests/production-module-graph.contract.test.ts` walks the real import graph from `main.tsx`, then scans every built asset: `"Arjun Mehta"`, `"Nova Media"`, `"NM-042"` were present in the bundle because UI **placeholders** repeated demo names. Placeholders rewritten to neutral copy; the test now asserts the identifiers exist in `demo.ts` (non-vacuous) and appear in **zero** shipped assets, and separately that no production module references `DemoState`/`DEMO_TODAY`/`createDemoState`.

**D-S4-4 — a conflict and a foreign-record refusal were indistinguishable from any other failure.** `userFacingDataError` took only a message, so `40001` (stale token) rendered as a generic "could not save" and a `P0002` refusal risked quoting server wording. Now code-aware with unit tests for both, including a no-leak assertion over three real raw Postgres strings.

**D-S4-5 — refresh/selection churn (P19).** Selection is updated through functional updaters that keep the current id when it still exists and only then fall back, so a refresh after an edit neither jumps the user's selection nor duplicates rows; asserted statically in the repository-boundary contract and behaviourally in the browser (single card after reload and after relogin).

## 7. What Stage 4 does **not** claim

- No offline mode, no sync engine, no caching layer, no pagination, no background refresh (P27 explicitly did not add infrastructure).
- No delete, archive-from-UI, restore, or client re-parenting.
- No due-date editing, and therefore no re-grading of promises.
- No claim that sub-second clock behaviour is understood (§8), and no claim of hosted-environment qualification — everything here is the repository's own local Docker stack.
- No UI redesign; Quiet Ledger typography, rules and state colors were reused.

## 8. `PGRST303` STATUS

**Signature.** `PGRST303 — JWT issued at future`, raised by PostgREST while validating the token, before any table, policy or grant is consulted.

**Production code changed to mask it? NO.** Nothing in this stage adds a sleep, a retry, a wait-for-settle, a JWT leeway change, or an assertion weakening. `supabase/config.toml` is untouched (absent from `git status`); the affected tests' timeouts and assertions are unchanged; no `PGRST303` catch or suppression exists anywhere in `client/` or `tests/`.

**Measured frequency in this qualification window.** Nine full-suite `pnpm test` runs: **4 failed, 5 passed**. Each failure carries the same signature and was captured, not assumed:

| Run | Result | Captured first cause |
| --- | --- | --- |
| after replay #1 | 7 failed \| 137 passed \| 125 skipped | (tail only; same file set as the reproduction below) |
| immediate rerun | 268 passed \| 1 skipped | — |
| replay #2 + suite (`run_cold.log`) | 7 failed \| 137 passed \| 125 skipped | `stage4-local-edit-workflows`: `alpha create_client failed: expected { code: 'PGRST303', … } to be null`; `stage3-local-rls` aborted in bootstrap: `profile row missing for alpha: JWT issued at future`; `stage4-local-repository-edit`: `create` threw the *mapped* copy "We could not save that change. Please try again.", leaving `ownedId = ""`, so its four downstream failures ("Choose the client you want to edit.", `undefined.name`) are cascades, not independent defects |
| pair attempt 1 | 9 failed \| 259 passed \| 1 skipped | `stage2-local-foundation.test.ts` hit the same `PGRST303` — which is the point: it strikes whichever test holds the token at that moment, exactly as Stage 3 recorded |
| pair attempt 2 / instrumented reruns | 268 passed \| 1 skipped | — |

The mandated final pair (§4) was taken consecutively after the diagnosis, with no test changed between runs.

**New measurement this stage — the missing observation Stage 3 asked for.** Stage 3 recorded that "the sub-second skew itself was never captured" and left an open item to sample container clocks at sub-second resolution during a failure window. A continuous in-VM sampler (`generate_series(1,2000000)` over `clock_timestamp()`, microsecond resolution, 29 successful samples, **45.1 s of contiguous coverage**) caught **one backwards step of 6.026 ms** in the VM's `CLOCK_REALTIME` (`backwards=1 minstep=-0.006026`, window `1790375549.852058 → 1790375551.118997`). Direction is therefore **no longer hypothetical**: time in this stack does move backwards, which is the necessary condition for a token whose whole-second `iat` validates as being in the future. Two limits are stated as limits, not conclusions:
- the observed magnitude (6 ms) is far smaller than the several-hundred-ms `iat` headroom Stage 3 measured, so a step that size rejects only tokens minted inside a few-millisecond sliver — consistent with intermittency, insufficient as a full explanation;
- this particular step landed inside a **green** run, and the sampler's own log shows the DB container being recreated mid-window (the `db reset` in progress), so it does not tie a backwards step to a specific rejection.
The PostgREST container remains distroless (`date` and `sh` absent), so its clock is observable only through response headers at one-second resolution. **Status: mechanism narrowed, direction observed, root cause still not proven.** It stays documented and OPEN; it is not "fixed", not "the VM clock, proven", and not "an unknown flaky test".

**What this intermittency is NOT.** It is not an authorization, privilege or Stage 4 edit-path result: it fails identically in the Stage 2 foundation suite, it is raised before any policy is evaluated, and every failing assertion is a token validation, not a data visibility denial. Treating it as a Stage 4 defect would be wrong; hiding it would be worse.

## 9. Environment notes that affected the runs

- Replaying four times for §4 legitimately re-created the DB container and restarted services; elevated `PGRST303` frequency clustered in those windows (§8).
- `supabase_vector_dueweave` was observed in a restart loop during this window (`Restarting (0) 27 seconds ago`) and `analytics` was cycling with it. Nothing in Stage 4 reads the analytics pipeline, so no action was taken; recorded because a crashing co-resident container is part of the honest picture of this stack. The unrelated `s2types` container was never touched.
- Residual local state after the final gates: 4 throwaway `@dueweave.local` accounts (2 Stage 2 browser journeys + 2 recovery-smoke) and 2 ledger rows, all loopback-only, all created through the UI. The Stage 3/Stage 4 suites purge their own fixtures; the Stage 4 browser accounts were swept by the unit suites' `stage4-%` purge. `pnpm db:reset:local` clears everything.
- CLI 2.117.0 is installed and 2.118.0 is advertised; it was **not** upgraded, since a toolchain change mid-qualification would invalidate the recorded baselines.
- The generated types file is checked in with LF endings; Git reports CRLF-normalisation warnings on four files (`finance.rules.test.ts`, `database.generated.ts`, `stage3_02_privileges.sql`, `stage3-local-rls.test.ts`). `git diff --check` reports no whitespace errors.

## 10. Caveats

1. Qualification is against the repository's own local Docker stack. Hosted Supabase, its GoTrue version, its clock discipline and its advisor set are untested here.
2. The Stage 4 browser spec was green 2/3 times; its one failure (a single test, 7 blocked behind it) did **not** reproduce even when deliberately preceded by a zero replay, so it is recorded as unreproduced with its artifact lost to the next run's cleanup — not attributed with confidence to §8, though its position (immediately after container restart) matches that window.
3. Concurrency was qualified with two tabs in one browser context (the ordinary way a person holds a stale copy). Two different devices/browsers were not tested.
4. `expectedUpdatedAt` is only as strong as the read that produced it. A caller that deliberately sends a token it does not own is not the threat this defends against; owner scoping is.
5. Advisor cleanliness is a point-in-time result on a two-row local dataset; it is not a load test. Plan/index sanity was checked against the existing `clients_pkey`/`receivables_pkey` and owner indexes with `enable_seqscan = off`, on a dataset far smaller than any real ledger.
6. The immutability-trigger repair (§6 D-S4-2) fixes the *test* purge. A production code path that ever needs `disable trigger` would still need its own restore discipline.

## 11. Files delivered

Modified (17): `client/src/types/domain.ts`, `client/src/types/database.generated.ts`, `client/src/lib/finance.ts`, `client/src/lib/finance.test.ts`, `client/src/lib/finance.rules.test.ts`, `client/src/data/supabase-adapters.ts`, `client/src/data/supabase-adapters.test.ts`, `client/src/data/supabase-client-repository.ts`, `client/src/data/supabase-receivable-repository.ts`, `client/src/data/supabase-dashboard-repository.ts`, `client/src/data/demo.ts`, `client/src/components/finance-ui.tsx`, `client/src/components/sheets.tsx`, `client/src/pages/Home.tsx`, `tests/security-contract.test.ts`, `tests/stage3-local-rls.test.ts`, `supabase/tests/stage3_02_privileges.sql`.

New (10): `supabase/migrations/20260814170000_current_stage4_persistent_edits.sql`, `supabase/tests/stage4_01_edit_routines.sql`, `client/src/lib/business-clock.ts`, `client/src/lib/business-clock.test.ts`, `tests/repository-boundary.contract.test.ts`, `tests/production-module-graph.contract.test.ts`, `tests/stage4-local-edit-workflows.test.ts`, `tests/stage4-local-repository-edit.test.ts`, `e2e/stage4-local-persistence.spec.ts`, this report.

Delivered by one commit on `current-stage-4-persistence-crud`, pushed with a normal (non-force) push using per-command author identity, no `git config` change, and **no pull request opened or modified**.

---

DO NOT START STAGE 5.
DO NOT MERGE ANY PR.
