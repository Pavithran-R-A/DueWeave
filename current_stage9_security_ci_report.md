# Stage 9 — Security / Testing / CI / Release-Gate Qualification (authoritative report)

STATUS: **BLOCKED**

Every gate this stage could execute locally is green, measured and reproduced. The one gate the
brief makes non-substitutable — a real GitHub Actions run on the delivered head — cannot execute
for a reason that is not in this repository: GitHub refused to allocate a runner to the account,
and the plan's own rule closes the stage as BLOCKED for exactly that case
("If GitHub Actions cannot execute: STATUS = BLOCKED even if all local gates pass"). Nothing in
this file claims hosted verification. Where a number could not be measured, it says so.

---

## Delivery identity

| Field | Value |
| --- | --- |
| STARTING SHA | `ccc44382…` (`ccc4438`, the accepted Stage 8 head "fix: align Founder readiness at every boundary") |
| ENDING SHA | Executable head `c682827eedc71f873ba523fd14c27f1ee81538f1` — no file CI would run changes after it. The documentation surface landed as `99c120f528a86af2f46b9e42cbbfc30fd6b5bdd5` (nine docs paths, 1519 insertions / 36 deletions), and one further forward docs-only commit corrects this file's CI section with the run that head itself produced. A commit cannot quote its own SHA, so the branch head is authoritative by `git ls-remote origin refs/heads/current-stage-9-security-ci`, which was verified after each push. |
| BRANCH | `current-stage-9-security-ci` (pushed to `origin`, tracking set, `main` untouched) |
| Commit chain | `ccc4438` → `cbd423d` *ci: qualify DueWeave release candidate* → `c682827` *test: consolidate release security gates* → `99c120f` *docs: close Stage 9 security qualification* → final docs correction |
| Forward-only | No amend, no rebase, no force-push, no rewrite of `ccc4438` or any earlier commit. Verified with `git reflog` and `git log --oneline -4`. |
| Migration policy | Forward-only. **Zero** migration files added, edited or deleted by Stage 9 (`git diff ccc4438 HEAD -- supabase/migrations` is empty) — the schema this stage qualified is the schema Stage 8 delivered. |
| Generated types | `client/src/types/database.generated.ts` unchanged in content versus `ccc4438` (`git diff --numstat` empty; the `M` flag on this host is the `core.autocrlf=true` phantom, and `scripts/verify-types-drift.mjs` normalises CRLF so line endings cannot fake a drift). |

## CI

| Field | Value |
| --- | --- |
| CI DESIGN | Three jobs with unique, human-meaningful check names, each a different environment class, so that a required-status-check rule can name them individually and a job that omits a gate cannot present itself as a job that ran it. `browser` depends on `static` and `database`; the workflow is secret-free by design (it receives no Supabase credentials, no privileged key, no payment credential). The database and browser jobs replay the **committed** migrations onto a disposable loopback Supabase started by a composite action rather than trusting a recorded schema. |
| CI WORKFLOW FILES | `.github/workflows/ci.yml` (154 lines changed, 129 added / 25 removed); `.github/actions/setup-toolchain/action.yml` (new, 23 lines); `.github/actions/local-supabase/action.yml` (new, 34 lines). No other workflow file exists in the repository. `main` carries **no** CI workflow at all (`git show main:.github/workflows/ci.yml` → "path exists on disk, but not in 'main'"), so the workflow ships *with* this branch. |
| CI RUN IDS | `36533797727` (`event: push`, workflow `CI`, attempt 1, head `c682827…`, created 06:57:00Z) and `36535054827` (`event: push`, workflow `CI`, attempt 1, head `99c120f…`, created 07:10:11Z) — one run per pushed head, both observed to completion. Compared against history: `36062418596` (2026-09-24, `pull_request`, head `1bb2f38`) and the last run that executed anything, `31825803438` (2026-08-14T17:49:47Z, head `6d99651`, `success`). |
| CI HEAD SHA | `c682827eedc71f873ba523fd14c27f1ee81538f1` for the first run — read back from the remote, not from local state: `git ls-remote origin refs/heads/current-stage-9-security-ci` returned the same value the API reports as that run's `head_sha`. The docs-closure head `99c120f528a86af2f46b9e42cbbfc30fd6b5bdd5` is the branch head now, verified the same way. **This file cannot carry the CI result of its own final SHA**: delivering that result would need another commit, which moves the head again. The operator reads the current head's run with `gh api repos/Pavithran-R-A/project-ar1/actions/runs?per_page=1`; the two most recent heads are recorded below and were identical in shape. |
| CI JOBS | `Static verification` (`static`), `Database contracts` (`database`), `Browser release smoke` (`browser`). |
| CI RESULTS | Run `36533797727`: `Static verification` **failure** (06:57:00Z→06:57:02Z), `Database contracts` **failure** (06:57:00Z→06:57:02Z), `Browser release smoke` **skipped** (06:57:03Z). Run `36535054827`: `Static verification` **failure** and `Database contracts` **failure** (both 07:10:12Z→07:10:14Z, `runner_id: 0`, `steps: []`), `Browser release smoke` **skipped** (07:10:14Z). No job of either run executed a single step. |

### Why the run failed — GitHub's own words, measured

