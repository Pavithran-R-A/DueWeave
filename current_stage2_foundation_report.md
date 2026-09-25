# DUEWEAVE CURRENT-ROADMAP STAGE 2 FOUNDATION REPORT

Repository: `Pavithran-R-A/project-ar1`
Scope: Supabase / Auth / Data foundation — full **local** qualification.
This report supersedes nothing. `stage2_final_report.md` is the older staging scheme's
history and is left untouched.

## Declaration

Every database and Auth action in this stage ran against the Supabase local Docker
stack on this machine. No hosted Supabase project was created, listed, linked,
repaired, paused, reset or migrated. `supabase link`, `supabase db push`,
`db reset --linked` and `gen types --project-ref` were never run, and `supabase status`
reports `Not linked.`

All destructive database commands in scripts and transcripts are explicitly
`--local`. `supabase stop` has no `--local` flag because it only ever acts on the
local project; that was verified against the CLI's help output before use.

No service-role key, secret key, database password or generated local credential is
recorded in this report, in source, or in any committed file. The local anon key was
used transiently by tests and is never written into source.

## Toolchain actually used

| Component | Version |
| --- | --- |
| Supabase CLI | 2.117.0 (project-local devDependency, no global install) |
| Docker | 29.7.2 (build a7dcaa6), linux/x86_64 engine |
| Node | v24.21.0 |
| pnpm | 10.4.1 (`packageManager` pinned) |
| Git for Windows | 2.55.0 |
| Playwright | 1.62.1, `chromium-1234`, Desktop Chrome 1280x720 |
| Postgres | Supabase local `public.ecr.aws/supabase/postgres:17.6.1.167` |
| Mail catcher | Mailpit `v1.30.2` at `http://127.0.0.1:54324` |

Local stack addresses: API `http://127.0.0.1:54321`, Postgres `127.0.0.1:54322`,
Studio `http://127.0.0.1:54323`, Mailpit `http://127.0.0.1:54324`.
`imgproxy` and the connection pooler report as stopped services; neither is required
by Stage 2 and nothing was asserted against them.

## Reproducibility: migrations replayed from zero

Three full `supabase db reset --local --yes` runs were performed — two on a warm
stack and one after a cold `supabase stop` / `supabase start` cycle.

| Run | Result | Migrations applied | Exit code |
| --- | --- | --- | --- |
| Reset #1 (fresh stack) | PASS | 13 | 0 |
| Reset #2 (warm stack) | PASS | 13 | 0 |
| Reset #3 (after cold stop/start) | PASS | 13 | 0 |

All 13 committed migrations were applied in filename order with no failure, no
retry and no warning other than `WARN: no files matched pattern: supabase/seed.sql`
(`supabase/seed.sql` does not exist, so no data is seeded).

The version history was read from the executed database rather than from filenames:
`supabase_migrations.schema_migrations` contains **13 rows** (columns
`version, statements, name`). After reset #3 the same table again held 13 rows while
`auth.users` and `public.profiles` held 0 rows, proving the databases were genuinely
rebuilt rather than reused.

First migration: `20260812150500_secure_foundation.sql`
Final migration: `20260814110000_stage4_2a_live_payment_gate.sql`

Full applied sequence:

```
20260812150500_secure_foundation.sql
20260812151500_stage2_schema_alignment.sql
20260812155500_revoke_public_rpc_execution.sql
20260812160500_revoke_unused_delete_rpc.sql
20260812170000_stage3_core_workflows.sql
20260813030000_stage4_founder_monetization.sql
20260813030500_stage4_harden_admin_helpers.sql
20260813031000_stage4_fix_pending_claim_return_types.sql
20260813031500_stage4_drop_legacy_draft_reference_constraint.sql
20260813032000_stage4_allow_cancelled_empty_reference.sql
20260814090000_stage4_1_founder_claim_reconsideration.sql
20260814100000_stage4_2_payment_readiness_gate.sql
20260814110000_stage4_2a_live_payment_gate.sql
```

**No migration file was created, modified, renamed, reordered or rewritten in this
stage.** The inherited migration chain replayed cleanly, so the "stop and report
BLOCKED rather than rewrite database history" condition never arose.

## Executed schema qualification

Inspected through `supabase db query --local` against the database produced by reset
#3. These are live catalog readings, not grep results.

Object totals: 13 tables, 13 primary keys, 23 foreign keys (all `convalidated =
true`), 52 CHECK constraints, 33 indexes, 20 triggers on public tables, 36 functions,
15 row-level-security policies. Row-level security is enabled on **all 13 tables**
and is not `FORCE`d on any of them.

Core Stage 2 tables and their executed shape:

