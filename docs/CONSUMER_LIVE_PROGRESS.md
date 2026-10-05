# Consumer-live progress

**This file is the authoritative continuation record for the rest of this project.** One row per
phase, and each phase updates it before it closes. Every number below was measured on the date it
carries, on this machine, against this repository's own disposable loopback Supabase unless a line
says otherwise. Nothing here was run against a hosted project, because no hosted project exists yet.

Scope rule that governs this file: Founder monetization stays fail-closed until a human owner
configures and verifies it, and no business, payment, legal or support fact is ever invented by an
engineering pass. Cost rule: nothing is purchased, upgraded, or created whose cost is non-zero or
unclear without the owner's explicit confirmation.

## Current phase

**Phase 2 — make `release/consumer-live` independently release-qualified, and close every
repository-side blocker that can be closed before a hosted backend exists.** No hosted Supabase
project, no deployment, no purchase, no plan upgrade, no merge, no branch-protection change, no
`main` write, no payment or Founder activation. Phase 2's own objective statement is the one that
matters: obtain **direct** GitHub Actions evidence for a `release/consumer-live` head, because
Phase 1's evidence was inherited from the parent head (see the attribution correction below).

Phase 2's work is finished at the head this file is committed on, and it is closed only by the rule
in **Phase 2 closure** below: that head must have its own run with all three jobs green. Phase 3 is
**not** started by this phase and cannot be, because its first operation is the owner's ADR-001
decision (hosted Supabase project and static host) — see *Hosting and backend decision*.

**Phase 1 — takeover, preflight and repository audit** (recorded above, unchanged in substance).
No deployment, no hosted resource, no purchase, no merge, no branch-protection change, no `main`
write. The deliverable of that phase was this file plus the branch it lives on.

## Where this work started

| Item | Value | How it was measured |
| --- | --- | --- |
| Starting branch | `current-stage-9-security-ci` | `git branch --show-current` |
| Starting SHA | `e5b734b6a24489b80fde65b0909f14bb7a56d64b` | `git rev-parse HEAD` |
| Remote SHA of that branch, before any write | `e5b734b6a24489b80fde65b0909f14bb7a56d64b` — identical, so the remote had **not** advanced beyond the expected production-candidate head and there was nothing to absorb | `git fetch --all --prune` (exit 0) then `git rev-parse refs/remotes/origin/current-stage-9-security-ci` |
| `main` | `58f0cc76ca560bdac08bdbd19e237aa4a413686b` — the stale Stage-1 line, **not** an implementation base | `git rev-parse refs/remotes/origin/main` |
| Working tree at takeover | one flagged path, `client/src/types/database.generated.ts`, with an **empty** `git diff --numstat` — the documented `core.autocrlf=true` phantom, deliberately never committed | `git status --porcelain`, `git diff --numstat` |
| New branch | `release/consumer-live`, created from `e5b734b` and never from `main` | `git checkout -b release/consumer-live e5b734b…` |
| `release/consumer-live` before this phase | no ref at all on the remote | `git ls-remote origin refs/heads/release/consumer-live` → empty |
| Origin | `https://github.com/Pavithran-R-A/project-ar1.git` for both fetch and push. GitHub answers that this repository now lives at `Pavithran-R-A/DueWeave` and the old URL redirects; the remote URL was left untouched on purpose (this workstream does not modify git configuration) and every API call below uses the current slug | `git remote -v` |

## Repository state taken over

**Open pull requests — exactly one, and it is unmerged.** `#1 chore: rebaseline DueWeave
repository`, head `stage-0-rebaseline` at `1bb2f3862d54bd60cb63944876b21cba916af5e8`, base `main`,
state `OPEN`, `mergedAt` null (`gh pr list --state all`). `docs/PR_INTEGRATION_PLAN.md` measures
`1bb2f38` as an ancestor of this head, so merging the release line makes PR #1 redundant; its
disposition is an owner decision and this phase did not comment on, close, rebase or merge it.

**CI state inherited from the parent head — green, self-hosted, with the red run kept.** This is
evidence about `e5b734b`, the head this branch was created *from*; it is not evidence about any
commit of `release/consumer-live`. The five most recent runs on any branch:

| Head | Run event | Conclusion |
| --- | --- | --- |
| `e5b734b` (this start point) | push | `completed / success` |
| `1564c6c` | push | `completed / success` |
| `a86dc09` | push | `completed / failure` — the run that found D-S9-14 and D-S9-15; preserved as evidence, not deleted |
| `7a87d88` | push | `completed / success` |
| `194d09f` | push | `completed / success` |

The run for `e5b734b` itself is `37009951112`: `Static verification`, `Database contracts` and
`Browser release smoke` all `completed / success`, each executed on runner **`dueweave-local-ci`**
(not a GitHub-hosted fallback), every step `success` except `Upload failure evidence`, whose
conclusion is `skipped` because it is an `if: failure()` step and nothing failed
(`gh api repos/Pavithran-R-A/DueWeave/actions/runs/37009951112/jobs`).

**A push of `release/consumer-live` starts no CI run.** `.github/workflows/ci.yml` triggers on
`pull_request`, on `workflow_dispatch`, and on `push` to `main` and `current-stage-9-security-ci`
only. That is a fact about this branch, not a defect in the file, and it is the first thing Phase 2
has to change before this branch can carry CI evidence.
**Changed in Phase 2 by `f34d340`**, which added `release/consumer-live` to the workflow's `push`
trigger list; the runs this branch has had since then are recorded in the Phase-2 run table, and
the paragraph above is kept as Phase 1's measured state rather than rewritten.

**GitHub-hosted minutes are still account-blocked.** No hosted runner has been allocated to this
repository since 2026-08-14; every run since reports `runner_id = 0`, zero steps and the billing
annotation (`docs/PR_INTEGRATION_PLAN.md`, re-stated in `ci.yml`'s own comment). The account's
spending state cannot be read with the available token scope, and this phase changed no payment
setting. CI therefore runs on the repository's own WSL2 self-hosted runner, which is only online
while that machine is.

**Repository protection — none.** `gh api …/branches/main/protection` and the same call for
`current-stage-9-security-ci` both answer `404 Branch not protected`; `…/rulesets` answers `[]`; the
repository is `private` with `owner.type = User`. `docs/RELEASE_PROTECTION.md` is the prepared rule
set and nothing in it has been enabled; whether this account's plan permits protected branches on a
private repository is still UNKNOWN, and that is an owner action, not an engineering one.

**There is no deployment surface at all.** `vercel.json`, `netlify.toml`, `Dockerfile`, `fly.toml`
and `railway.json` are absent from the repository root, `server/` and the Express/tRPC/Manus runtime
were deleted at Stage 4.1 (`docs/STAGE_4_1_HARDENING.md`), and `.env.example` carries only
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The delivered shape is a static browser client plus
a Supabase project that does not exist yet. `README.md` states the product is pre-deployment.

## Tests actually executed on this branch

### Phase 1's measurement (kept as taken)

All of these ran on 2026-10-04 against this branch's own working tree. Each command's real exit
code was captured from the command itself, not from a pipe.

| Command | Exit | Measured result |
| --- | --- | --- |
| `pnpm lint` | 0 | `eslint client/src tests e2e scripts vite.config.ts --max-warnings=0`, no finding |
| `pnpm check` | 0 | `tsc --noEmit` clean |
| `pnpm test:unit` | 0 | 28 files, **383 passed / 3 skipped (386)**, 28.18 s |
| `pnpm build` | 0 | 1711 modules transformed, built in 8.86 s |
| the three skipped tests, re-run against that `dist/` | 0 | `tests/credential-boundary.contract.test.ts`, `tests/production-module-graph.contract.test.ts`, `tests/stage8-founder-contracts.test.ts` → 3 files / **18 passed, 0 skipped**. Their skip is class C in `docs/TEST_SKIP_CLASSIFICATION.md` (`it.skipIf(!dist)`), so with the bundle present the static half is 386 executed, 0 skipped |
| `pnpm verify:secrets` | 0 | **237 files** scanned against 11 privileged-credential shapes, tree **and** `dist/`, no finding |
| `pnpm audit --prod --audit-level=high` | 0 | `No known vulnerabilities found` — this is the audit that blocks in CI |
| `pnpm audit --audit-level=high` | 1 | **41 vulnerabilities (1 low, 18 moderate, 20 high, 2 critical)**, all in the development tree. CI runs this step with `continue-on-error: true` (`.github/workflows/ci.yml`, class E in the skip classification). Recorded, not smoothed; the count moved 38 → 41 since Stage 9's measurement. **Superseded by Phase 2's repair — see "Development-toolchain advisories, repaired and remaining" below; the same command now measures 7.** |

**Not executed in Phase 1**, because they need the Docker/Supabase stack and that phase was
audit-only: `pnpm db:reset:local`, `pnpm verify:types`, `pnpm verify:migrations`, `pnpm test:db`,
`pnpm test:live`, `pnpm db:lint`, `pnpm verify:release:local`, and every browser command. Their
accepted measurements at the time were the *parent* head's CI run `37009951112` above and
`docs/RELEASE_GATE_MATRIX.md` — inherited, not branch-local. **Phase 2 executed all of them**, both
on this branch's own CI (the Phase-2 run table) and against the disposable local stack (the table
below), so nothing in this section is inherited any more.