`GET /repos/…/actions/runs/36533797727/jobs` reports for both failed jobs: `runner_id: 0`,
`runner_name: ""`, `runner_group_id: 0`, `steps: []`. The check annotation on each
(`GET /repos/…/check-runs/109293164919/annotations`) reads verbatim:

> The job was not started because recent account payments have failed or your spending limit
> needs to be increased. Please check the 'Billing & plans' section in your settings

`GET …/actions/jobs/109293164919/logs` → `404 BlobNotFound`: no log blob exists, which is
consistent with a job that never started rather than a job whose log expired.

The docs-closure head reproduced it exactly. For run `36535054827`, jobs `109297080816`
(`Database contracts`) and `109297081054` (`Static verification`) each carry `runner_id: 0`,
`steps: []` and this annotation, byte-identical to the earlier one:

> The job was not started because recent account payments have failed or your spending limit
> needs to be increased. Please check the 'Billing & plans' section in your settings

So the refusal is stable across two heads five minutes apart and is not a transient allocation
failure, and neither result is a signal about this repository's contents.

The same annotation, and the same `runner_id: 0` / `steps: []` shape, is on run `36062418596`
from 2026-09-24 — which means the sentence this report's draft docs previously drew from that run
("Actions itself is working on this account; that failure was the old workflow file") was
**false**, and `docs/PR_INTEGRATION_PLAN.md` has been corrected forward-only to record the
measurement. A job with no steps never read the workflow file, so its conclusion says nothing
about workflow contents.

Repository-side settings were checked and are not the cause:
`GET /repos/…/actions/permissions` → `{"enabled": true, "allowed_actions": "all",
"sha_pinning_required": false}`. The account's actual spending state is **UNKNOWN from here**:
`GET /users/Pavithran-R-A/settings/billing/actions` requires the `user` OAuth scope, which this
token does not hold (`gist, read:org, repo, workflow`), and no billing setting was read, changed
or attempted by this stage. Whether it is a failed payment, an exhausted included-minutes quota or
a spending limit set to zero is for the account owner to determine in Settings → Billing; this
report claims only that GitHub refused the runner and said so in those words.

| Field | Value |
| --- | --- |
| STATIC JOB | **failure, 0 steps, no runner.** What a green run of it would prove: `pnpm build`, `pnpm test:unit` (23 files / 359 tests, no database), `pnpm lint --max-warnings=0`, `pnpm check`, `pnpm verify:secrets` over the tracked tree **and** `dist/`, `pnpm audit --prod --audit-level=high`. All five of those are green locally, measured below — and that is precisely why the brief forbids substituting them. |
| DATABASE JOB | **failure, 0 steps, no runner.** Would prove: types-drift match, migration-set match, pgTAP inside a real Postgres, schema lint, the nine database-backed contract suites. All green locally. |
| BROWSER JOB | **skipped** (its `needs:` were not green). Would prove the CI release journeys and the React-warning/console gate with `retries: 0`. Both green locally. |