| Table | PK | Identity/ownership | Money | Dates | Status CHECK |
| --- | --- | --- | --- | --- | --- |
| `profiles` | `id` | `id` → `auth.users(id)` ON DELETE CASCADE | — | `created_at`, `updated_at` (timestamptz) | `plan IN ('FREE','FOUNDER')` |
| `clients` | `id` | `owner_id` → `profiles(id)` CASCADE | — | `created_at`, `updated_at`, `archived_at` | name length 1–160 |
| `receivables` | `id` | `owner_id` → `profiles` CASCADE; `client_id` → `clients` RESTRICT | `amount_due_paise bigint`, `outstanding_paise bigint` | `due_date date` | 5-value status + `receivables_financial_state_check` |
| `promises` | `id` | `owner_id` → `profiles`; `receivable_id` → `receivables` | `promised_amount_paise bigint > 0` | `promised_date date`, `resolved_at` | 6-value status; `sequence_no > 0` |
| `payments` | `id` | `owner_id` → `profiles`; `receivable_id` → `receivables` | `amount_paise bigint > 0` | `paid_on date` | `method IN ('UPI','BANK_TRANSFER','CASH','OTHER')` |
| `activities` | `id` | `owner_id` → `profiles`; nullable `client_id`/`receivable_id`/`promise_id` | `amount_paise bigint` NULL-or-`>0` | `occurred_at timestamptz` | 7-value type + metadata allowlist |
| `promise_events` | `id` | `owner_id` → `profiles`; `promise_id`, `receivable_id` | — | `occurred_at timestamptz` | `to_status`/`from_status` 6-value; `actor_type` |

Money storage is integer paise, proven by type rather than by inference: the executed
database holds **7 `bigint` columns whose names end in `paise`** and **0 columns of
type `numeric`, `real`, `double precision` or `money` anywhere in `public`**. Dates
that represent an India business day are `date`, not timestamps.

`profiles.id → auth.users.id` exists as intended, as a validated foreign key with
`ON DELETE CASCADE`. `profiles.id` correctly has **no column default** — the value is
supplied by the account-creation hook.

Business-profile fields from the alignment migration are present with executed
defaults: `display_name text NOT NULL DEFAULT ''`,
`business_name text NOT NULL DEFAULT ''` (`<= 160`),
`timezone text NOT NULL DEFAULT 'Asia/Kolkata'` (1–64),
`currency text NOT NULL DEFAULT 'INR'` with `profiles_currency_check` pinned to
`'INR'`.

Client → receivable → promise/payment relationships are coherent: every financial
child carries both its own `owner_id` and a parent foreign key, so ownership is
reachable from either side, and `promises` carries a
`UNIQUE (receivable_id, sequence_no)` index that makes promise sequencing a
database invariant rather than a UI rule.

Inherited tables inventoried and intentionally left in place: `entitlements`,
`purchase_claims`, `founder_admins`, `founder_audit_events`,
`founder_offer_config`, `analytics_events`. `founder_admins`,
`founder_audit_events` and `founder_offer_config` have RLS enabled and **zero
policies**, so they are unreadable through the browser and reachable only through
the security-definer review functions.

Enforcement behaviour was read from the live catalog, not from SQL text:
`on_auth_user_created` fires `public.handle_new_user()` (SECURITY DEFINER,
`SET search_path TO 'public', 'auth', 'pg_temp'`) which inserts both the `profiles`
and `entitlements` rows. Twenty triggers enforce immutability
(`payments_immutable`, `activities_immutable`, `promise_events_immutable`), history
guarding (`promises_guard_history`, `receivables_guard_financial_fields`), ownership
(`assert_owned_client`, `assert_owned_receivable`, `assert_activity_ownership`),
the Free-plan ceiling (`receivables_free_limit`, advisory-locked per owner, raising
at 3 active receivables) and self-service entitlement protection
(`profiles_prevent_plan_change`).

### Negative-paise probe (rolled back, nothing persisted)

A single atomic statement that creates a client and immediately inserts a receivable
of `-100` paise produced:

```
ERROR: new row for relation "receivables" violates check constraint
       "receivables_amount_due_paise_check"
```

Because the statement failed, the whole transaction aborted. The follow-up count
query returned `receivables = 0`, `clients = 0`, so the probe left no residue. The
same query confirmed the probe user's auto-created profile:
`plan = FREE`, `display_name = 'Phase Seven Probe'`, `currency = INR`,
`timezone = Asia/Kolkata`, `business_name = ''`.

## Auth and profile integration (executed)