### Phase 2's re-measurement at head `b80725a`

Every command below ran on 2026-10-04 on this machine against `release/consumer-live` at `b80725a`,
each with its own log and its own exit code captured from the command rather than from a pipe. The
database and browser batteries ran only while the self-hosted runner was idle, and the laptop stack
was taken down before any push — see the run-45 row for why that ordering is load-bearing here
rather than merely tidy. `retries: 0` in both Playwright configs, unchanged.

| Command | Exit | Measured result |
| --- | --- | --- |
| `pnpm supabase:start` | 0 | disposable loopback stack `dueweave` up on 127.0.0.1; qualified against `http://127.0.0.1:54321` |
| `pnpm db:reset:local` | 0 | **24 migrations applied from zero** (`grep -c "Applying migration"` on the run's own log) |
| `pnpm verify:types` | 0 | generated types match the replayed schema, no drift |
| `pnpm verify:migrations` | 0 | `Migrations on disk: 24. Applied in the local database: 24.` — "the replayed schema and the qualified schema are the same migration set" |
| `pnpm test:db` | 0 | pgTAP `Files=8, Tests=364`, `All tests successful.`, `Result: PASS` |
| `pnpm db:lint` | 0 | linted `extensions` and `public`, `No schema errors found` |
| `pnpm test:live` | 0 | **9 files, 309 passed, 0 skipped**, 196.03 s |
| `pnpm build` | 0 | 1711 modules transformed, built in 12.98 s |
| `pnpm test:unit` | 0 | **30 files, 409 passed, 0 skipped**, 28.85 s — run *after* the build, so Phase 1's three class-C contracts executed inside this number rather than skipping (409 vs 386 because Phase 2 added tests) |
| `pnpm lint` | 0 | `eslint … --max-warnings=0`, no finding |
| `pnpm check` | 0 | `tsc --noEmit` clean |
| `pnpm verify:secrets` | 0 | **241 files** scanned against 11 privileged-credential shapes, tracked tree **and** `dist/`, `No privileged credential found in the tracked tree or the built bundle`. This is the one count the record uses: 241, not Phase 1's 237, because residues A-H added files |
| `pnpm audit --prod --audit-level=high` | 0 | `No known vulnerabilities found` — the blocking audit |
| `pnpm audit --audit-level=high` | 1 | **7 vulnerabilities found**, all development-tree. Recorded with exit 1, not presented as a pass; the CI step is still `continue-on-error: true` |
| `pnpm test:e2e:smoke` | 0 | `Running 79 tests using 1 worker` → **79 passed (15.0 m)**, 0 failed, 0 skipped, 0 flaky, 0 did-not-run at `retries: 0`, against the disposable stack on `http://127.0.0.1:54321`. This is the same 79-slot set CI runs, and it carries row H's refusal-coverage walks at 1280×720, 768×1024 and 390×844 |
| `pnpm test:e2e:react-warnings` | 0 | `Running 3 tests using 1 worker` → **3 passed (46.8 s)**, 0 skipped, development build on the `chromium-dev` project |
| `pnpm verify:e2e:local` (the whole local browser battery) | 0 | **173 passed (24.6 m), 8 skipped.** The 8 are the pre-existing class-E `controlled *` specs (`accessibility-smoke`, `auth-lifecycle-limits` ×2, `core-workflow`, `founder-purchase`, `responsive-authenticated`, `stage41-client-conversion` ×2), each gated on `E2E_EMAIL`/`E2E_PASSWORD` for a *hosted* dedicated QA account. **They are recorded as not executed, not as passing** — this phase provisions no hosted backend and no QA account, so their status is exactly what `docs/TEST_SKIP_CLASSIFICATION.md` class E says, including the supersession mapping that shows each behaviour they claim is executed on the local stack under a `stageN-local-*` spec. None of them is in `test:e2e:smoke`, so no CI or release gate counts them |
| `pnpm verify:release:local` (the composite, run as one command so its own exit is measured) | 0 | Re-executed end to end rather than inferred from its parts: `db:reset:local` → `verify:types` → `verify:migrations` (`Migrations on disk: 24. Applied in the local database: 24.`) → `test:db` (`Files=8, Tests=364`, `Result: PASS`) → `db:lint` (`No schema errors found`) → `test:live` (9 files, **309 passed**) → `build` (1711 modules) → `test:unit` (30 files, **409 passed**) → `lint` → `check` → `verify:secrets` (`Scanned 241 files for 11 credential shapes`, no finding) → `audit --prod` (`No known vulnerabilities found`). **Run twice.** The first attempt's own status read printed `exit=-1` immediately after `pnpm verify:release:local` — not a POSIX exit code, so it was treated as a failed capture rather than as a result, and the run's log (13 stage banners, no `ELIFECYCLE`/`Command failed` marker) was not used to paper over it. The composite was therefore re-executed with the status stored in a variable on the next line: **`verify_release_local_rerun exit=0`**, with the same 24/24 migrations, `Files=8, Tests=364`/`Result: PASS`, `No schema errors found`, 9 files/309 tests, 1711 modules, 30 files/409 tests, `Scanned 241 files`, `No known vulnerabilities found`. Every number equals the individual measurements above, so no gate in this table contradicts another |

**Attribution correction, measured in Phase 2.** Read back with `gh run list --branch
release/consumer-live` and `gh api repos/Pavithran-R-A/DueWeave/actions/runs?head_sha=…`: **Phase 1
produced no CI run at all.** Its commit `94335f2` was pushed while `.github/workflows/ci.yml` still
triggered only on `main` and `current-stage-9-security-ci`, so the API returns zero runs for that
SHA. Run `37009951112` is therefore **inherited parent evidence for `e5b734b`** and was never a CI
execution of `94335f2` or of any other `release/consumer-live` head; the first run this branch ever
had is listed in the Phase-2 run table below, and the direct GitHub Actions evidence the phase set
out to obtain is judged there, not here.

## Evidence inherited from Stage 9 at the parent head

Recorded so a later phase does not re-claim it as new work: pgTAP 8 files / 364 assertions `PASS`;
`pnpm test:live` 9 suites / 307 tests; browser battery `79 + 3 = 82` slots with 0 failed, 0 skipped,
0 did-not-run, 0 flaky at `retries: 0`; 0 `PGRST303`; 0 artefacts uploaded by the failure-evidence
step; 4 credential-redaction markers in the job log and 0 raw credential shapes. Full detail:
`current_stage9_security_ci_report.md` (run 35 and run 36 sections).

## Phase 2 — what this branch changed

Every row is a commit already pushed to `release/consumer-live`, with the measurement that justified
it. Nothing here was merged, deployed, purchased or activated.

| Residue | Commit | Measured problem and what the change does about it |
| --- | --- | --- |
| **Task 1 — the branch had no CI** | `f34d340` | `release/consumer-live` was absent from `.github/workflows/ci.yml`'s `push` triggers, so no commit on this branch could ever produce a run (Phase 1 recorded exactly that). Added to the trigger list, with the workflow's own trigger-coverage check extended to name this branch. No job, step, gate or timeout was changed |
| **A — the scan's scope sentence lied** | `83e3a8f` | `verify-secrets.mjs --dir` mode printed the *default* mode's closing line, so a run-18 browser-job log claimed "No privileged credential found in the tracked tree or the built bundle" after opening one file in `test-results`. The files scanned and the finding count were right; the scope claim was not. Scope is now carried with the file list and read by every sentence that states one. `tests/ci-artefact-scan-without-artefacts.contract.test.ts` pins both halves — the claim that moves, and the default-mode wording that must not |
| **B — the bundle proof judged the build environment** | `06818f4` | `tests/credential-boundary.contract.test.ts` excluded `process.env.VITE_SUPABASE_ANON_KEY` from the JWTs it found, so with this tree's single bundled JWT the test was green in CI only because the CI build had inlined nothing, and red on a laptop that built from `.env.local`. Neither half proved the rule. Tolerance is now a property of the *token*: a bundle may carry a JWT whose payload says `anon`; everything else, including an undecodable payload, is a finding reported by role and length, never by value. Measured: old rule → 1 finding against a sentinel-value bundle, new rule → 0, privileged fixture still reported. Synthetic bundles are assembled at runtime from fake sentinels so no literal credential enters the test file |
| **C — the runner guard was unpinned** | `2150308` | `release-local-ci-state` protected the shared machine by construction (Stage 9 limitation 6) and nothing pinned it, so an edit could widen `supabase stop` into a host-wide prune or drop the `/proc/<pid>/cwd` guard while every gate stayed green. D-S9-8 is the measured cost of exactly that widening. Scope is now derived rather than copied — ports from the Playwright configs that bind them, artefact directories from the scan that reads them, workspace guard from the variable only a self-hosted job sets — and non-vacuity is proved by mutation |
| **D — the refusal card covered the control it names** | `3d42f87` | Product fix, not a test fix. Measured before: the card covered 7953 of the "View Founder access" button's 8443 px (94%) at 1280×720 and 100% at 768×1024, and sonner holds a card open while the pointer rests on it. A refusal that names a control is now pointer-transparent with its own action re-enabled. Message text, the 9-second lifetime, the route and the live-region announcement are unchanged; no sleep, no test-only CSS and no shortened copy were introduced. Stage 8 journeys now click *through* the live card at `desktop 1280x720`, `tablet 768x1024` and `mobile 390x844` and assert the card does not own the pointer |
| **E — the phone rule was only proven on the edit verb** | `7f87f21` | Gap 1 of `docs/STAGE9_ABUSE_MATRIX.md`. LIVE probes now drive malformed phone through `create_client` and `create_client_and_receivable`. The rule asserted is the one the verbs already enforced, read out of existing behaviour and recorded, not invented for the test |
| **F — Unicode-whitespace padding on required ledger text** | `0983171` | Gap 2, and a **product** decision: one explicit rule — a required ledger field is blank in exactly the class `String.prototype.trim()` treats as blank — applied to required fields only, with optional free text left as it was. Forward migration `20261004170000_current_arc2_ledger_required_blank_class.sql` (24th), 170 new LIVE probes (160 refusals + 10 accepted controls and boundary pins), and `tests/ledger-blank-class.contract.test.ts` (5 tests, no container) pinning the class between migration boundaries, against the JS set, pinning U+200B **out** of it, and re-pinning the four `authenticated` EXECUTE grants the Stage 3 fail-closed trigger strips from any redefined routine |
| **G — 41 development-tree advisories** | `5718b6a` | Now **7**, by compatible means only. See "Development-toolchain advisories, repaired and remaining" below |
| **H — the refusal-coverage guard depended on wall-clock, not on the card** | `b80725a` | Test-side repair of run 44's red — the only repository-side defect this branch's own CI has found. Measured cause: `restingToastBox` accepted any two consecutive equal reads, and a card that has *finished leaving* satisfies that too — its resting place is `y = 108 − 130 = −22`, exactly sonner's `translateY(-100%)`, which is the coordinate run 44 printed. Reading it cost seven sequential CDP round trips, measured at **2418–2583 ms** of the product's own **9000 ms** refusal lifetime on an *idle* laptop; on a contended runner the card was gone before the click. `captureRefusalCoverage` now waits inside one `page.evaluate` on animation frames for exactly one *live* card (`data-removed` not `true`, computed opacity not `0`), requires two consecutive frames to agree, then reads the card box, the control box, their overlap and the browser's own `elementFromPoint` hit test **in that same frame** — a leaving or absent card can no longer produce a number. Measured after: window **1702–1886 ms**, card read at rest (`384,106 356x110`, 8443 px² over the 201x42 button at tablet). No sleep was added, no timeout raised, `retries: 0` is unchanged and no product assertion was removed; the non-vacuity guard still demands real overlap at desktop and tablet, and `tests/e2e-refusal-toast-occlusion.contract.test.ts` (7 tests) now pins the new reader. `pnpm test:e2e:stage8` → 21 passed |

## Phase 2 — this branch's own CI runs

This is the evidence Phase 1 could not obtain: every run below is an execution of a
`release/consumer-live` commit by GitHub Actions, on the repository's WSL2 self-hosted runner
`dueweave-local-ci`. None was produced by its parent, and none was deleted or rerun over. Counted
from the table: **5 failures** (40, 44, 45, 49, 50), **6 cancellations** (37, 38, 39, 41, 42, 43),
**2 successes** (46, 48) and **1 vanished run** (47) recorded exactly as it was observed, not dropped.
The `#` column is this table's row position, not GitHub's `run_number`. Read from
`GET …/actions/runs?branch=release/consumer-live` (`total_count: 13`), GitHub's own numbers are 37…46
for rows 37…46, then `47` for row 48, `48` for row 49 and `49` for row 50; the vanished run holds no
surviving `run_number`, which is the whole difference between the two sequences from row 47 on.

| # | Run | Head | Event | Created (UTC) | Conclusion | The step that decided it | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 37 | `37191690855` | `f34d340` | push | 09:17:46 | cancelled | no step failed | supersede policy (see below) |
| 38 | `37192504597` | `83e3a8f` | push | 09:32:48 | cancelled | no step failed | supersede policy |
| 39 | `37192936933` | `06818f4` | push | 09:41:02 | cancelled | no step failed | supersede policy |
| 40 | `37193639709` | `2150308` | push | 09:54:21 | **failure** | `Static verification` **and** `Database contracts` both died at step `Run ./.github/actions/setup-toolchain`; `Browser release smoke` skipped | **external network** — the log reads `WARN GET https://registry.npmjs.org/ansi-styles/-/ansi-styles-4.3.0.tgz error (ETIMEDOUT). Will retry in 10 seconds. 2 retries left.` (and the same for `color-convert`). Cold pnpm store plus a registry the host could not reach. Not a repository defect: the identical step passed from run 44 onward with no change to this repository |
| 41 | `37197781879` | `3d42f87` | push | 11:09:44 | cancelled | no step failed | supersede policy |
| 42 | `37197960856` | `7f87f21` | push | 11:12:44 | cancelled | no step failed | supersede policy |
| 43 | `37200401382` | `0983171` | push | 11:56:15 | cancelled | no step failed | supersede policy |
| 44 | `37202389761` | `5718b6a` | push | 12:31:14 | **failure** | the first branch-local **green** for `Static verification` (12:32:50→12:34:17) and `Database contracts` (12:34:20→12:40:47); `Browser release smoke` failed at step `Release journeys` (12:40:51→12:57:23) with `Error: tablet 768x1024: the refusal card at 384,-22 356x130 covers 0px^2 of the 201x42 button` — 1 failed, 69 passed, 9 did not run | **repository-side test defect**, reproduced, root-caused and repaired by `b80725a` (row H). The product assertion itself never failed: every click and route check in that run passed, which is what separates H from a D-S9-9 recurrence |
| 45 | `37206031787` | `b80725a` | push | 13:33:15 | **failure** | `Static verification` success; `Database contracts` failed at step `Run ./.github/actions/local-supabase` — `Starting database... 13:34:22Z`, `Initialising schema... 13:34:33Z`, `Stopping containers... 13:34:47.053Z`, `error running container: exit 125`; `Browser release smoke` skipped, so `b80725a`'s journeys were never judged by it | **CI orchestration / this workstream's own action, not a code, test or product defect.** This session ran `supabase stop` on the laptop, whose log completed at **13:34:47.269Z**, i.e. between CI's own two timestamps, while the CI job's stack was mid-start. The laptop stack and the CI stack share one Docker daemon *and* one Supabase project id (`dueweave`; CI's workspace is `/home/pavithran_r_a/actions-runner-dueweave/_work/DueWeave/DueWeave`), so the two commands were driving the same containers — CI's own first step is `pnpm supabase stop --no-backup`, which had already torn down the laptop stack at 13:34:09→13:34:19. The brief's rule that the database batteries must never overlap CI is therefore stronger here than a port-avoidance rule. Left in the trail as red; `b80725a` was re-observed with `gh workflow run ci.yml --ref release/consumer-live` (run 46) rather than `gh run rerun`, so run 45's conclusion is never rewritten |
| 46 | `37206353353` | `b80725a` | workflow_dispatch | 13:38:47 | **success** | every job green: `Static verification` 13:38:51→13:40:14 (1711 modules transformed, 30 unit files passed, `No privileged credential found in the tracked tree or the built bundle`, prod audit `No known vulnerabilities found`, dev audit `7 vulnerabilities found` printed with `##[error]Process completed with exit code 1.` under `continue-on-error: true`); `Database contracts` 13:40:17→13:46:55 (`db:reset:local`, `verify:types`, pgTAP `Result: PASS`, 9 live files / 309 tests); `Browser release smoke` 13:46:58→14:04:39 — `Running 79 tests` → **79 passed (13.7m)**, `Running 3 tests` → **3 passed (44.3s)**, 0 failed, 0 skipped, 0 flaky, 0 did-not-run at `retries: 0`. Only `Upload failure evidence` is `skipped`, and it is an `if: failure()` step that had nothing to upload. Jobs ran in workspace `/home/pavithran_r_a/actions-runner-dueweave/_work/DueWeave/DueWeave`, i.e. the repository's own WSL2 self-hosted runner, not a GitHub-hosted fallback | **green on the first attempt with no laptop command overlapping it** — which is itself the control for run 45's classification: the same head, the same step, no repository change, and the `local-supabase` step passed |
| 47 | `37213354566` | `63e422e` | push | 15:46:52 | **no conclusion available** — the run is gone. `gh run view 37213354566` → `HTTP 404: Not Found (https://api.github.com/repositories/1332102160/actions/runs/37213354566)`; `GET …/actions/runs?head_sha=63e422e…` returns `total_count: 1`, and the one run it returns is row 48 below; a 50-run sweep of the branch does not contain the id | **CI control-plane / orchestration, external to this repository.** Read while live it reported `status: in_progress` with `Static verification` queued and `Database contracts` not yet started, and then 404 on the run-id, branch, workflow and repository-id routes. The runner's own journal shows it was never handed to the machine: `journalctl -u actions.runner.Pavithran-R-A-project-ar1.dueweave-local-ci.service` for 13:30→16:40 lists job receipts at 13:33:14, 13:35:01, 13:38:46, 13:40:12, 13:46:53, then nothing until **16:09:58**. So no step of this run ever executed anywhere, and no job log exists to read a failure from. **Not re-pushed, not force-pushed, not rerun** — there was nothing to repair, and between the 404 and row 48 no repository content changed (both carry the same SHA `63e422e`). Recorded rather than dropped, because a phase that closes on "the branch produced a green run" must also record the run that vanished |
| 48 | `37215752557` | `63e422e` | push | 16:09:58 | **success**, attempt 1, `completed` at 16:36:33 | `Database contracts` ran first (16:10:01→16:16:57) while `Static verification` stayed queued for the single runner until 16:17:07 — job order is the runner's dispatch, not a failure. Measured: `Run ./.github/actions/local-supabase` 16:10:59→16:13:24 success; `Committed migrations match the applied set` → `Migrations on disk: 24. Applied in the local database: 24. The replayed schema and the qualified schema are the same migration set.`; pgTAP `Files=8, Tests=364` `Result: PASS`; `Schema lint` → `No schema errors found`; live suites `9 passed (9)` files, `309 passed (309)` tests. `Static verification` 16:17:07→16:18:28: build `1711 modules transformed`, unit `30 passed (30)` files / `409 passed (409)` tests, ESLint and TypeScript green, credential scan `Scanned 241 files for 11 credential shapes.` + `No privileged credential found in the tracked tree or the built bundle.`, prod audit `No known vulnerabilities found`, dev audit `7 vulnerabilities found` (still `continue-on-error: true`). `Browser release smoke` 16:18:39→16:36:21: `Release journeys` → `Running 79 tests using 1 worker` → **79 passed (13.5m)** against `http://127.0.0.1:54321`, `React warning and console discipline` → **3 passed (42.4s)**, 0 failed, 0 skipped, 0 flaky, 0 did-not-run at `retries: 0`; `Scan artefacts before uploading them` green; only `Upload failure evidence` `skipped`, an `if: failure()` step with nothing to upload | **green, and this time through the branch's own `push` trigger** — run 46 was a manual `workflow_dispatch`, so row 48 is the evidence that residue A's trigger edit (`f34d340`) actually delivers a run without operator intervention. It is also the evidence that the documentation head `63e422e` is release-qualified on its own, not inherited |
| 49 | `37222377935` | `313fa97` | push | 17:55:41 | **failure**, attempt 1, `completed` at 03:13:50 | `Static verification` 17:55:45→18:06:47: steps 1–2 (`Set up job`, `Run actions/checkout@…`) `success`, step 3 `Run ./.github/actions/setup-toolchain` still `in_progress` with **every later step `pending`** and no completion timestamp (`0001-01-01T00:00:00Z`); `Database contracts` 03:03:48→03:13:49 died the same way, at the same step 3; `Browser release smoke` `completed / skipped`, because `ci.yml:121` gives it `needs: [static, database]` — so `313fa97`'s 79 + 3 browser slots were never executed by GitHub Actions. `gh run view --job 111495157568 --log` → `log not found`: the runner died mid-step, so no log was ever uploaded | **self-hosted machine state, not a repository, test, workflow-config or product defect.** `journalctl -u actions.runner.Pavithran-R-A-project-ar1.dueweave-local-ci.service` reads `Oct 04 17:55:40 … Running job: Static verification`, then `Oct 04 17:57:00 systemd[1]: Stopping actions.runner…service` — the host powered off 95 seconds into the job, and WSL cannot execute a step while the Windows host is down. `Get-CimInstance Win32_OperatingSystem.LastBootUpTime` = `05 October 2026 8:28:30 AM` = **02:58:30Z**, the boot that resumed it. The runner then took the queue back: `Oct 05 03:03:43 … Running job: Database contracts`, `03:05:16 … Runner connect error: Error: Conflict. Retrying until reconnected`, listener killed 03:05:30, `03:07:05 … Listening for Jobs`; the job it had been running was already orphaned from GitHub's side, which reaped it at 03:13:49 while the step was still marked `in_progress`. Control for the classification, measured rather than asserted: `git diff --stat 63e422e..313fa97` = `docs/CONSUMER_LIVE_PROGRESS.md | 54 insertions(+), 9 deletions(-)` — one documentation file, no workflow, test, source, migration or config change; and the parent head `63e422e` had passed the *identical* step 3 in row 48 at 16:17:07, 98 minutes before this job started. Preserved as red: **not rerun** (`gh run rerun` would rewrite the conclusion), **not pushed over while it was live**, and no retry, timeout or `continue-on-error` was added anywhere to make the number look better |
| 50 | `37259377698` | `9dcf299` | push | 03:25:21 | **failure**, attempt 1, `completed` at 03:39:42 | `Static verification` **success** 03:25:25→03:28:27 and `Database contracts` **success** 03:28:29→03:36:56 — this head's migrations, pgTAP suites, database-backed contracts, build, credential scan and both audits were all executed and green. `Browser release smoke` failed at step 3 `Run ./.github/actions/setup-toolchain` (03:37:09→03:39:30, `duration_ms=123014`) with `##[error]Process completed with exit code 1.` preceded by `WARN GET https://registry.npmjs.org/… error (ECONNRESET)` and `(ETIMEDOUT)` on twelve tarballs and the terminal `FetchError: request to https://registry.npmjs.org/rollup/-/rollup-4.64.0.tgz failed`; steps 4–9 (`local-supabase`, `Clear servers and reports…`, Chromium install, bundle build, `Release journeys`, `React warning and console discipline`) all `skipped`, so this head's 82 browser slots never ran. `Upload failure evidence` reported `No files were found with the provided path: test-results, playwright-report` — there was no artefact, because no test had started | **external network**, same family as row 40, and measured rather than assumed: (i) the step that failed is `pnpm install` — it asserts nothing about DueWeave; (ii) the *identical* step at the *identical* commit passed twice inside the same run, nine minutes earlier: `Progress: resolved 276, reused 0, downloaded 276, added 276, done` in both the static and database jobs, versus `resolved 276, reused 0, downloaded 242` in the browser job before it died; (iii) the runner's own registry path was healthy again minutes later — as the runner's WSL user, `curl https://registry.npmjs.org/rollup/-/rollup-4.64.0.tgz` → `code=200 time=0.377083 size=589213` and `tailwindcss-4.1.14.tgz` → `code=200 time=0.127019`, read at 03:42:54Z; (iv) `gh api` calls to GitHub from the same host succeeded throughout the outage window, so this was not the machine losing connectivity wholesale. **Nothing in this repository was changed in response**: the diff from the green `63e422e` head touches only documentation, no timeouts or retries were added, and the run is preserved as red — **not rerun** (`gh run rerun` would rewrite its conclusion) and **not pushed over while it was live**. The head that carries this row is the head the closure rule below judges |

Note what run 46 covers that no earlier run did: the 79-slot `Release journeys` set includes
`e2e/stage8-local-founder-customer.spec.ts` and `e2e/stage8-local-founder-reviewer.spec.ts`, and
`b80725a` is the head that carries both the product passthrough (`3d42f87`) and the one-frame
coverage reader. So the pointer-transparency repair and the geometry that proves it are now executed
by GitHub Actions on this branch, at `retries: 0`, rather than only on a laptop. Run 48 repeats that
coverage at the documentation head, so the record itself is executed, not just the code it describes.

**Why six runs were cancelled, measured rather than assumed.** `.github/workflows/ci.yml:17-19`
sets `concurrency.group: ci-${{ github.workflow }}-${{ github.ref }}` with
`cancel-in-progress: true`. On one runner a run costs ~26 minutes (run 44: 12:31→12:57), and this
phase pushed at intervals as short as 3 minutes (run 41 11:09:44, run 42 11:12:44). The
cancellations are the workflow's own documented supersede policy firing, not the machine losing
state — `Static verification`, `Database contracts` and `Browser release smoke` all report
`completed/cancelled` with no failed step in every one of the six. This is also why the last two
deliveries were pushed only after the previous run had reached a conclusion: pushing over an
in-flight run would have destroyed evidence this phase exists to collect.

**Run 47 is the one entry in this table that has no log.** It is kept because the honest reading is
narrower than a comfortable one: the branch's own push produced a run, GitHub then stopped
answering for that run id, and the same commit later produced a second, green run. Nothing in this
repository changed between the two, and nothing was rerun to replace it, so the claim this phase
rests on is run 48 — a run that exists, is attributable to `63e422e` by `head_sha`, and whose jobs
were received by the runner at the timestamps above — not on the vanished id.

**The operator precondition run 49 discovered, and why it is recorded instead of fixed in code.**
`dueweave-local-ci` is the audit laptop: the runner service lives in WSL2 on the same machine CI is
supposed to be testing, so a branch run depends on three host conditions no workflow file can
enforce — (i) the Windows host stays awake for the whole ~26 minutes the run takes, (ii) Docker
Desktop is running, because the `local-supabase` and pgTAP jobs reach the Docker daemon through WSL
integration, which only exists while that GUI application is up (`docker info` reported
`ServerVersion: 29.8.1` only after Docker Desktop was started again post-boot), and (iii) no laptop
`supabase start`/`supabase stop` overlaps a live database job, since the laptop and CI share one
Docker daemon *and* one project id `dueweave` (row 45). Rows 45 and 49 are the two failures that came
from the machine rather than the code, and both are kept in the trail. The repair this implies is an
operator rule for every future phase — start a branch run only when the host is awake, Docker Desktop
is up, and nothing in this workstream will touch the shared stack mid-run — not a repository change.
Adding retries, longer timeouts or `continue-on-error` to `ci.yml` would have hidden both failures
without making a single assertion stronger, which the brief forbids.

**One CI-infrastructure weakness run 50 exposed, recorded and deliberately left unfixed.** Every job on
this runner downloads the entire locked dependency tree from the public registry before it can assert
anything: the measured progress line is `Progress: resolved 276, reused 0, downloaded 276, added 276,
done` in *all three* jobs of run 50, at 03:25, 03:28 and 03:37, i.e. nothing was reused even though the
runner's store directory (`pnpm store path` → `/home/pavithran_r_a/.local/share/pnpm/store/v10`,
`457M`) is populated and the workspace (`…/_work/DueWeave/DueWeave`) exists. `.github/actions/setup-toolchain/action.yml`
expects that store to stand in for `cache: pnpm`, which cannot be used on a self-hosted runner (its own
comment records `Cache Provider could not be found`), so the expectation is not what the logs show. The
consequence is what killed rows 40 and 50: ~100 seconds of exposure to the network on every single job,
in a step that verifies nothing about DueWeave. This is a **machine/CI-configuration investigation, not
a product defect**, and it was not touched here: editing the install path in the same delivery that has
to produce Phase 2's closing green run would change the workflow under the exact evidence being
collected, and adding retries or timeouts would be the cover-up the brief forbids. It is handed to the
next phase as a named item with the numbers above attached.

## Remaining production blockers



Ordered by what has to happen first. Each names the gate that proves it closed, so none of them can
be closed by a claim.

| ID | Blocker | Status now | What closes it |
| --- | --- | --- | --- |
| B01 | **No production backend exists.** No hosted Supabase project has been created, linked or configured. | none | Owner decision (plan and cost), project creation, `supabase link`, migrations pushed, then re-measurement of the hosted database. Re-measured in Arc 2 Phase 2: it is also what holds the 8 class-E `controlled *` browser specs at "not executed" (`pnpm verify:e2e:local` = 173 passed / 8 skipped), so no amount of local re-running turns them green |
| B02 | **No hosting configuration and no public HTTPS URL.** | none | A static host for `dist/` with a real domain; TLS; then `docs/RELEASE_GATE_MATRIX.md` browser gates pointed at the deployed URL |
| B03 | **`main` has no CI workflow file at all** (`git show main:.github/workflows/ci.yml` fails). The three named checks arrive only with the integration PR. | true on `main` | The integration PR; then the required-check picker can see the names |
| B04 | **Hosted Auth is unproven**: signup email confirmation, Site URL, redirect allow-list, and real password-recovery delivery to a mailbox. `supabase/config.toml` disables signup confirmation locally and the recovery journey reads the local Inbucket inbox. | local-only proofs | Hosted Auth configuration plus a hosted smoke journey that signs up, confirms, signs out and recovers through real email |
| B05 | **Hosted project's own default privileges and role grants are unmeasured.** Fail-closed defaults are proved for this repository's migration role on the loopback stack only (`docs/SECURITY_MODEL.md`, "Known gaps"). | loopback-only | The two catalog queries in `docs/SECURITY_MODEL.md`, re-run against the hosted database after B01 |
| B06 | **Branch protection and rulesets are empty**; `main` accepts direct pushes, force pushes and deletion, and all three merge styles are allowed. | 404 / `[]` | Owner enables the rule in `docs/RELEASE_PROTECTION.md`; the plan's entitlement for private repos is UNKNOWN |
| B07 | **Founder monetization is fail-closed with 7 owner gaps and 0 reviewers.** `FOUNDER_V1` reports `destination-not-live`, `vpa-missing`, `support-pending`, `support-contact-unusable`, `refund-policy-pending`, `refund-policy-text-missing`, `disclosures-pending`; `select count(*) from public.founder_admins` is 0 on the delivered database. | NOT READY, by design | Only the owner's 12-step order in `docs/STAGE_4_2_OPERATOR_CONFIGURATION.md` plus the reads in `docs/FOUNDER_LIVE_ACTIVATION_CHECKLIST.md` and `docs/OPERATOR_BOOTSTRAP.md`. Never fabricated by a workstream |
| B08 | **The committed migrations (24 on disk as of `0983171`, up from 23 at the takeover head) have never been applied anywhere except a disposable local Postgres.** | local replays | Hosted `supabase db push` (or the dashboard) after B01, then `pnpm verify:migrations` and `pnpm verify:types` against the hosted schema |
| B09 | **CI cannot see this branch**: `release/consumer-live` was not in the workflow's push triggers and no PR exists. | **closed in Arc 2 Phase 2** | `f34d340` added the branch to `.github/workflows/ci.yml`'s `push` triggers; the branch has since produced fourteen runs of its own (thirteen still readable through the API plus one that vanished — see the Phase-2 run table), of which two are green on all three jobs on the self-hosted runner — run `37206353353` at head `b80725a` (`workflow_dispatch`) and run `37215752557` at head `63e422e`, produced by this branch's own `push` trigger with no operator dispatch (79 + 3 browser slots passed, 0 failed/skipped/flaky at `retries: 0`). That push-event green is the direct GitHub Actions evidence this phase existed to obtain — see the Phase-2 CI run table |
| B10 | **Accessibility is a targeted qualification, not a conformance claim.** `e2e/stage6-local-accessibility.spec.ts` holds keyboard, focus, announcement and reduced-motion behaviour. | gate passes, no cert | A WCAG decision by the owner if a certification is required |
| B11 | **No performance or concurrency qualification** exists; nothing measures multiple simultaneous users. | not attempted | Load work after B01/B02; stated as out of scope for every gate so far |
| B12 | **Development-tree advisories, repaired as far as a compatible change reaches: 41 → 7.** `pnpm audit --prod` stays `No known vulnerabilities found`. The 7 remaining are the `vitest@2.1.9` cluster in B16. | reduced, not closed | See "Development-toolchain advisories, repaired and remaining"; closes only when B16 closes |
| B13 | **Two documented test gaps** (residual gaps 1-2 of `docs/STAGE9_ABUSE_MATRIX.md`). | **closed in Arc 2 Phase 2** | Gap 1 closed by `7f87f21`: LIVE probes drive the malformed-phone rule through `create_client` and `create_client_and_receivable`, read from the verbs' existing behaviour rather than invented. Gap 2 closed by `0983171`: one explicit product rule (a required ledger field is blank in exactly the class `String.prototype.trim()` treats as blank; optional text is not widened), forward migration `20261004170000_current_arc2_ledger_required_blank_class.sql`, 170 new LIVE probes and a 5-test no-container contract pin |
| B14 | **Operational and legal surface does not exist yet**: published privacy terms, consumer disclosures, refund text, a monitored support address, the manual bank-review operating procedure, backups, secret rotation, log retention, rate limits at the edge. | none | Owner work with their own advice; `docs/OPERATOR_BOOTSTRAP.md` is the review runbook the product assumes |
| B15 | **No rollback or recovery instructions for a deployed environment.** Every recovery document here assumes a laptop stack, not a hosted database. | none | A `docs/PRODUCTION_ROLLBACK.md` written after B01/B08 exist, and rehearsed |
| B16 | **Seven development-tree advisories that only a Vitest-major upgrade clears** (1 critical, 1 high, 5 moderate), all reachable through `vitest@2.1.9` and the `vite@5.4.21` it carries. `pnpm audit --prod` is clean; no script, gate or runbook in this repository starts the Vitest UI server or a Vitest-owned dev server. | open, recorded | `vitest` to `>=4.1.11` as its own change, re-qualifying 30 unit files / 409 tests, 9 live files / 309 tests and the 82-slot browser battery on the new runner's semantics — not bundled into a dependency-number fix. Details in "Development-toolchain advisories, repaired and remaining" |

Anything that would make the product "100% consumer-live" but is not in this table is not yet known;
this table is the audit's whole answer.

## Development-toolchain advisories, repaired and remaining

Phase 2 residue G. The blocking audit (`--prod`) has been clean throughout; every advisory in this
section lives in the development tree, so none of them can reach a consumer's browser or the
database. They were still repaired as far as a *compatible* change reaches, because a red number in
a recorded step is how real findings hide.

Measured before: `pnpm audit --audit-level=high` → **41** (1 low, 18 moderate, 20 high, 2 critical).
Measured after: **7** (5 moderate, 1 high, 1 critical). Exit code 1 both times, and the CI step is
unchanged — `continue-on-error: true` at `.github/workflows/ci.yml`, still printing its own
`##[error]Process completed with exit code 1.` line, still not presented as a pass.

What was changed, and why each change is compatible rather than forced. No `pnpm audit fix --force`
was run, and no direct dependency was moved to a new major:

| Change | Mechanism | Parent's own range | Effect |
| --- | --- | --- | --- |
| `vite ^7.1.7` → `^7.3.6` (devDependency) | `pnpm update vite` | n/a — direct | clears the three `vite >=7.0.0 <=7.3.1` / `<=7.3.4` high advisories, including both `server.fs.deny` bypasses |
| `rollup`, `postcss`, `picomatch`, `esbuild` duplicate copies | `pnpm dedupe` | each parent already permits the surviving copy | one patched copy instead of a patched and a vulnerable one side by side; clears the two PostCSS highs, the Rollup path-traversal high and the Picomatch ReDoS high |
| `tar`, `browserslist`, `brace-expansion`, `@babel/core` | four `pnpm.overrides` entries in `package.json` | `@tailwindcss/oxide` asks `tar ^7.5.1`; eslint's `minimatch@10` asks `brace-expansion ^5.0.8`; `@babel/helper-compilation-targets` asks `browserslist ^4.24.0` and `update-browserslist-db` `>= 4.21.0`; `@vitejs/plugin-react` asks `@babel/core ^7.28.4` | each override names the *same major* the parent already allows, so the resolver picks a patched release inside the range the parent tested against — not a forced upgrade |

The overrides are written in `package.json`'s `pnpm` field even though pnpm 10.4.1 prints
`[WARN] The "pnpm" field in package.json is no longer read by pnpm` on every install. That warning
is measured, not assumed: the resolutions it "ignored" did move (`tar@7.5.1` → `7.5.22`,
`browserslist@4.26.3` → `4.29.3`, `brace-expansion@5.0.9` → `5.0.12`, `@babel/core@7.28.4` →
`7.29.7`), the lockfile carries them in its own `overrides:` block, and `pnpm install
--frozen-lockfile` — the command CI runs — completes with `Lockfile is up to date, resolution step is
skipped`, exit 0. So CI installs exactly these versions from the lockfile. `pnpm-workspace.yaml` was
tried first and rejected on measurement: with pnpm 10.4.1 it fails the install outright
(`ERROR packages field missing or empty`), and adding `packages: ['.']` to satisfy it would turn a
one-package repository into a workspace — a larger change than the advisory it clears. When this
repo moves to a pnpm that truly ignores the field, the override block has to move with it; the
warning is the tripwire.

The 7 that remain are one cluster, and its name is `vitest@2.1.9`:

| Advisory | Severity | Reach | Why it was not forced away |
| --- | --- | --- | --- |
| Vitest UI server allows arbitrary file read and execution (`<3.2.6`) | critical | `. > vitest@2.1.9` | patch is `>=3.2.6`, two majors above the declared `^2.1.4` |
| Vitest / `@vitest/mocker` path traversal (`>=2.1.0 <4.1.11`) | moderate ×2 | `. > vitest@2.1.9`, `… > @vitest/mocker@2.1.9` | patch is `>=4.1.11` — even Vitest 3 does not clear it |
| `vite <=6.4.2` `server.fs.deny` bypass on Windows alternate paths | high | `. > vitest@2.1.9 > vite@5.4.21` and `… > vite-node@2.1.9 > vite@5.4.21` | Vitest 2 declares `vite ^5.0.0`; the patch is `>=6.4.3`, outside its own range |
| `vite <=6.4.1` path traversal in optimised-deps cache; `vite <=6.4.2` launch-editor NTLMv2 hash disclosure over UNC | moderate ×2 | same `vite@5.4.21` | same reason |
| `esbuild <=0.24.2` cross-origin requests to the dev server | moderate | `… > vite@5.4.21 > esbuild@0.21.5` | patch `>=0.25.0`; vite 5 pins `esbuild ^0.21.5` |

Calling these "harmless" would be a lie, so the claim being made is narrower and checkable: the
surfaces they describe are servers, and this repository starts none of them. Every `package.json`
script that touches Vitest runs `vitest run` (`test`, `test:unit`, `test:live`, `test:stage*`) — no
`--ui`, no `--api`, no watch mode, so no Vitest UI server ever listens; no CI job, no gate and no
operator runbook command starts one. The dev-server-shaped Vite and esbuild advisories belong to the
`vite@5.4.21` copy that Vitest 2 carries internally, not to the `vite@7.3.6` the app's own `dev`,
`build` and `preview` use — the app's Vite is patched. What is *not* proven is that a developer who
later runs `vitest --ui` on this machine is exposed: that is exactly the case the critical advisory
describes, and it is the reason this stays an open blocker rather than a footnote.

The repair is a Vitest-major task of its own, not a release-qualification side effect: `vitest` to
`>=4.1.11` clears all five Vitest/Vite/esbuild entries at once, because Vitest 4 carries a patched
Vite and esbuild. That change re-qualifies 30 unit files / 409 tests, 9 live files / 309 tests and
the 82-slot browser battery on a new runner's transform, config and assertion semantics — which is a
test-infrastructure upgrade, and it must not be bundled into a dependency-number fix. Recorded as
blocker **B16** in the table above.

## Hosting and backend decision (ADR-001, proposed — owner-required)

Phase 2 was instructed to create no hosted backend, no deployment and no resource with an unclear
cost, and it created none. What it can do honestly is record the decision a later phase would act
on, together with the measurements that constrain it, so the owner is choosing with facts rather
than with a guess.

Measured shape of the thing to be hosted:

| Fact | Measurement |
| --- | --- |
| Hosted Supabase project | **none.** The only stacks on this machine are local: `supabase_*_dueweave` (this project's disposable loopback stack) and `supabase_*_localvivaahvarnam`, which belongs to a different product and was not touched by this workstream (`docker ps`) |
| Host configuration files | `ls` of the repository root filtered on `vercel\|netlify\|fly\|railway\|docker\|_headers\|redirects\|cloudflare\|wrangler` → **no match** (exit 1). Nothing in the tree names a provider |
| Deployable artefact | `pnpm build` → `dist/` (`vite.config.ts` `build.outDir`): `index.html` plus static JS/CSS chunks, 1711 modules. There is no server bundle to host — `server/`, Express, tRPC and the Manus runtime were deleted at Stage 4.1 (`docs/STAGE_4_1_HARDENING.md`) |
| Runtime configuration the client reads | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only (`.env.example`), both browser-safe by design; every privileged shape is documented as never allowed in a `VITE_*` variable and is gated by `pnpm verify:secrets` |
| Routing | `wouter` on a static SPA, so the host must rewrite every unmatched path to `index.html` or deep links 404 |

The proposal, in the order it should be decided:

1. **Static host: Cloudflare Pages on its free plan, as the preferred zero-cost candidate.** The
   artefact is a pure static `dist/`, so a static host with SPA rewrites, TLS and cache headers is
   sufficient — nothing in this product needs a Node runtime.
2. **Do not default to Vercel Hobby.** The Hobby tier's own terms restrict it to non-commercial /
   personal projects, and DueWeave's purpose is a monetized product with a Founder plan. If the
   owner chooses Vercel anyway, the paid plan is a cost decision, not a default. Reading the live
   terms at sign-up is the owner's step; this is a documented reason not to reach for it silently.
3. **A provider-issued HTTPS hostname is enough for first qualification.** A `*.pages.dev` URL
   clears B02's technical content (public HTTPS, a real deployment of `dist/`) without buying a
   domain. A custom domain, its DNS and its TLS posture stay separate owner decisions.
4. **The Supabase backend's zero-cost assumption is unverified, and is the owner's to confirm.**
   There is no evidence available from this repository that an unused Supabase Free project
   allocation is reserved for DueWeave. So: do not create the project until the owner confirms the
   plan and the cost. **Never** pause, delete or repurpose an existing Supabase project to make
   room, and **never** point DueWeave at another product's database — that second local stack above
   is exactly the kind of thing that gets overwritten by mistake.
5. **Order of work if accepted:** B01 (project, `supabase link`, migrations pushed, hosted
   re-measurement) → B08 (hosted replay of the 24 migrations) → B04/B05 (hosted Auth and hosted
   default-privilege reads) → B02 (Pages deployment of `dist/`) → B15 (rollback and recovery,
   written and rehearsed against the hosted stack, not the laptop). B07 stays fail-closed
   regardless: nothing in hosting changes Founder monetization.

This section decides nothing by itself. It is here so that the phase which does create the
resources starts from a measured target instead of a default.

## Owner-only actions

Deliberately not performed by this workstream, and not performable by any engineering pass:

- Create or choose the hosted Supabase project and the static host, and decide anything with a cost
  implication (the design targets Supabase Free, GitHub Free and static hosting — the plan tier of a
  newly created project is not knowable from here, so it needs the owner's confirmation).
- Buy or point a domain; publish DNS; decide the TLS posture.
- Configure hosted Auth: email provider/SMTP, Site URL, redirect allow-list, signup confirmation.
- Allowlist a reviewer UUID into `public.founder_admins`, configure a real VPA and payee name,
  approve the refund text and consumer disclosures, publish a monitored support address.
- Enable branch protection or rulesets; approve and merge any pull request; decide PR #1's fate;
  create a tag, a release, or a deployment.
- Print or store any privileged credential: no service-role key, `sb_secret_*`, database password,
  SMTP credential, payment credential or registration token appears in this file, in any commit, or
  in any log produced by this workstream.

## Production URL and backend

| Field | Value |
| --- | --- |
| Production URL | **does not exist yet** |
| Hosted Supabase project ref | **does not exist yet** |
| Deployment provider | **not chosen** |
| First successful production migration replay | **not performed** |
| First CI run green at a `release/consumer-live` head | **performed 2026-10-04.** First by manual dispatch: run `37206353353`, head `b80725a`, event `workflow_dispatch`, `completed / success`, all three jobs green on the self-hosted runner. Then by the branch's own trigger, which is the one that matters for a branch with no PR: run `37215752557`, head `63e422e`, event `push`, attempt 1, `completed / success`, 79 + 3 browser slots passed (`gh run view 37215752557 --json status,conclusion,attempt,headSha,jobs`). These are the only rows above that are no longer a gap; the other four still describe a pre-deployment project, and a green run here says nothing about hosting |

These five rows are what tells a reader whether the project has left pre-deployment. Fill them in the
phase that creates the thing, with the measurement command beside each value.

## Phase 2 closure — how each exit condition is proven, not claimed

Phase 2's last commit is a documentation commit, so its own SHA cannot contain a record of its own
CI run. The convention used here is the one Stage 9 closed on: **the file states the rule and the
command, and the run is read from GitHub Actions against the SHA `git ls-remote` reports**, not
written into the file by hand. A reader verifies closure with

```
git ls-remote origin refs/heads/release/consumer-live        # the final Phase 2 SHA
gh api "repos/Pavithran-R-A/DueWeave/actions/runs?head_sha=<that SHA>&per_page=1" \
  --jq '.workflow_runs[] | {id, event, status, conclusion, attempt}'
```

and the exit condition is that run having `Static verification`, `Database contracts` and `Browser
release smoke` all `success`. **A green run at a parent head does not prove the child documentation
commit** — that is why run 48 is recorded at `63e422e`, why run 46 is recorded at `b80725a`, and why
the closure commit's own run is the number a reader must go and look at.

This is the **second** attempt at that closure commit. The first, `313fa97ba69e6af92d89b289b68ae65e117f7155`,
was pushed normally at 17:55:41 and produced run `37222377935`, which died twice through no change in
this repository (row 49). It therefore has **no** green run, is kept as red, and is not claimed as
Phase 2's final head; the head this file is committed on now inherits nothing from it either. Run 48's
green at `63e422e` proves `63e422e` and run 46's green at `b80725a` proves `b80725a`; neither of them
proves the SHA the branch finally rests on, and Phase 2 does not close until that SHA's own run is
green on all three jobs.

The head that carries the row for run 49 then lost its own push run the same way (`37259377698` at
`9dcf299`, row 50 — the registry timed out inside `pnpm install` in the browser job, after the static
and database jobs had passed that same step at that same commit nine minutes earlier). That is a third
delivery, and the rule has not moved: the red runs at `313fa97` and `9dcf299` stay in the trail
untouched, no run was rerun to overwrite a conclusion, and the head this file now sits on is judged
only by the run that commit itself produces.

| Exit condition | State | The measurement that holds it |
| --- | --- | --- |
| Run `37222377935` (push, head `313fa97`) stays red in the trail | **preserved, not rerun, not pushed over** | `completed / failure`, `attempt: 1`, 17:55:41Z→03:13:50Z; both jobs frozen at step 3 `Run ./.github/actions/setup-toolchain` (`in_progress`, later steps `pending`), `Browser release smoke` `skipped` via `ci.yml:121`, and `gh run view --job 111495157568 --log` → `log not found`. Classified self-hosted machine state on the journal + boot-time + empty-diff evidence in row 49; no workflow, test or retry was touched to turn it into a pass |
| Run `37259377698` (push, head `9dcf299`) stays red in the trail | **preserved, not rerun** | `completed / failure`, `attempt: 1`, 03:25:21Z→03:39:42Z, with `Static verification` and `Database contracts` both **success** at this head and only `Browser release smoke` failing — at `pnpm install`, not at a test. Classified external network on the four measurements in row 50, including the same step passing at the same commit nine minutes earlier and `code=200` from the runner's own WSL against the two tarballs that failed. No `ci.yml`, test or dependency change was made in response; a `workflow_dispatch` was **not** fired at this head either, because both events share `concurrency.group: ci-CI-refs/heads/release/consumer-live` and `cancel-in-progress: true`, so a second live run on the branch would have cancelled the first |
| Run `37206031787` (push, head `b80725a`) stays red in the trail | **preserved, not overwritten** | `conclusion: failure` at attempt 1: `Static verification` success, `Database contracts` failed at `Run ./.github/actions/local-supabase`, `Browser release smoke` skipped. It is described in row 45 with its timestamps and its classification. It was *not* rerun — the same head was re-observed by a separate `workflow_dispatch` so the original record is never rewritten |
| Run `37206353353` recorded as the accepted exact-SHA remeasurement of `b80725a`, separately from run 45 | **recorded as row 46** | `completed / success`, `attempt: 1`, event `workflow_dispatch`, created 13:38:47Z; all three jobs green on `dueweave-local-ci`; the only `skipped` step is `Upload failure evidence`, an `if: failure()` step with nothing to upload |
| The composite release gate's exit code is trusted only from an adjacent capture | **`exit 0`, re-measured** | `pnpm verify:release:local` was run twice. The first attempt's status read printed `exit=-1`, which is not a POSIX exit code, so it was treated as a failed *capture*, not a failed *gate*, and was not papered over with log text (13 stage banners, no `ELIFECYCLE`). The rerun stored the status on the line immediately after the command: **`verify_release_local_rerun exit=0`** with the complete stage chain. No conclusion in this file rests on a wrapper shell, a chained `pnpm` caller, the absence of an error string, or that `-1` reading |
| Local stack taken down only by the repository's own mechanism | **done, twice** | `npx supabase stop --no-backup` run from the project root, output passed through `scripts/redact-cli-secrets.mjs` before it was read. No `docker system prune`, no bare `docker rm`/`docker kill`, no global cleanup. The foreign stack on the same daemon (`supabase_*_localvivaahvarnam`, another product) was never touched — it is still `Up`, which is the proof it was left alone |
| Only the intended documentation files changed in the closure commit | **docs-only** | `git add` names `docs/CONSUMER_LIVE_PROGRESS.md` (and, for the earlier rows, `current_stage9_security_ci_report.md`) explicitly; `client/src/types/database.generated.ts` was **not** staged, and the claim that it is an EOL-only phantom was proved rather than assumed: `git diff --numstat` reports no line changes for it and `git diff --ignore-cr-at-eol --stat` reports an empty diff |
| Pushed normally, remote identity verified | **performed** | plain `git push` (no `--force`, no history rewrite), then `git ls-remote origin refs/heads/release/consumer-live` == `git rev-parse HEAD`. The `remote: This repository moved.` notice on push is expected while `origin` still points at the old `project-ar1` URL; `git remote set-url` was **not** run |
| No test weakened, no gate widened, no failure hidden | **held** | `retries: 0` unchanged throughout; the dev-toolchain audit is still recorded with exit 1 and still `continue-on-error: true`; the 8 class-E browser specs are still recorded as **not executed**, not as passing; residue H was repaired on the test side only after the product assertions were shown never to have failed |

## Phase log

| # | Date | Phase | Branch and head | What was verified | Blockers changed |
| --- | --- | --- | --- | --- | --- |
| 1 | 2026-10-04 | Takeover, preflight and repository audit | `release/consumer-live`, created at `e5b734b6a24489b80fde65b0909f14bb7a56d64b` | The static gate set re-executed on this branch (lint, typecheck, 386-test unit half with the three class-C contracts then executed against a fresh `dist/`, secret scan over 237 files, clean production audit, counted dev-tree advisories); CI run `37009951112` read job-by-job and step-by-step; PR list, protection state, rulesets, trigger list and the absence of any hosting surface measured | B01-B15 recorded; none closed |
| 2 | 2026-10-04 | Branch-local CI evidence, repository-side residues A-H, full local gate re-measurement | `release/consumer-live`, code head `b80725ad212c5e2bebd707e7bad9c8d4e2474891`; the recording head is this file's own commit, read with `git rev-parse HEAD` / `git ls-remote origin refs/heads/release/consumer-live` | Phase 1's CI attribution corrected against the API (it produced no run at all); `release/consumer-live` added to the workflow's push triggers (`f34d340`) and fourteen branch-local runs read job-by-job and step-by-step: two green across all three jobs (run `37206353353` at the code head `b80725a`, by dispatch; run `37215752557` at this file's own head `63e422e`, produced by the branch's `push` trigger with no operator dispatch), five red kept in the trail (`37193639709` external network, `37202389761` the test defect residue H fixed, `37206031787` this workstream's own laptop/CI stack overlap, `37222377935` the host powering off mid-run at the first closure head, `37259377698` the registry timing out inside `pnpm install` at the second), six cancelled by the workflow's documented supersede policy, and one (`37213354566`) that vanished from the GitHub control plane and is recorded with the runner-journal proof that no job of it was ever handed to the machine; residues A-G repaired (`83e3a8f`, `06818f4`, `2150308`, `3d42f87`, `7f87f21`, `0983171`, `5718b6a`) and residue H (`b80725a`) found and fixed *by this branch's own CI*; the whole local gate set re-executed against the disposable stack (24 migrations from zero, pgTAP 8 files/364 assertions, 9 live files/309 tests, 30 unit files/409 tests with 0 skipped, 241-file credential scan, prod audit clean, dev audit 7 recorded with exit 1, browser batteries 79 passed and 3 passed with 0 skipped at `retries: 0`, full local battery 173 passed / 8 class-E not-executed) and as the `pnpm verify:release:local` composite, re-run to **exit 0** after its first status read failed to produce a valid code; ADR-001 recorded as a proposal with measured facts and no resource created | B09 **closed**, B13 **closed**, B12/B16 re-measured and re-stated (41 → 7, not closed), B01 restated with the 8 class-E browser specs it holds, B02-B08 and B10-B11, B14-B15 unchanged: none of them can be closed without an owner decision or a hosted backend |

Phase 1's own commit is the head of `release/consumer-live` when this file lands, so its SHA is read
with `git rev-parse HEAD` or `git ls-remote origin refs/heads/release/consumer-live` rather than
written here by hand — the same way Stage 9 ended its documentation-head recursion instead of
chasing a number that cannot contain itself.

## How to continue

1. Read this file, then `docs/RELEASE_GATE_MATRIX.md` (property → command → where it can run),
   `current_stage9_security_ci_report.md` (the accepted Stage 9 evidence), and the Founder documents
   named in B07 before touching anything payment-adjacent.
2. Work forward: one coherent change, smallest correct form, run the gates that cover it, commit with
   a descriptive conventional message, **push immediately**, then verify
   `git ls-remote origin refs/heads/release/consumer-live` equals local `HEAD`.
3. Never weaken a test to turn a gate green, never raise a timeout or a retry instead of finding the
   defect, never hide a failure or add an unjustified skip, never force-push or rewrite published
   history, never base work on `main`, never commit `.env` material or a privileged credential.
4. End every phase with `git status` clean apart from the documented CRLF phantom, and with this file
   updated: new phase row, the current-phase section, the executed-test table, and any blocker that
   actually moved.