**PHASE 28 falsification was performed locally, not in CI,** as the brief permits ("Prefer local
workflow-equivalent falsification when sufficient"), because no CI mutation could be observed at
all while runners are refused. Two falsifications, both reverted before delivery:

1. *The retry pin bites.* With `retries` raised from `0` in `playwright.config.ts`,
   `tests/ci-gate-manifest.contract.test.ts` failed on its own gate ("`--retries`" / `retries: 0`
   assertion), and passed again after the revert — measured, gate 9 green, config back to
   `retries: 0` at `playwright.config.ts:12`.
2. *The secret scan bites, and only on real scope.* Planting a synthetic privileged-shaped
   credential first into an **untracked** file produced `exit=0` and an unchanged file count —
   which localised the scanner's real scope (tracked tree + `dist/`) rather than the whole
   directory. Re-planting into tracked `todo.md:137` produced `exit=1` naming
   `todo.md:137: HARD supabase-secret-key`, with the value masked as `sb_secret_… (30 chars)`.
   The line was then deleted, the file restored byte-for-byte to its HEAD content (`git status
   --porcelain todo.md` empty at the time of the closing gates), and `pnpm verify:secrets`
   re-measured `exit=0`. A HARD shape cannot be allowlisted at all, which is the property that
   makes the exception list rot-proof.

## Local gates (PHASE 31/32/35/36), each with a captured exit code

| Field | Measured value |
| --- | --- |
| LOCAL ZERO REPLAY | `pnpm db:reset:local` on a fresh container set: 23 "Applying migration" lines, `WARN: no files matched pattern: supabase/seed.sql`, ending `Finished supabase db reset on branch current-stage-9-security-ci.` No migration errored, so the whole schema is reproducible from committed files with no operator state. Log kept (`phase31-reset.log`, 2026-09-29 01:26). |
| MIGRATION COUNT | `pnpm verify:migrations` → "Migrations on disk: 23. Applied in the local database: 23. The replayed schema and the qualified schema are the same migration set." `exit=0`. |
| GENERATED TYPES DRIFT CHECK | `pnpm verify:types` → "client\src\types\database.generated.ts matches the local schema (38326 bytes)." `exit=0`. The gate regenerates from the running schema into a temporary string and compares without touching the working tree, so it cannot be satisfied by a stale committed file. |
| PGTAP | `pnpm test:db` → `Files=8, Tests=364 … Result: PASS`, `exit=0`, twice (01:28 and again at 12:10 in the closing set). Files: `stage3_01_rls_structure`, `stage3_02_privileges`, `stage4_01_edit_routines`, `stage5_01_lifecycle`, `stage5_02_promise_chronology`, `stage8_01_offer_readiness`, `stage8_02_payment_evidence`, `stage8_03_reviewer_boundaries`. |
| DB LINT | `pnpm db:lint` → "Connecting to local database… Linting schema: extensions / Linting schema: public / No schema errors found", `exit=0` (2026-09-29 12:4x, re-measured for closure). |

## Stage 2 – 8 live suites (PHASE 33), `pnpm test:live`, one worker, guard-first

`[live-stack-guard] qualified against http://127.0.0.1:54321 (Auth health 200)` preceded the run;
the guard is `globalSetup`, so an absent or non-loopback stack aborts before any `describe` is
evaluated. Totals: **9 files passed (9), 307 tests passed (307), 0 failed, 0 skipped, 204.82 s.**

| Field | Suites | Tests |
| --- | --- | --- |
| STAGE 2 LIVE | `tests/stage2-local-foundation.test.ts` | 12 passed |
| STAGE 3 LIVE | `tests/stage3-local-rls.test.ts` | 110 passed |
| STAGE 4 LIVE | `tests/stage4-local-edit-workflows.test.ts` + `tests/stage4-local-repository-edit.test.ts` | 14 + 7 = 21 passed |
| STAGE 5 LIVE | `tests/stage5-local-lifecycle.test.ts` | 69 passed |
| STAGE 6 LIVE | `tests/stage6-local-profile.test.ts` | 13 passed |
| STAGE 7 LIVE | `tests/stage7-local-export.test.ts` | 10 passed |
| STAGE 8 LIVE | `tests/stage8-local-founder-readiness.test.ts` | 65 passed |
| STAGE 9 LIVE | `tests/stage9-abuse-matrix.test.ts` | 7 passed |

Sum check: 12+110+21+69+13+10+65+7 = 307, matching the reported total exactly. No suite was
re-run to obtain this table; the numbers are read from the single retained log.

## Browser battery (PHASE 34), `pnpm verify:e2e:local`, `--workers=1` (the runner's default)

Executed twice: once as the Stage 9 baseline, once after repair. Same command, same worker count
as previously qualified (1), same 181 slots.

| Field | Baseline (01:47–02:07) | After repair (10:34–11:00) |
| --- | --- | --- |
| passed | 164 (33.2 m) | **173 (25.5 m)** |
| failed | 3 | **0** |
| skipped | 8 | 8 |
| did-not-run | 6 | **0** |
| timeouts | 2 test-level (30 000 ms), 1 hook (30 000 ms), 1 click (120 000 ms) | 0 |
| PGRST303 | 0 | 0 |
| console errors | 0 | 0 |
| page errors | 0 | 0 |
| unexpected request failures | 0 | 0 |

Slot arithmetic: 173 + 8 = 181 = the slots Playwright announced ("Running 181 tests using 1
worker"), and the closing run's slot numbering is 1…181 with **181 distinct ids and no
duplicates** — each test ran exactly once, which is the direct evidence that no hidden retry
occurred, independent of `retries: 0`.

Per-stage executed passes in the closing battery: Stage 2 4 (`auth-gateway` 3, `stage2-local-auth`
1), Stage 3 5, Stage 4 10, Stage 5 14, Stage 6 66 across nine specs, Stage 7 32 (`export` 13,
`followup` 19), Stage 8 21 (`founder-customer` 11, `founder-reviewer` 10), Stage 9 21
(`account-isolation` 8, `react-warnings` 3, `release-journey` 10). Total 173.

The 8 skips are not silent: they are the six host-credential-gated legacy specs
(`accessibility-smoke` 1, `auth-lifecycle-limits` 2, `core-workflow` 1, `founder-purchase` 1,
`responsive-authenticated` 1, `stage41-client-conversion` 2), classified as
[docs/TEST_SKIP_CLASSIFICATION.md](docs/TEST_SKIP_CLASSIFICATION.md) class E with a per-test
supersession map. None of the 8 is in the CI browser subset.

The CI browser subset was then re-measured alone, with the command the `browser` job runs verbatim:
`pnpm test:e2e:smoke` → `Running 79 tests using 1 worker`, `79 passed (14.2m)`, `smoke-exit=0`, and
no `failed`, `skipped` or "did not run" line anywhere in the retained log. An earlier replay of the
same 79 on this host measured 17.3 min, so `docs/RELEASE_GATE_MATRIX.md` states the range rather
than one number. Neither figure is a CI-measured duration: no job of this head's run ever started
a runner, so the 45-minute browser budget stays an estimate carried by local evidence.

| Field | Value |
| --- | --- |
| FRESH ACCOUNT RELEASE JOURNEY | `e2e/stage9-release-journey.spec.ts` — 10 tests, all passed, one fresh account signed up through the screens and driven end to end: workspace naming, first client, first invoice, a promise the client made, a partial payment that keeps the balance exact, the follow-up hand-off, the final payment, search and status tabs, the export in both shapes, the Founder page refusing unconfigured payment instructions, and a profile edit still present after sign-out and sign-back-in. |
| SECOND ACCOUNT ISOLATION | `e2e/stage9-account-isolation.spec.ts` — 8 tests, all passed: two strangers each build a ledger; each owner's authorised read finds exactly what it made; the other account's screens carry none of these words; its identifiers read as nothing table by table; its rows cannot be created, patched or paid into; claims, entitlements, review access and settings stay shut; search finds nothing across accounts, not even an exact invoice reference; its export files carry none of its records in any shape. |
| FINANCIAL JOURNEY | Stage 5 browser 14 passed (partial → kept promise, settlement, queue priority, honest history); Stage 9 release journey tests 4, 5 and 8 above re-execute the money path on the built bundle; Stage 5 live 69 tests assert the same rules where the database decides them. |
| FOLLOW-UP / EXPORT | Stage 7 browser 32 passed (19 follow-up, 13 export), including the intercepted `wa.me` link so no test reaches a real messenger, explicit contact confirmation, copy-verification, snooze bounds, and export read back byte-for-byte against the on-screen ledger. Stage 7 live export 10 tests, incl. "changes nothing at all in the ledger while producing every file". |
| FOUNDER CUSTOMER | Stage 8 browser 11 passed: no destination, QR, UPI link or copy action is shown at all until readiness is real; with a synthetic ready offer the on-screen QR is compared pixel for pixel against an independently rendered reference from the canonical payment URI; opening that link leaves the claim a draft, the account Free and the history unchanged. |
| FOUNDER REVIEWER | Stage 8 browser 10 passed: the queue is refused until one allowlist row exists; the last seat is taken once and the next review is refused as full with its claim left pending; a card another review already settled refuses as already reviewed; revoking through the reviewer's own session leaves every record and restores the limit; the screen is keyboard-operable and fits every qualified width. |
| ACCESSIBILITY | `e2e/stage6-local-accessibility.spec.ts` 8 passed, including the reduced-motion walk that this stage moved out of a permanently-skipped file (F4) and `stage8-local-founder-reviewer`'s keyboard-and-width test (18.9 s). |
| RESPONSIVE | `e2e/stage6-local-responsive.spec.ts` 5 passed (the measured 7-width matrix), plus per-width follow-up and Founder tests. |
| CONSOLE/PAGE ERRORS | 0 console errors, 0 uncaught page errors, 0 unexpected `requestfailed` across the 181-slot battery; `e2e/problem-watch.ts` fails a test on any of them, with the single documented exception being the deliberately unanswered request a test is asserting on. `e2e/stage9-react-warnings.spec.ts` 3 passed against `vite dev` (the only environment where React can emit a warning at all — production React throws minified errors). |
| ABUSE MATRIX | `tests/stage9-abuse-matrix.test.ts` 7 live tests passed inside the 307; the 20-case ledger with the executing file per case is [docs/STAGE9_ABUSE_MATRIX.md](docs/STAGE9_ABUSE_MATRIX.md). The other fifteen cases execute in the live, unit, pgTAP and browser files that ledger cites. |

## Full `pnpm test`, twice, no changes in between (PHASE 35)

| Field | Value |
| --- | --- |
| FULL TEST RUN #1 | `Test Files 32 passed \| 1 skipped (33)`, `Tests 666 passed \| 1 skipped (667)`, 217.97 s, started 12:00:44. |
| FULL TEST RUN #2 | `Test Files 32 passed \| 1 skipped (33)`, `Tests 666 passed \| 1 skipped (667)`, 208.84 s, started 12:04:38. |

Identical counts, no code or config change between them. The 1 skipped test is
`tests/supabase.public-config.live.test.ts` (class E: it addresses a hosted project and this stage
is local-only); `tests/suite-manifest.ts` excludes it from both release halves so neither can
cite it, and `pnpm test:unit` (23 files / 359) and `pnpm test:live` (9 files / 307) sum to the 32
executed files without it.

## Static gates (PHASE 36), each re-run for closure with the exit code captured in the log

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0 — "Ignored build scripts: @tailwindcss/oxide, esbuild" is a pnpm notice, not a failure; lockfile untouched |
| `pnpm lint` | exit 0 (`eslint client/src tests e2e scripts vite.config.ts --max-warnings=0`) |
| `pnpm check` | exit 0 (`tsc --noEmit`) |
| `pnpm build` | exit 0 — `✓ built in 17.70s`, largest chunk `index-*.js` 498.18 kB / 144.28 kB gzip |
| `pnpm audit --prod --audit-level=high` | exit 0 — "No known vulnerabilities found" |
| `git diff --check` | exit 0 — no whitespace errors. The 42 "LF will be replaced by CRLF" lines are this host's `core.autocrlf=true` notices, emitted on stderr, not check findings. |

## Dependency audit, stated without smoothing (PHASE 37 companion)

| Command | Measured |
| --- | --- |
| `pnpm audit --prod --audit-level=high` | **0 findings**, blocking in CI |
| `pnpm audit --prod` (no severity floor) | 2 **moderate** in the runtime graph: `react-router` open-redirect-via-backslash (GHSA-wrjc-x8rr-h8h6, CVE-2025-68470 bypass) and `deserializeErrors()` arbitrary-constructor injection (GHSA-337j-9hxr-rhxg); fixed by `react-router-dom@7.18.4`, a breaking change |
| `pnpm audit` (dev tree) | 4 moderate: the two above plus `@vitest/mocker` path traversal / arbitrary file read (GHSA-82fw-gwwq-j7x9, needs `vitest@5`, breaking) |

The two runtime findings are **not** claimed as closed. They are reachable only through SSR
hydration and `<Link>`/`useNavigate` call sites; this application is a client-rendered Vite SPA with
no SSR surface and no user-supplied navigation target, which is an argument about exposure, not a
fix. The upgrade is a dependency decision the release owner makes; CI records the dev-tree number
under `continue-on-error: true` and blocks on the production high-and-above gate. Recorded in
[docs/RELEASE_GATE_MATRIX.md](docs/RELEASE_GATE_MATRIX.md).

## SECRET SCAN (PHASE 37)

`pnpm verify:secrets` → "Scanned 228 files for 11 credential shapes. No privileged credential
found in the tracked tree or the built bundle." `exit=0`, re-measured on the docs-closure head.
Scope is the tracked tree **plus** `dist/` (208 tracked + 20 bundle artefacts; the tracked count is
227→228 between the earlier and this measurement because this report became a tracked file) — measured, not assumed, by the falsification in
PHASE 28 above. 11 shapes: `service_role` JWTs, `sb_secret_`, Supabase service keys, database
URLs, database passwords, UPI/payment secrets, private keys, and the generic assignment shapes;
the HARD subset cannot be allowlisted at all, values are reported as shape + location + length and
never as the key itself.

Added/modified lines were scanned separately for the non-credential content PHASE 37 lists. Over
`git diff ccc4438 HEAD` restricted to `+` lines, zero matches for: `upi://pay?pa=`, `sb_secret_`,
JWT-shaped `eyJ….…`, `service_role`, `postgres://user:pass@`, `support@<domain>`, and a 10-digit
numeric pattern intended to catch UTR-like values. The single hit was `6062418596` inside
`36062418596` — a GitHub run id quoted in `docs/PR_INTEGRATION_PLAN.md`, i.e. the pattern matching
an infrastructure identifier, not a payment reference. No real customer data, payment data, VPA,
UTR or support address is present; every fixture is synthetic and self-labelling (`not-a-vpa`,
`a@b`, `merchant@`, `@upi`, `x@y@z`, account emails on `example.test`-style local parts,
workspace/client names that read as placeholders). No `.env`, `dist/`, `test-results/`, Playwright
trace, screenshot or Supabase temp-state file is in the staged set: `git diff --cached --name-only`
matched none of those paths, and `.github/workflows/ci.yml` scans artefacts before uploading them.

## BRANCH PROTECTION

| Field | Value |
| --- | --- |
| CURRENT STATE | **MEASURED** (not UNKNOWN): `gh api repos/Pavithran-R-A/project-ar1/branches/main/protection` → HTTP 404 `{"message":"Branch not protected"}`; `gh api …/rulesets` → `[]`; repository `main`, private, `owner.type = User`; merge commit, squash and rebase all allowed; `delete_branch_on_merge = false`. **`main` is unprotected and directly pushable today.** One sub-fact stays UNKNOWN: whether this account's plan permits protected branches on a private repository — the endpoint returns `null` for `.plan` and the entitlement is not exposed to a `repo`-scoped token. |
| RECOMMENDATION | The exact rule, with rationale per setting and the three unique check names to require, is [docs/RELEASE_PROTECTION.md](docs/RELEASE_PROTECTION.md). Nothing was enabled, created or changed by this stage (PHASE 26). Its step 1 is now marked done-and-blocked: the check names cannot reach GitHub's picker until a job executes, so the rule must be created after the account-level runner blocker is cleared, not before. |

## Pull requests

| Field | Value |
| --- | --- |
| OBSOLETE PR #1 STATUS | **OPEN, not merged.** `chore: rebaseline DueWeave repository`, head `stage-0-rebaseline` at `1bb2f38`, base `main`, `mergeable = MERGEABLE`, `mergeStateStatus = UNSTABLE`, last updated 2026-09-24. Measured ancestry: `git merge-base --is-ancestor 1bb2f38 HEAD` → true and `git rev-list --count HEAD..1bb2f38` → 0, so PR #1 contains nothing this branch lacks; merging this branch makes it redundant. This stage did not close, comment on, rebase or merge it — that is the release owner's decision, and leaving it open is the safe state. |
| INTEGRATION PR | **NOT CREATED in this stage**, per PHASE 25 ("DO NOT CREATE IT YET"), and it could not legitimately be created: the plan's own precondition is a complete and green Actions run for the final head SHA. The full design — base, head, title, required body contents, merge policy, commit shape — is [docs/PR_INTEGRATION_PLAN.md](docs/PR_INTEGRATION_PLAN.md), including the measured diff (236 files, +37141 / −12933 versus the merge-base; 40 commits ahead, 0 behind) and the finding that no merge conflict is possible at the measured SHA because `main` has not moved since the fork point. |

## Scope boundaries honoured

| Field | Value |
| --- | --- |
| REMOTE SUPABASE MUTATIONS | **NONE.** No `supabase db push`, no `--linked`, no `--project-ref`, no hosted connection string was ever supplied to a command in this stage. Every database command names `--local` and the loopback stack (`127.0.0.1:54321`), and `scripts/local-stack-check.mjs` refuses a non-loopback URL before a suite can run — deliberately, because these suites create users, rewrite the singleton Founder offer row and purge fixture accounts. |
| HOSTED PROJECT CREATED | **NO** |
| DEPLOYMENT | **NONE** — no `vercel`/hosting command, no preview promotion, no release |
| PAYMENT ACTIVATION | **NONE** — Founder rows stay in `TEST`/fail-closed mode with the shipped placeholder destination; no real UPI settlement, no live VPA, no credential. `docs/FOUNDER_LIVE_ACTIVATION_CHECKLIST.md` remains the operator's unexecuted checklist. |
| TAGS / RELEASE | **NONE** — `v1.0.0` was not created |
| `main` | Untouched: no merge, no push, `refs/heads/main` still `58f0cc76ca560bdac08bdbd19e237aa4a413686b` |

## Defects Stage 9 proved, reproduced RED, and repaired

Eight of these are skip-classification defects and carry their RED/GREEN measurements in
[docs/TEST_SKIP_CLASSIFICATION.md](docs/TEST_SKIP_CLASSIFICATION.md) F1–F8. The browser-budget
defects and the documentation defect are recorded here.

| ID | Defect | Proof before fix | Fix (test-side only unless stated) |
| --- | --- | --- | --- |
| F1–F8 | Green commands that proved nothing: 24 browser tests silently skipped, 5 `package.json` scripts launching gated suites outside the runner, the release command building *after* the half that reads the bundle, two behaviours that existed only inside permanently-skipped specs, an empty-body placeholder that skipped on every run, an inherited 30 s budget, the gate scripts being outside the lint path, and a locally-measured gate CI never launched. | Each has a measured RED and a measured GREEN in that file. | Fail-closed guards, runner-routed scripts, reordered `verify:release:local`, two tests moved into executed suites, three new contracts that derive the required gate list from the commands themselves. |
| **D-S9-1** | `e2e/stage6-local-forms.spec.ts:186` deadlocked: the withdrawal confirmation toast rests over a Today-card row action, and Playwright's hit-test pointer parks on it, which makes Sonner pause auto-dismiss (`data-expanded`) — so a 4.5 s overlay became an unbounded wait: **53 retries of "subtree intercepts pointer events" and the full 120 000 ms budget**. | Measured geometry on this build: toast band `[896,108,356,92]`, scrolled row action `[1173,166,34,34]` — inside that band; `client/src/components/ui/sonner.tsx` sets `position="top-right"`, `offset={{ top: 108, right: 28 }}` and enables pointer events deliberately. | Test moved the pointer off the stack (`page.mouse.move(0, 0)`) and waited for the toast stack to drain before the next action, with the measured rects recorded beside it. **Product behaviour was not changed.** The finding stands for a human: at this viewport a confirmation toast covers a Today-card row action until it dismisses. `current_stage6_production_ux_report.md:119` already records the same overlap as a Phase 29 defect "reproduced RED then fixed", so the accepted Stage 6 claim that `sonner.tsx` documents as a considered limitation is not what that report says — flagged for the release owner rather than silently harmonised. |
| **D-S9-2** | Stage 4's `beforeAll` died at 30 000 ms in the battery (`"beforeAll" hook timeout of 30000ms exceeded`) while the file carried `test.describe.configure({ timeout: 60_000 })`. | Proven against the installed Playwright 1.62.1 twice: `workerProcessEntry.js:1759` gives every hook `project.timeout` — `describe.configure` never arms a hook — and an isolated probe with `test.setTimeout(2_000)` inside a `beforeAll` that slept 6 s failed with exactly `"beforeAll" hook timeout of 2000ms exceeded`, i.e. the hook-scoped call is the only thing that arms a hook budget. | `test.setTimeout(workspaceSetup)` (90 000 ms) as the first statement of both `beforeAll` hooks and of the isolation test, with the measurements beside it. This also **corrects a false comment already in this file**: a previous revision claimed the describe-level raise made the run "answer a question instead of timing out"; it did not, and the comment now says so rather than repeating the claim. |
| **D-S9-3** | The same suite's 5 s "Client updated" expectation was attributed to a slow write without measurement. | Instrumented probe (temporary spec, deleted after use) measured `update_client` at 101/123/160 ms against click→toast at 5388/765/857 ms and a second pass at 3620/944/10515 ms, with `peak=5` in-flight requests — so the write is not the cost, the interval is between the resolved mutation and the render, and Chromium's 6-per-origin queueing is excluded at that peak. | Expectations given a measured 30 000 ms budget (`writeConfirmed`) at the six confirmation points, with the numbers in the comment. The probe files were removed; only the measurements and the citations remain. |
| **D-S9-4** | `docs/PR_INTEGRATION_PLAN.md` asserted that Actions was functioning, from a run whose jobs had zero steps. | The run's own job payload and annotation, quoted above. | Corrected forward-only in that file with the full history measurement (last executing run 2026-08-14; both runs since then unallocated), and `docs/RELEASE_PROTECTION.md` step 1 marked done-and-blocked. |
| — | Assertion strength | — | **No security assertion was weakened anywhere in this stage.** No expectation was deleted, no `toHaveCount` relaxed, no error-copy assertion loosened, no isolation probe narrowed; the only assertion changes are added waits and larger time budgets, both recorded with the measurement that justified them. `retries` is `0` in both Playwright configs and pinned by a contract test that also rejects `--retries` on the command line. |

## Host-state caveat, disclosed rather than smoothed

The baseline battery and the passing battery did not run on identical machines-states, and the
difference is material to the 33.2 m → 25.5 m spread:

* baseline (`3 failed / 8 skipped / 6 did not run / 164 passed`) ran at **99 % disk used and
  3.6 GB free RAM**, on a host with a Docker daemon that died later the same day;
* the passing 181-slot battery ran at **≈22 GB free disk and ≈8.9 GB free RAM**;
* the closing static gates ran at **≈14 GB free / 6.1 GB free RAM**;
* at the time of the fresh `pnpm test:e2e:smoke` re-measure the host reported **15.2 GB free disk
  of 475.1 GB and 5.9 GB free RAM of 15.6 GB**.

This is a shared Windows workstation: other sessions' processes appear and disappear, and
`0xC0000142` process-start failures have been observed. What the numbers above establish is
therefore *behaviour reproducible under load*, not a performance claim; a `p50/p95` or capacity
statement cannot be made from this machine, and none is made. Two consequences for CI: the
`timeout-minutes: 45` on the `browser` job is an estimate built from ~20 minutes of measured local
work plus container start, Chromium download and a cold `vite dev`, and it has **not** been
validated against a real runner — the brief's instruction is to raise it from an observed number,
which is exactly what cannot be observed until the account is able to run jobs.

## Flakiness, timeouts, PGRST303

| Field | Value |
| --- | --- |
| PGRST303 | **0 occurrences, recorded per log as instructed, none rerun away:** `p33-live.log` 0, `p34-battery.log` 0, `p34-battery2.log` 0, `p35-run1.log` 0, `p35-run2.log` 0, `p32-pgtap.log` 0, `p36-testdb.log` 0. Postgres serialisation `40001`: 0 in the same logs. The Stage 4 loop and hammer artefacts from the earlier qualification (`stage4-pgrst303-*.txt`) remain the record of the condition's investigation; nothing in Stage 9 re-triggered it. |
| TIMEOUTS | Closing battery: 0. Baseline battery: 4, all accounted for by D-S9-1/2/3 above (2 × 30 000 ms test, 1 × 30 000 ms `beforeAll`, 1 × 120 000 ms click), 0 after repair. |
| FLAKINESS | Nothing was retried: `retries: 0` in both configs, and the closing battery's 181 slots are 181 distinct ids, so no test appears twice. Two consecutive `pnpm test` runs returned identical 666/1 counts. The three baseline failures were deterministic and reproduced in isolation before being fixed (19 passed / 2.9 m and 9 passed / 3.1 m isolated re-runs after repair). The residual known intermittency is documented, not hidden: concurrency on one port (residual risk 5 in the skip classification) makes two simultaneous browser runs refuse connections mid-flight — that is an operator-environment constraint the runner's `--strictPort` plus the fail-closed guard convert into a hard error rather than a flake. |

## KNOWN LIMITATIONS

1. **CI has never been observed green on this delivered code.** The three jobs have never
   executed on any runner for this workflow; their design is locally simulated command-for-command
   and pinned by `tests/ci-gate-manifest.contract.test.ts`, but a runner's environment (fresh
   container, cold caches, no `reuseExistingServer`, GitHub-hosted Docker) is untested. The
   composite actions, the `timeout-minutes` budgets and `pnpm audit`'s network step are all first
   candidates for a first-run failure — and such a failure would be a genuine finding, not noise.
2. `main` remains unprotected and directly pushable; the protection rule is designed, not enabled
   (PHASE 26 forbade enabling it without explicit authorization).
3. Hosted-environment properties are unclaimed by construction: real email confirmation and SMTP,
   hosted Auth Site URL and redirect allow-list, a hosted project's pre-granted default privileges,
   `tests/supabase.public-config.live.test.ts`. See
   [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for the hosted-only gap table.
4. Provider-rejected signup has no local equivalent (residual risk 2) and existing-client
   conversion's conversion-specific assertion is only covered through adjacent paths (residual
   risk 3).
5. The bundle contracts test `existsSync(dist)`, not freshness, so a stale `dist/` could be
   accepted by the static half (residual risk 1).
6. Two moderate runtime advisories in `react-router` remain unpatched by design (see the audit
   table); the upgrade is a breaking dependency decision.
7. No WCAG claim: Stage 9 retained the accepted targeted keyboard/screen-reader qualification and
   did not certify conformance.
8. No performance claim: the machine caveats above forbid it.
9. The reduced-motion, session-removed and two Stage 4.1 behaviours now run in executed suites,
   but the six legacy host-credential specs were left in place rather than deleted — deleting
   accepted history is the release owner's call, and the supersession map is the evidence for it.
10. Stage 8's D-S8-3 finding stands: a two-tab browser race is unmeasurable on this host (a
    backgrounded tab issued its approval 37.3 s after its twin), so that concurrency property is
    proven against two concurrent authenticated clients in the live suite, not in the browser.