`tests/stage2-local-foundation.test.ts` runs 12 ordered checks against the live local
stack using only the browser-safe URL and anon key. It was executed after each reset
cycle and passed 12/12 every time. Coverage: signup, profile auto-creation with
`profiles.id = auth.users.id`, the executed profile defaults, the owner-only
`business_name` write and refetch, `create_client` RPC returning a row owned by the
caller, `create_receivable` rejecting a non-positive amount, the money CHECK
rejecting negative paise, all seven core tables being exposed by PostgREST, an
anonymous read of `clients` returning an empty set, session removal on sign-out, and the
logout → sign-in identity and profile persistence round trip.

Result: **12 passed, 0 failed, 0 skipped** for that file (it self-skips only when no
loopback stack is configured, which is the state CI will be in).

## Browser journey (executed)

`e2e/stage2-local-auth.spec.ts` provisions its own synthetic account through the
real UI — no admin key, no pre-seeded credentials, no `E2E_EMAIL`/`E2E_PASSWORD`.
Against `pnpm preview --port 3000 --strictPort --host 127.0.0.1` it signs up, lands
on the authenticated empty-state ledger, asserts that none of the five fictional
demo markers appear, opens the More section, signs out to `/auth`, and signs back
in. Executed three times (once per reset cycle): **1 passed, 0 failed**.

The broader `pnpm test:e2e` run produced **4 passed, 8 skipped**: the three signed-out
auth-gateway specs and the Stage 2 journey execute, while the eight authenticated
Stage 3/4 journeys remain gated on manually supplied fixtures. Those were
deliberately not enabled here — the User A vs User B cross-tenant matrix is Stage 3
work, and nothing in this report claims Stage 3 passes.

## Password recovery (executed)

`resetPasswordForEmail()` returned no error for a synthetic local account, and
Mailpit captured the generated message. Assertions made against the captured mail:
the recipient matches, the subject is `Reset your password`, and the body carries a
`/auth/v1/verify` link containing `type=recovery` whose `redirect_to` targets the
configured app route `/auth/update-password`. No external SMTP provider was involved
and none was configured or purchased. This proves the local Auth plus mail-capture
path works; it does **not** prove production email confirmation.

## Generated types and the typed client

`pnpm db:types` (`supabase gen types typescript --local --schema public`) produced
`client/src/types/database.generated.ts` — 1,214 lines, all 13 tables and 36
functions, committed to the repository.

Generation was proven deterministic three separate times. The SHA-256
`eb365f5596a93f3a85a92ad973c8fefd2c839836849aa5bf8c33211d54cf458c` was identical
after back-to-back generation, after reset #2, and after the cold
stop → start → reset #3 cycle. The file is listed in `.prettierignore` so a
`pnpm format` run cannot rewrite it and silently destroy that proof.

`client/src/lib/supabase.ts` is now `createClient<Database>(...)`. Type generation
surfaced exactly one genuine mismatch: `record_payment` was being called with
`p_note: null`, while the generator emits defaulted parameters as
`p_note?: string`. The fix was to stop passing the argument;
`pg_get_function_arguments` confirms `p_note text DEFAULT NULL::text`, so the
omitted argument is behaviour-identical. No `any`, no cast, no `@ts-ignore`, and no
suppression was used anywhere; `pnpm check` is clean.

## Environment contract

`.env.example` documents the two names with placeholder values only, plus an explicit
warning that service-role keys, `sb_secret_*` values and database passwords must
never be placed in a `VITE_*` variable.

`scripts/local-supabase-env.mjs` reads `supabase status --output json`, accepts
`API_URL` and `ANON_KEY`, refuses to write anything unless the host is loopback
(unless deliberately overridden), writes only those two keys to `.env.local`, and
prints the key as a description instead of its value. `.env.local` and
`supabase/.temp/` are gitignored; `.env.example` is deliberately not ignored and
that distinction is asserted by a test.

One real Windows defect was found and fixed here: Node refuses to spawn a
`node_modules/.bin/*.cmd` shim without a shell (`spawnSync ... EINVAL`, the
CVE-2024-27980 mitigation). The helper now invokes the CLI's Node entry point with
`process.execPath`, which is also correct on Linux and macOS. It also had to skip the
CLI's `Stopped services:` preamble that precedes the JSON payload.

## Privileged-credential and demo boundaries

`tests/credential-boundary.contract.test.ts` (4 tests, all passing) proves that
`client/src/lib/supabase.ts` reads exactly `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` and never touches `process.env`; that no browser source file
contains a service-role reference, a `sb_secret_*` value, a privileged database
credential or a JWT literal; that generated environment state stays untracked; and —
since `dist/` now exists after a real build — that the production bundle carries no
privileged material.