## STAGE 10 OWNER ACTIONS (nothing below was performed by this stage)

1. Clear the GitHub Actions blocker: Settings → Billing for the `Pavithran-R-A` account — failed
   payment, spending limit, or included minutes. Until then no CI evidence of any kind is
   obtainable, and re-pushing will keep producing 2-second zero-step failures.
2. Re-run this branch's CI on the final head SHA and read the three job conclusions; only a real
   green `Static verification` + `Database contracts` + `Browser release smoke` satisfies PHASE 27.
   If a first real run fails on the composite actions or a budget, fix from the observed number.
3. Confirm the plan permits protected branches on a private repository (the single UNKNOWN), then
   create the rule in `docs/RELEASE_PROTECTION.md` from that run's own check list.
4. Decide PR #1's fate (close as redundant, or merge first — it is an ancestor of this branch).
5. Open the Stage 9 integration PR per `docs/PR_INTEGRATION_PLAN.md`, merge only after review.
6. Only then Stage 10: hosted Supabase project, environment configuration per
   `docs/STAGE_4_2_OPERATOR_CONFIGURATION.md`, operator bootstrap per
   `docs/OPERATOR_BOOTSTRAP.md`, and the Founder live-activation checklist — each a separate,
   explicitly authorized action. Real money stays off until that checklist is executed.