The bundle check needed a honest design decision rather than a loophole. A Vite build
inlines the anon key, which *is* a JWT, so a pattern-only scan would flag
intentional browser-safe configuration. The source scan keeps the JWT pattern, and the
bundle scan instead asserts that every JWT-shaped literal in `dist/` equals the
configured anon key value — which still catches a stray service-role token while
not demanding that the anon key be absent.

`tests/demo-boundary.contract.test.ts` (3 tests, passing) proves no production
`client/src` file imports `client/src/data/demo.ts`, that `DEMO_TODAY` appears only
inside the fixture file itself, and that the scan actually covered more than 20 files
so an accidentally empty traversal cannot pass.

Two false-positive risks were resolved by tightening patterns instead of deleting
checks. `sb_secret_` and `sb_publishable_` occur as bare key-prefix literals inside
`@supabase/supabase-js`, so the credential patterns now require real key length. That
discovery came from an actual `dist/` match, and the matching bytes were inspected
before changing anything.

## Quality gates

| Gate | Command | Result |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | PASS (951 ms, pnpm 10.4.1) |
| Lint | `pnpm lint` (ESLint 10 flat, `--max-warnings=0`) | PASS |
| Typecheck | `pnpm check` (`tsc --noEmit`) | PASS |
| Tests | `pnpm test` | 95 passed, 0 failed, 1 skipped (96 total, 11 files) |
| Build | `pnpm build` | PASS (462.11 kB main JS, 58.77 kB CSS, built in 7.7 s) |
| Production audit | `pnpm audit --prod --audit-level=high` | No known vulnerabilities |
| Worktree hygiene | `git diff --check` | clean |

The single skip is `tests/supabase.public-config.live.test.ts`, which targets a hosted
`*.supabase.co` project and cannot pass without one.

`pnpm audit --audit-level=high` over dev dependencies reports 38 inherited advisories
in the Vite/Vitest toolchain (vite, esbuild, rollup, vitest, @vitest/mocker,
browserslist, postcss, picomatch, tar, @babel/core,
baseline-browser-mapping). None reaches the production graph, and the word "supabase"
appears zero times in the audit output, so the newly pinned CLI added no advisory.
Resolving dev-toolchain advisories is not Stage 2 scope.

## Files changed

Modified: `.gitignore`, `.prettierignore`, `README.md`, `package.json`,
`pnpm-lock.yaml`, `supabase/config.toml`,
`client/src/lib/supabase.ts`,
`client/src/data/supabase-payment-repository.ts`,
`tests/supabase.public-config.live.test.ts`.

Added: `.env.example`, `scripts/local-supabase-env.mjs`,
`client/src/types/database.generated.ts`,
`tests/stage2-local-foundation.test.ts`,
`tests/credential-boundary.contract.test.ts`,
`tests/demo-boundary.contract.test.ts`,
`e2e/stage2-local-auth.spec.ts`, this report.

Migrations added: none. Migrations modified: none.
`pnpm-lock.yaml` is purely additive (131 inserted lines, 0 removed): the pinned
Supabase CLI and its per-platform binaries.

Package scripts added: `supabase:start`, `supabase:stop`, `supabase:status`,
`db:reset:local`, `db:types`, `test:stage2`, `test:e2e:stage2`, `verify:stage2`.
`verify:stage2` chains reset → types → executed contract tests and intentionally
excludes the browser spec, because the Playwright config has no `webServer` and an
unstarted preview server would make a chained script fail for the wrong reason.

## Deliberate disclosures

- **`tests/supabase.public-config.live.test.ts` was re-scoped, not weakened.** Its
  gate previously matched any `VITE_SUPABASE_URL`; once a loopback `.env.local`
  existed, the hosted-only assertions would have run against local Docker and
  false-failed. The gate now requires a hosted `https://<ref>.supabase.co` shape.
  The assertion bodies are byte-for-byte unchanged, so the test is stricter about
  what it tests, not about what it demands.
- **`supabase/config.toml` `project_id` changed** from the historical hosted
  reference `dmteajorqysoenlwcmtb` to `dueweave`. That value names the local Docker
  stack; keeping a real hosted project reference made the repository look linked to
  a live project it must never touch. Grep proved no source file, test or CI
  definition depends on the old value — only the historical Stage 3/4 reports mention
  it as evidence, and those were left as written.
- `site_url` moved from `http://localhost:5173` to `http://127.0.0.1:3000`, matching
  the port the Playwright suite's own `baseURL` expects, with `localhost:3000` and
  the `/auth/update-password` route listed as additional redirects.
- **Local email-confirmation is disabled and that is documented as local-only.**
  Automated local tests receive a session without SMTP. This is not a production
  policy statement and no SMTP vendor was added.
- Signup is enabled; anonymous sign-in, social providers and SMTP credentials were
  not enabled or added.
- The 8 authenticated browser specs remain gated and unexecuted; enabling them is
  Stage 3 work.
- Git identity is not configured in this environment and was not configured in
  this stage; the commit carries explicit author/committer environment values.

## Environment notes (reproducibility caveats)

The host system drive was at 100% utilisation (about 1–2 GB free) during the first
`supabase start`. Image pulling stalled twice. Recovery steps taken:

- `docker builder prune -f` reclaimed **8.599 GB** of regenerable build cache. No
  image, container or volume was deleted.
- One registry layer failed with `error from registry: Your Authorization Token is
  invalid.` for `public.ecr.aws/supabase/postgres:17.6.1.167`; a direct
  `docker pull` of that tag completed and the CLI resumed, then finished with exit 0.
- The documented fallback of disabling Studio in `config.toml` was **not needed**;
  Studio ran and all 12 stack containers came up healthy.

Twelve `supabase_*_chat-1` containers and one `softbazzar-backup-verify-*` container
from unrelated projects exist on this machine and were deliberately left untouched.
A new `project_id` also guarantees this stage's containers cannot collide with them.

## Known limitations

1. No CI evidence. GitHub's account-level Actions billing/spending condition still
   prevents a runner from starting. Local gates are the only quality evidence.
2. No hosted Supabase project has been provisioned or qualified, so nothing here
   demonstrates hosted Auth configuration, SMTP-delivered confirmation, real
   PostgREST connection behaviour, or deployed-environment routing.
3. Nothing is deployed; the application remains a source-only repository.
4. Local paise columns are typed `number` by the generator. That is safe today
   because the RPC ceiling (`900000000000000`) is two orders of magnitude below
   `Number.MAX_SAFE_INTEGER`, but it is a documented dependency rather than a
   database-enforced one.
5. Two inherited oddities were observed and deliberately not touched, because they
   are Stage 4 concerns and correcting them would mean rewriting history:
   `purchase_claims.amount_paise` carries `DEFAULT 0` alongside a `> 0` CHECK, and
   its `claim_id` default is a UUID string while a later CHECK enforces a
   `^DW-F-[A-Z0-9]{8,32}$` format. Both are invisible through the RPC path used in
   production code, and were not exercised by any Stage 2 test.
6. Row-level-security cross-tenant isolation was verified only as far as Stage 2
   allows: RLS is enabled on all 13 tables, anonymous reads return nothing, and no
   INSERT policy exists on `receivables`/`promises`/`payments`. The User A versus
   User B matrix is explicitly Stage 3.

## Exit criteria

| # | Criterion | Result | Basis |
| --- | --- | --- | --- |
| 1 | A fresh environment reproduces the database from the repository's migrations | **PASS** | 3 resets (one after a cold stack restart), 13/13 migrations each, 13 rows in `schema_migrations`, no migration file touched |
| 2 | A real user can sign up and sign in against that reproduced environment | **PASS** | 12 executed contract tests plus the browser journey, each re-run after every reset |
| 3 | The Auth user receives the correct DueWeave profile/business foundation | **PASS** | `handle_new_user()` read from the live catalog; `profiles.id = auth.users.id` FK validated; executed defaults `FREE`/`INR`/`Asia/Kolkata`; `business_name` writable and durable |
| 4 | Sign-out and sign-in preserve the user's identity and profile | **PASS** | Executed logout → re-login test returns the same UUID and the same persisted profile row |
| 5 | No privileged key is required by the browser | **PASS** | Only two `VITE_*` names read in source; no secret/service-role/JWT in `client/src`; bundle-level JWT equality check; helper refuses to write non-loopback or secret values |

## Verdict

**FINAL CURRENT-ROADMAP STAGE 2 VERDICT: PASS**

All five exit criteria are proven by execution, not by source inspection. The local
Supabase stack is a reproducible foundation: any developer who can run Docker can
clone this branch, run the documented chain, and reproduce the same schema, the same
generated types hash, the same 12 executed contract tests and the same browser
journey.

**NEXT ROADMAP STAGE: Stage 3 — RLS and authorization.**
Stage 3 must build the cross-user authorization matrix that Stage 2 deliberately did
not attempt. Stage 3 is **not** claimed to pass. Two external conditions must be
resolved by the owner before any launch, independent of Stage 3: the GitHub Actions
billing condition that blocks CI evidence, and provisioning a hosted Supabase project.

DO NOT START STAGE 3.
DO NOT MERGE ANY PR.