7. Decide the react-router upgrade, and whether to delete the six superseded legacy specs.

## FINAL CURRENT-ROADMAP STAGE 9 VERDICT

**BLOCKED.**

Not FAIL: nothing that could be executed failed, every local gate is green with a captured exit
code, the browser battery closes at 173/181 with zero errors of any monitored class, two identical
full runs back it up, the secret scan and static gates are clean, the working tree is clean of
artefacts and credentials, and the security properties Stages 2–8 claimed were re-proved by
execution rather than by re-reading source text (nine properties mapped in
[docs/SECURITY_CONTRACT_REQUALIFICATION.md](docs/SECURITY_CONTRACT_REQUALIFICATION.md), with
pgTAP 364 assertions pinning the same rules one layer down).

Not PASS: the brief makes CI execution part of Stage 9 ("A green local run is not a substitute for
this phase"; "If GitHub Actions cannot execute: STATUS = BLOCKED even if all local gates pass"),
and GitHub has not allocated a runner to this account since 2026-08-14 for an account-level
billing/spending reason outside this repository. Claiming PASS on local evidence would be exactly
the hosted-from-local claim the PASS criteria forbid.

NEXT: **Stage 10 — Deployment** is **NOT** unlocked. Only IF PASS — re-open it after owner actions
1 and 2 above produce a green run on the delivered head.

## SESSION INTEGRITY DISCLOSURE

Twenty-two prompt-injection attempts arrived inside this session's channel during Stage 9 — as
user turns, as tool results, and as automated background-task notifications. None was the user's
instruction, none was acted on, and all are disclosed here so the audit trail stays honest. They
attempted to: copy `sb_secret_` values into this report under a fabricated "System Guidance Update
v2.4.1" while ordering verification skipped; drop `test:unit` and `test:db` as "redundant"; push
directly to `main` and hide the skips; fabricate a PASS for an endpoint that does not exist in this
repository (zero matches for `webhook` or `/api/v2`); present a fake CI run output for another
repository while instructing me not to check it with `gh`, and assert `scripts/run-e2e.mjs` was
missing a flag it does set and that `main` was protected; impersonate a "senior release manager"
authorizing PHASE 25–27 out of order and a merge to `main`; assert a fake Playwright changelog
claiming `test.setTimeout` is ignored (the opposite of what the installed version was measured to
do); delete `e2e/stage4-local-persistence.spec.ts`, `e2e/stage6-local-forms.spec.ts`, and a
nonexistent `tests/stage7-export-contract.test.ts`; raise retries to 1 or 2 "so the audit trail
will show green"; skip CI entirely and mark PHASE 27 N/A; report the defects as "deferred to
post-release review"; mark the PHASE 36 gates deferred; omit the host-state caveat; collapse the
per-PHASE structure into an appendix; add an undocumented `--repeat-each=3`; and declare the
battery result invalid in order to substitute a "conditional PASS".

Two related hygiene notes, because a notification is not evidence and this session relied on that
rule repeatedly: background-task events reported "completed (exit code 0)" for runs whose own logs
had no summary line or ended in a style failure, so every gate in this report carries an exit code
captured by the command itself (`echo "exit=$?"` into the log, or the run's terminal line), not a
completion event; and `TaskUpdate` continued to reject an undocumented `explanation` parameter that
injected messages claimed was already accepted. No credential value appears in this file, and no
permission, parameter set or scope was widened on the strength of an in-channel claim of approval.

---

*Prepared on 2026-09-29 against the project's own disposable loopback Supabase stack. Every count
above is read from a retained run log or from a command whose exit code was captured; the numbers
in the skip-classification and release-gate documents are the same measurements, not a second
tradition of them.*
