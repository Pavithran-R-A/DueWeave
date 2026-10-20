# Release gate matrix (Stage 9)

One authoritative map from each property this release claims to `command → test files → where
it can run → whether it can report green while proving nothing`. Stage 9 PHASE 3 asked for this
document because Stages 2-8 accumulated evidence faster than anyone could re-read it: the plan's
rule is that **no PASS may mean "skipped because the environment was absent"**, and a blocking
gate must either execute or say out loud that it could not.

Every measurement below was taken on 2026-09-29 on this branch (`current-stage-9-security-ci`,
base `ccc4438`) against the project's own disposable loopback Supabase stack. Closure re-measures
them (#152); the numbers here are the current ones, not a copy of an earlier report.

## The commands

| What a release must be | Command | Where it runs | Status |
| --- | --- | --- | --- |
| The whole non-browser release | `pnpm verify:release:local` | laptop, in the order below | blocking |
| The CI browser subset | `pnpm test:e2e:smoke` | CI `browser` job + laptop | blocking |
| The PHASE 16 warning/console gate | `pnpm test:e2e:react-warnings` | CI `browser` job + laptop | blocking |
| The flags-off (paused) bundle gate | `pnpm test:e2e:paused` | CI `browser` job + laptop | blocking |
| The full browser battery | `pnpm verify:e2e:local` | laptop only | reference |

## The matrix

Status columns: **Local** = what a laptop needs to run it; **CI** = which job runs it
(`static` / `database` / `browser`), *none* = CI deliberately does not; **Hosted-only** = the part
of the property that neither a laptop nor CI can prove.

| # | Property | Command | Test file(s) | Local | CI | Hosted-only | Blocking |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | Locked dependency install | `pnpm install --frozen-lockfile` | `.github/actions/setup-toolchain/action.yml` | README ordered commands | all three jobs | — | yes |
| B | Lint | `pnpm lint` | `client/src`, `tests`, `e2e`, `scripts`, `vite.config.ts`, `--max-warnings=0` | none | static | — | yes |
| C | Type-check | `pnpm check` (`tsc --noEmit`) | whole TypeScript surface | none | static | — | yes |
| D | Unit + boundary contracts | `pnpm test:unit` | 24 files / 363 tests as executed by CI runs 18 and 19 (heads `ec868e8`, `f4bcc61`); 25 files / 368 as executed by CI runs 20 and 21 (heads `f28bae6`, `f03fd0d`); 26 files / 371 on this tree once the D-S9-9 toast-occlusion contract is counted (the next run after this commit prints it), incl. `tests/credential-boundary.contract.test.ts`, `tests/production-module-graph.contract.test.ts`, `tests/security-contract.test.ts`, and the five gate contracts this stage added (`tests/ci-gate-manifest.contract.test.ts`, `tests/release-command-contract.test.ts`, `tests/e2e-battery-flags.contract.test.ts`, `tests/ci-log-credential-redaction.contract.test.ts`, `tests/e2e-refusal-toast-occlusion.contract.test.ts`) | built bundle for the 3 bundle contracts | static | — | yes |
| E | Production build | `pnpm build` | `dist/` (measured: built in 12.34 s, `index-*.js` 498.18 kB / 144.28 kB gzip) | none | static + browser (before the journeys) | — | yes |
| F | Production dependency audit | `pnpm audit --prod --audit-level=high` | `pnpm-lock.yaml` runtime graph | network | static | — | yes |
| F' | Toolchain audit (dev tree) | `pnpm audit --audit-level=high` | same, dev graph | network | static | — | **no** — recorded, see below |
| G | Secret / privileged-credential scan | `pnpm verify:secrets` | `scripts/verify-secrets.mjs` (11 shapes; since Stage A the tracked tree, the untracked files a `git add -A` would stage, and `dist/`) | built bundle for the bundle half | static + `browser` artefact scan | — | yes |
| G' | CI **job-log** credential redaction (D-S9-7) | the start step pipes through the filter: `pnpm supabase:start 2>&1 \| node scripts/redact-cli-secrets.mjs` under `set -o pipefail` in `.github/actions/local-supabase/action.yml` | `scripts/redact-cli-secrets.mjs` masks the `sb_secret_`/service-role family, connection-string passwords and privileged-role JWTs before they reach the retained log; pinned by `tests/ci-log-credential-redaction.contract.test.ts` (5 cases, incl. the anti-vacuous control and the step-shape pin) | filter + step composition, no stack needed | static (as a unit case) **and** measured live on run `36569878819`: zero privileged shapes across all six expanded logs, `[redacted-sb-secret-key-41-chars]` and `[redacted-db-password]` rows present in both environment logs | — | yes |
| G2 | The **staging surface** itself: a repository root with nothing loose at it, read before the scan that now covers the same files (Stage A CL-7) | `pnpm verify:hygiene` | `scripts/verify-untracked-hygiene.mjs` fails on any untracked, non-ignored entry at the repository root — the set `git add -A`, `git add .` and an IDE "commit all" reach without a second thought — and `.gitignore` carries a root-anchored rule for each of the six evidence directories the hosted instruments write, named one by one so no rule can also swallow a same-named source directory deeper in the tree. Measured BEFORE at head `4d82978`: eight loose root entries, 109 files, 5,586,500 bytes, among them a QA identity file holding the account's working password and the confirmation and recovery mailbox captures for that same address, while row G's list was the tracked 285 files plus `dist/`, so the scanner reported a clean tree over a scope that excluded all of it. Pinned by `tests/untracked-add-surface.contract.test.ts` (9 cases: the finding in a scratch tree, the honest scope sentence, `.gitignore` still honoured, the no-git failure, the gate's own red-green, the release and CI and matrix wiring, this working tree, the six anchored rules, and no live pointer at a retired credential path). Measured AFTER at this head: `git add -A --dry-run` stages 14 paths, every one of them source, config or documentation; the repository root carries no loose entry and the staging surface is the 2 new gate files; the 107 evidence files moved into the ignored set (`git ls-files --others --ignored --exclude-standard`); row G now reads 309 files rather than 285. The first finding the widened scope produced was this test's own PEM fixture — `HARD private-key-block` in a file the old scanner never opened, which is the miss being repaired working on its author — and it was fixed by assembling the header the way the scanner's own rule source does, not by excusing it, because a hard rule cannot be allowlisted and that is the point of it | a scratch git repository the test builds and tears down; no stack, no bundle | static | `.gitignore` stops accidental staging, not read access; `docs/SECURITY_MODEL.md` records the inherited ACL that makes that distinction matter on this host | yes |
| H | Database zero replay | `pnpm db:reset:local` + `pnpm verify:migrations` | 23 committed migrations, 23 applied | loopback stack | database (via `.github/actions/local-supabase`, `reset: "true"`) | — | yes |
| I | Generated-types determinism | `pnpm verify:types` | `client/src/types/database.generated.ts` vs live schema (measured match, 38 326 bytes) | loopback stack | database | — | yes |
| J | pgTAP (in-database policy, trigger, privilege proofs) | `pnpm test:db` | `supabase/tests/*.sql` — measured Files=8, Tests=364, PASS | loopback stack | database | — | yes |
| K | Schema lint | `pnpm db:lint` | `supabase/config.toml` + public/extensions schemas (measured "No schema errors found") | loopback stack | database | — | yes (PHASE 22) |
| L | Stage 2 auth foundation | `pnpm test:live` (suites) · `pnpm test:e2e:smoke` (product path) | `tests/stage2-local-foundation.test.ts`; `e2e/stage2-local-auth.spec.ts`, `e2e/auth-gateway.spec.ts`, and the signup/sign-in steps of `e2e/stage9-release-journey.spec.ts:210` | loopback stack | database; browser only through the Stage 9 journey | email-confirmation delivery (`e2e/auth-lifecycle-limits.spec.ts`) | yes |
| M | Stage 3 tenant isolation | `pnpm test:live` · `pnpm test:e2e:smoke` | `tests/stage3-local-rls.test.ts`; `e2e/stage9-account-isolation.spec.ts` (8 attacks), `e2e/stage3-local-isolation.spec.ts` | loopback stack | database + browser | — | yes |
| N | Stage 4 persistence + edits | `pnpm test:live` · `pnpm verify:e2e:local` | `tests/stage4-local-edit-workflows.test.ts`, `tests/stage4-local-repository-edit.test.ts`; `e2e/stage4-local-persistence.spec.ts`, `e2e/stage41-client-conversion.spec.ts` | loopback stack | database; browser journeys only via Stage 9 | — | yes |
| O | Stage 5 promise / payment lifecycle | `pnpm test:live` · `pnpm test:e2e:smoke` | `tests/stage5-local-lifecycle.test.ts`; `e2e/stage5-local-lifecycle.spec.ts`, `e2e/stage9-release-journey.spec.ts:266,289,327` | loopback stack | database + browser | — | yes |
| P | Stage 6 UX / accessibility / responsive | `pnpm test:live` · `pnpm test:e2e:smoke` (a11y) · `pnpm verify:e2e:local` (responsive) | `tests/stage6-local-profile.test.ts`; `e2e/stage6-local-accessibility.spec.ts` (8 tests incl. the reduced-motion walk), `e2e/stage6-local-responsive.spec.ts` (widths 360×800 … 1440×900), `stage6-local-{auth-ux,forms,interaction,ledger-states,mutations,first-user,workspace-gate}.spec.ts` | loopback stack | database + browser (a11y only) | — | yes |
| Q | Stage 7 follow-up + export | `pnpm test:live` · `pnpm test:e2e:smoke` | `tests/stage7-local-export.test.ts`; `e2e/stage7-local-export.spec.ts`, `e2e/stage7-local-followup.spec.ts` | loopback stack | database + browser | real WhatsApp handoff (only the URL is proved) | yes |
| R | Stage 8 Founder customer / reviewer | `pnpm test:live` · `pnpm test:e2e:smoke` | `tests/stage8-local-founder-readiness.test.ts`, `tests/stage8-founder-contracts.test.ts`; `e2e/stage8-local-founder-customer.spec.ts`, `e2e/stage8-local-founder-reviewer.spec.ts` | loopback stack + `TEST`-mode offer | database + browser | real UPI/VPA settlement, live-mode review | yes |
| S | Logout / login persistence | `pnpm test:e2e:smoke` · `pnpm verify:e2e:local` | `e2e/stage9-release-journey.spec.ts:452` (profile edit → sign out → sign in → same ledger), `e2e/stage6-local-auth-ux.spec.ts:256` (sign-out leaves nothing), `:304` (lost stored session returns to the gateway) | loopback stack | browser (the journey) | — | yes |
| T | Abuse / validation cases | `pnpm test:live` (+ `test:unit`, `test:db`, `test:e2e:smoke` for the rest) | `docs/STAGE9_ABUSE_MATRIX.md` is the ledger of all 20 cases and names, per case, the file that reaches the failure. `tests/stage9-abuse-matrix.test.ts` (7 tests) is that executed proof for 5 of them — cases 4, 6, 7, 8, 10 — and the remaining 15 are executed across the live, unit, pgTAP and browser files the ledger cites | loopback stack | database | — | yes |
| U | Arc 3C account erasure (B17): an authenticated owner can delete their own account and its ledger history without reopening immutability | `pnpm test:live` (the erasure battery) · `pnpm test:db` (the pgTAP file) · `node scripts/local-functions-serve.mjs start` / `stop` (the CI serve of the function the battery calls) · `node scripts/verify-secrets.mjs --dir supabase/functions` | `tests/arc3c-local-account-erasure.test.ts` (the brief's STEP 6 battery — **measured 22/22 on 2026-10-06** with the function served; it needs the stack **and** `ALLOWED_APP_ORIGIN` reaching the runtime, which the serve script supplies), `supabase/tests/arc3c_01_account_erasure.sql` (`plan(41)`, **measured inside `Files=9, Tests=405, PASS`**); the static halves are `tests/arc3c-erasure-contract.test.ts` (19 tests) and `tests/arc3c-account-deletion.test.ts` (26). Design and threat model: `docs/ACCOUNT_ERASURE_DESIGN.md` | loopback stack + the function served | database — **written this phase, not yet proven by a run.** `.github/workflows/ci.yml` now serves `delete-account` (from an env file carrying only `ALLOWED_APP_ORIGIN`) immediately before `pnpm test:live` and releases it under `if: always()`, so the row is reachable by CI; no Phase 3C head has executed that job yet, and the two static suites alone reach CI via `static` | the migration applying to the hosted project, the function deploying, and one real deletion of a real account — B17 and B19 stay open until then | yes — **executed locally at the Phase 3C head, not executed in CI.** The browser half (the erasure sheet actually rendered) has still never run |

| V | Flags-off bundle (CL-9): the artifact a paused production build produces offers no way to open registration, recovery or a confirmation email, and a screen that reports a wait cannot leak into the signup form | `pnpm test:e2e:paused` | `e2e-paused/release-flags.spec.ts` (2 tests) driven by `playwright.paused-bundle.config.ts` against `dist-paused/`, which `scripts/run-paused-e2e.mjs` builds with `VITE_PUBLIC_SIGNUP_ENABLED: "false"` and `VITE_AUTH_EMAIL_ENABLED: "false"` (both pinned by `tests/release-flag-build.contract.test.ts`); the source halves are `tests/auth-email-readiness.contract.test.ts` (every registration door gated, plus the submit backstop) and the enabled-state counterpart `e2e/stage6-local-auth-ux.spec.ts` | none — the gate needs no stack: every `/auth/v1/*` call is intercepted and any request that leaves loopback fails the run | browser | that Cloudflare's own environment variables say `false` — the deployment config lives outside this repository, and this gate can only prove what a build obeying them renders | yes — **measured 2 passed (14.3 s) on 2026-10-12**; it was written against the reproduced leak, where the shipped paused bundle reached `POST /auth/v1/signup` from the confirmation screen |

### What has moved since these measurements were taken

Rows A-T are the Stage 9 measurement of 2026-09-29 and are deliberately **not** rewritten here —
that is what makes them usable as a baseline. The numbers in them that now describe an older tree are
listed below, and a reviewer should read them with this pointer. Each figure is quoted from the run
named in front of it, most recently CI at the promotion head `7c33fd1` (observed 2026-10-17, all four
push workflows `completed / success` on its own SHA — `CI` `39049440581`, `Complete customer-browser
regression` `39049440594`, `Live production public smoke` `39049440653`, `CodeQL security review`
`39049440552`; its run ids are in `docs/CUSTOMER_RELEASE_READINESS.md`, and `f037521`'s, `6f5e919`'s and
`96d9b03`'s before it are there too):

- Row H says 23 migrations. The chain committed **24** before Phase 3B (which applied all 24 to the
  hosted project and measured parity), Arc 3C added a **25th**, and CL-39 adds a **26th**
  (`20261017090000_current_cl39_edit_conflict_errcode_reachable.sql`). CI's `Database contracts` job
  at that head prints **"Migrations on disk: 26. Applied in the local database: 26."** The hosted
  project is now at **26** as well: the 26th was pushed on 2026-10-17 by this workstream through
  `supabase db push --skip-vault --yes` over the session pooler (exit `0`, 2,873 ms) after a `--dry-run`
  that named only that file, and the hosted catalog re-read **26/26** afterwards — still forward-only,
  with no applied row rewritten and no untracked SQL. The promotion's reads, timings and the
  before/after stale-edit measurements are in "Migration 26 qualification and promotion against
  production (2026-10-17)" in `docs/CONSUMER_LIVE_PROGRESS.md`.
- Row J says `Files=8, Tests=364`. There are **10** pgTAP files on disk now, and the measured run is
  `Files=10, Tests=410 … Result: PASS` — the ninth being `arc3c_01_account_erasure.sql`, which plans
  41, and the tenth `stage4_02_edit_conflict_code.sql`, which plans 5 and printed
  `supabase/tests/stage4_02_edit_conflict_code.sql ... ok`.
- Row D's unit counts are the Stage 9 series. At the CL-39 head `pnpm test:unit` measures
  **52 files / 780 tests, 0 skipped** (exit 0, `Duration 12.24s`, re-measured locally on 2026-10-17 at the
  promotion head `7c33fd1` — the two files and 28 tests the previous reading of `50 files / 752 tests` did
  not count are the hosted stale-edit probe's contract cases, committed at that head; and
  re-measured locally at the recording head `6f5e919` the same day as **50 / 752** in `10.17s`), and
  the live manifest's **10th** file (`tests/arc3c-local-account-erasure.test.ts`) executes inside
  `pnpm test:live`, which CI at `2fb74ca` measures as **10 files / 332 tests** in `Duration 46.42s`,
  22 of them that file's (`✓ tests/arc3c-local-account-erasure.test.ts (22 tests) 4631ms`); CI at
  `6f5e919` measures the same battery as **10 / 332** in `Duration 42.97s`.
- **The live battery re-run locally at 26 migrations is a "cannot run on this host", not a failed
  gate (2026-10-17, at `6f5e919`).** `node scripts/local-functions-serve.mjs start` came up
  (`delete-account is served and ALLOWED_APP_ORIGIN reached the runtime (6997 ms,
  supabase_edge_runtime_dueweave recreated by the serve)`) and `pnpm test:live` reported
  `Test Files 3 failed | 7 passed (10)` / `Tests 7 failed | 325 passed (332)` / `Duration 207.14s`,
  with the 7 split across `stage7-local-export` (3), `stage8-local-founder-readiness` (1) and
  `arc3c-local-account-erasure` (3). Every one of them carries a host signature rather than a
  repository one: `fatal error: runtime: cannot allocate memory`, `fatal error: out of memory
  allocating heap arena map`, `Error: spawnSync docker UNKNOWN`, `TypeError: fetch failed` caused by
  `SocketError: other side closed`, and a gateway `503` where the test expected `405`. Re-running the
  erasure file alone made it **worse** (`7 failed | 15 passed (22)`), because the gateway had by then
  begun answering an unauthenticated `POST /functions/v1/delete-account` with
  `HTTP 502 "An invalid response was received from the upstream server"` while the container still
  reported `running`, `restarts=0`, `OOMKilled=false` — a served runtime that stops answering, which
  is the machine, not the code. The drive tells the same story: `C:` was 100 % used throughout and its
  free space fell `527 MB → 223 MB → 168 MB → 150 MB` across the attempts. **The discriminator is CI at the
  same head:** `Database contracts` job `117346680580` at `6f5e919` prints `Migrations on disk: 26.
  Applied in the local database: 26.` with `Test Files 10 passed (10)` / `Tests 332 passed (332)` in
  `Duration 42.97s`. Locally, the CL-39-relevant file did pass —
  `✓ tests/stage4-local-edit-workflows.test.ts (14 tests) 2956ms` — including the stale-token and
  missing-token refusals now raised as `DW001`. Two cleanups this run owed and got: the stage4
  teardown's own purge died on the OOM and left 2 accounts, which this phase purged with the suite's
  scoped statement (`residue=0`, history guards read back `4/4`, auth users 26 → 24), and the serve
  was stopped (`delete-account no longer answers (gateway-503) after 5161 ms`). What remains open is
  the local execution of the arc3c battery on a host with room — not a verdict about the erasure path,
  which CI and production have both already carried.
- Row U's executing gates ran on 2026-10-06 against the loopback stack and were recorded there as not
  yet run in CI. **That has moved twice since.** CI now runs the served-function battery and the
  browser erasure journey on GitHub-hosted runners at every head of this line, and on 2026-10-16 a
  confirmed, signed-in account completed the same erasure against the *production* project with its
  before/after census (`docs/CUSTOMER_RELEASE_READINESS.md`, gate 4, and
  `docs/ACCOUNT_ERASURE_DESIGN.md`, "Update 2026-10-17"). What still keeps B17 open is narrower: the
  destructive submit clicked through the **deployed UI** on production, which is deferred to the QA-A
  cleanup because erasing QA-A ends the hosted two-account comparison. The older prose in rows D-T and
  the Phase 3C sections of `docs/CONSUMER_LIVE_PROGRESS.md` predates both moves; the measurements, the
  two red pgTAP executions that preceded the green one, the authorised prune passes and the daemon
  probe timings stay in `docs/CONSUMER_LIVE_PROGRESS.md` ("Phase 3C — account erasure (B17)") and
  `docs/ACCOUNT_ERASURE_DESIGN.md` ("Execution status").
- Rows N and the note-9 limitation describe the stale-edit refusal as a stall on this host and a pass
  in CI, and name the PostgREST build as the discriminator. **CL-39 is the repair, and the host-side
  question it recorded is now answered by production itself:** on 2026-10-16 the same call against
  `ugzdqcytouwfdlcjujqv` went unanswered at 30 s and the edge returned HTTP 504 at 125,140 ms with the
  row untouched, so the refusal never reached a real customer on the deployed transport. Both routines
  now raise the private code `DW001`, which the build answers promptly (on the local
  `postgrest:v14.18` container `DW001` returned HTTP 400 in 181 ms, and 124 ms / 15 ms once the
  stalled connections cleared), and `stage4_02_edit_conflict_code.sql` pins the code, the
  wording and a catalog-wide sweep for the two retryable codes.
  **That owed half is measured now, on this host, at `6f5e919` (2026-10-17).** Migration 26 was
  applied forward to the running local database (`supabase migration up --local`, then
  `pnpm verify:migrations` → `Migrations on disk: 26. Applied in the local database: 26.`), and a
  throwaway account drove the real routines over HTTP through this stack's gateway
  (`127.0.0.1:54321`, container image `public.ecr.aws/supabase/postgrest:v14.18`). A stale
  `p_expected_updated_at` on `update_client` returned `HTTP 400` with `code=DW001` and the unchanged
  wording in **14 ms, 10 ms and 20 ms** across three calls; the same routine with **no token at all**
  in **13 ms**; `update_receivable_details` stale in **18 ms and 13 ms**. The legitimate fresh-token
  edit on the same routine answered `HTTP 200` in **21 ms** and the returned row carried the new name,
  so the repair did not loosen the write it protects. `pnpm test:db` at 26 migrations reports
  `Files=10, Tests=410 … Result: PASS`, and the throwaway account and its rows were purged afterwards
  (`residue=0`, history guards read back at `4/4`). **What that pair is, stated exactly:** the BEFORE
  half is this same container's recorded `40001` unanswered at 40 s and `40P01` unanswered at 20 s,
  together with the definition read taken here before the apply —
  `update_client :: raise exception 'This client changed in another session' using errcode = '40001';` —
  because migration 26 removes the code that stalls, so the stall cannot be re-created on a repaired
  database without re-introducing it. CI's `v16.2` cannot stand in for either half (it answers
  `40001` too, which is exactly why the defect stayed invisible there).
- Row S cites `e2e/stage9-release-journey.spec.ts:452` for the sign-out/sign-in case. That pointer has
  rotted: the same file's own CI slot numbers at `2fb74ca` place the founder refusal at `:446`, the
  profile-edit/sign-out/sign-in case at `:472` (slot 80) and account deletion at `:505` (slot 81), so
  `:452` now lands inside the founder test. Read row S by the case names, which CI prints verbatim.

## "Cannot run" is a different answer from "passed"

Four mechanisms keep the matrix honest, and all four are executable, not prose:

- `scripts/local-stack-check.mjs` is the single definition of stack presence, and it **throws**
  on a missing URL/anon key, a non-loopback URL, a connection error or a non-2xx
  `/auth/v1/health`. It is `globalSetup` for `pnpm test:live`, `pnpm test` and the browser
  configs, so no suite in rows L-T can be skipped into a green exit for a machine with no stack.
- `tests/ci-gate-manifest.contract.test.ts` derives the required gate list from
  `verify:release:local` plus the two browser commands and fails if `ci.yml` does not launch one
  of them — the repair for the gate this stage measured missing (F8 in
  `docs/TEST_SKIP_CLASSIFICATION.md`: the React-warning suite was green on a laptop and never
  started by CI). Its one exemption, `pnpm db:reset:local`, names the reason (the `local-supabase`
  action replays the committed migrations instead) and the test fails if the exemption goes dead.
- `tests/e2e-battery-flags.contract.test.ts` and `tests/release-command-contract.test.ts` pin the
  browser flags, the script routing, the build-before-contracts order and the suite split, so
  rows D and L-T cannot silently lose the suites they claim.
- `tests/untracked-add-surface.contract.test.ts` pins row G's scope and row G2 in force together:
  the credential scanner must read the untracked files `git add -A` would stage, and the repository
  root must stay free of loose evidence. It fails if the scanner is narrowed back to `git ls-files`,
  if `verify:hygiene` is dropped from `verify:release:local`, `ci.yml` or this matrix, or if a
  retired QA credential path is cited as if it still existed.

The full skip inventory — 36 sites, five classes, seven repairs — is
`docs/TEST_SKIP_CLASSIFICATION.md`.

## Recorded, not accepted: F'

`pnpm audit --prod --audit-level=high` measured **No known vulnerabilities found** and blocks.
The development graph measures **38 vulnerabilities (1 low, 17 moderate, 18 high, 2 critical)**
in Vitest/tar/Vite tooling, none of which ships in `dist/` or is reachable from `vitest run` /
`vite build`. CI prints that number on every run under `continue-on-error: true`: upgrading the
toolchain is a dependency decision, and this stage does not make it silently.

## Browser budget, and what it is based on

PHASE 18 asks for budgets from measured behaviour, not generous round numbers. Locally measured
on one worker: the CI browser subset **79 passed / 14.2 min** (`pnpm test:e2e:smoke`, exit 0,
re-measured 2026-09-29; an earlier replay of the same 79 measured 17.3 min), the React-warning gate
3 passed / 1.9 min, and the full laptop battery **173 passed, 8 skipped / 25.5 min**
(`pnpm verify:e2e:local`, re-measured 2026-09-29; the first replay of the same 181 slots measured
29.6 min — the spread is host load on a shared machine, not a change in the suite). The 8 are the
host-credential-gated legacy specs classified in `docs/TEST_SKIP_CLASSIFICATION.md`, none of them in
the CI subset. The `browser` job therefore carries `timeout-minutes: 45` for roughly 20 minutes of
expected work plus Docker Supabase start, the Chromium download and a cold `vite dev` start.

That headroom is **no longer an estimate**. When this section was written it said "no CI-measured
duration exists for this head", because runs 11-17 never started a runner; run `36555102272` on head
`ec868e8` executed the job on the repository's own self-hosted Linux runner, and GitHub's own job
payload gives `started_at 2026-09-29T10:30:54Z → completed_at 10:49:01Z` — **18 m 07 s of the
45-minute budget** — with the smoke battery inside it measured at `79 passed (13.9m)` and the
warning gate at `3 passed (43.7s)`, `retries: 0`, 0 timeouts. So the budget is validated by one real
execution, on one machine (WSL2 Ubuntu, Docker Desktop engine, Node 22), and it is not validated
against a second machine or a cold Docker image cache. If a future run times out, the budget is
raised from the observed number rather than from a guess. `retries` stays **0** in both Playwright
configs, so a red CI run is a defect report, not a retry counter.

**(Second machine measured 2026-10-17, at `2fb74ca`.)** The job has since run many times on
GitHub-hosted runners, and the CL-39 head gives the pair this paragraph said did not exist:
`Browser release smoke` job `117342266800` on runner `GitHub Actions 1000010612`,
`started_at 2026-10-17T07:32:35Z → completed_at 07:47:29Z` — **14 m 54 s of the 45-minute budget** —
with its own log printing `Running 81 tests using 1 worker` → `81 passed (11.0m)`, then
`pnpm test:e2e:paused` building `dist-paused` and answering `Running 3 tests using 2 workers` →
`3 passed (5.0s)`, then `pnpm test:e2e:react-warnings` → `3 passed (31.3s)`. The previous head
`99dce90` measured `14 m 52 s` on the same runner family, so the budget has a second machine and a
repeated one. Slot 81 of the 81 is
`e2e/stage9-release-journey.spec.ts:505 › account deletion is gated by exact confirmation and removes
the last QA account (1.2s)`, executed against the `delete-account` function the same job served
(`delete-account is served and ALLOWED_APP_ORIGIN reached the runtime (1349 ms …)`).

### One budget was wrong, and how it was found

The warning gate's first-paint waits are the only browser assertions in this repository whose
cost is unbundled module traffic rather than a built page, so they were the one place a default
timeout could be too tight. It was: `e2e/stage9-react-warnings.spec.ts:118` asserted the
post-onboarding ledger heading with Playwright's 5 s default, while the two other first paints in
the same file (`:103` the auth screen, `:217` the nav after relogin) already carried 30 s for that
reason. Measured across 4 runs of one code state on 2026-09-29: 1 run failed that assertion with
the page on "Opening your private ledger…" (the `Suspense` fallback at `client/src/App.tsx:20`,
i.e. still loading, not erroring) and 3 passed. CI cannot reuse a warm dev server —
`playwright.react-warnings.config.ts` sets `reuseExistingServer: !process.env.CI` — so a budget
that holds only when the module graph is warm would have reported a defect that is not in the
product. The wait is now 30 s with the reason stated beside it; the gate re-ran **3 passed / 1.7
min** after the change, and its falsification pair (a real `console.error` on a release screen
turning the gate red) was measured the same day.

## What a green release does **not** claim

1. **No WCAG certification.** Row P is a targeted keyboard/screen-reader/reduced-motion
   qualification retained from Stage 6 (PHASE 14), not an audit conformance statement.
2. **No hosted-project evidence.** Every database and browser row ran against the loopback stack.
   `tests/supabase.public-config.live.test.ts` and the eight host-credential-gated legacy specs
   are excluded from both release halves so neither can cite them; the supersession mapping is in
   `docs/TEST_SKIP_CLASSIFICATION.md`.
3. **No real money.** Row R is `TEST`-mode Founder readiness in fail-closed form: the offer,
   claim, UTR, review and revocation paths are proved, and no live payment-provider credential or
   verified VPA destination exists in this repository (`docs/FOUNDER_LIVE_ACTIVATION_CHECKLIST.md`).
4. **No delivery.** This stage does not merge to `main`, deploy, tag `v1.0.0` or enable real money;
   `docs/RELEASE_PROTECTION.md` is a recommendation, and no branch protection was changed.
5. **Not a performance or load qualification.** Single-worker browser timing is a correctness
   measurement; nothing here characterises concurrent users.
6. **One port, one stack.** Two simultaneous browser runs share `127.0.0.1:3000` and the same
   Postgres; the measured failure mode is `net::ERR_CONNECTION_REFUSED` mid-flight, which is why
   the canonical commands default to `--workers=1`.
7. **Row U's CI half, and one caveat about its local half.** The erasure battery has executed against
   the loopback stack and `ci.yml` now serves the function in the `database` job, but no Phase 3C head
   has run that job — so a green release at this head is not yet evidence that *CI* can erase an
   account. The local 22/22 also rests on the serve in `serve-wsl.log` (WSL side of this tree, 1 setup /
   0 change events / 104 requests), not on the one `scripts/local-functions-serve.mjs` brings up from
   Windows; the battery has not been re-run against that script's single-variable env file, which is the
   shape CI will use. That gap is narrower than the env files look apart — the CLI skips the `SUPABASE_*`
   names it injects itself, so the runtime is configured by `ALLOWED_APP_ORIGIN` either way — but it is
   still a re-run this matrix has not seen. Neither claim is softened by the pass above, and the erasure
   sheet has never been rendered in a browser. **Retired on the CI half, by measurement rather than by
   assumption (`2026-10-16T16:48Z`, run `38934362140` = `CI` at `ddb9340`, job `Database contracts`
   `117085988587`):** that job ran the paired serve step and the battery on the same head —
   `delete-account is served and ALLOWED_APP_ORIGIN reached the runtime (1507 ms,
   supabase_edge_runtime_dueweave recreated by the serve)`, then
   `✓ tests/arc3c-local-account-erasure.test.ts (22 tests) 5434ms`, inside
   `Test Files 10 passed (10)` / `Tests 331 passed (331)`, with the `if: always()` stop step recorded
   after it. So CI demonstrably can erase an account at this head; what remains of this caveat is the
   *local* half, which is note 8.
8. **An open finding against row U, with its mechanism read from the serve logs and the mtimes.** One
   execution of the battery under a script-started serve from the Windows checkout answered
   `Tests 9 failed | 13 passed (22)` with every `F.*` claim on HTTP **502** (some also
   `Test timed out in 30000ms`) — and the 13 passes are precisely the `docker exec` claims, which never
   reach Kong. The serve log for exactly that window
   (`supabase/.temp/functions-serve.log`, 11:46:30Z → 11:48:33Z) records **12** `File change detected`
   WRITE events, **7** `Serving functions on…` re-setups, and only **2** requests that reached
   `serving the request` — so the runtime spent the run tearing down and re-setting-up, and a request
   landing inside that window gets Kong's **502**, not a function answer; the tokenless probe that the
   stable serve answers 401 answered 502 there, which is the signature of *no upstream*, not of a
   refused deletion. The events are not writes: `index.ts`/`contract.ts` carry host mtimes of 13:34:30
   and 13:35:50 (= 08:04Z, 08:05Z, ~3.5 h before that window), their directory 13:35:50, and `.env`'s
   two later events postdate that file's only write at 11:46:25Z. Nor is it one serve misbehaving: all
   three Windows-side captures this phase churned (24 events / 8 setups at 10:23–10:28Z, 19 / 7 at
   10:29–10:32Z, 12 / 7 in the red run), while the WSL-side serve of the identical tree logged **1**
   setup, **0** change events and the **104** requests the 22/22 ran against. What remains
   **unestablished** is *why* a Windows-side watcher reports writes at all — a bind-mount question, not
   a repository one. `contract.ts` has no import specifiers, so a Deno remote-import failure is not the
   explanation either. The re-run that would close this needs
   `docker exec`, and the attempt after the ceiling was added answered **exit 1 with 22 tests skipped**
   (`docker exec` ETIMEDOUT at 30 s) — the blocked-gate path, working as designed. Until that re-run
   happens on a responsive daemon, the 22/22 belongs to the stable serve only, and this row is
   **not** re-qualified by it.
   **Fourth Windows-side capture, and the watcher is now shown to be inventing the writes.** On
   `2026-10-16` the script-managed cycle was run again with the daemon responsive: `start` answered
   `delete-account is served and ALLOWED_APP_ORIGIN reached the runtime (7026 ms,
   supabase_edge_runtime_dueweave recreated by the serve)`, the battery answered
   `Test Files 3 failed | 7 passed (10)` / `Tests 8 failed | 324 passed (332)`, and `stop` answered
   `terminated the delete-account watcher (pid 25252)` → `delete-account no longer answers
   (gateway-503) after 5082 ms`. Four of those failures are again the `F.*` claims on **502**
   (`F.3`, `F.5`, `F.6`, `F.7`; the other four are limitation 9 and are not this mechanism). The serve
   log for that window (17:03:44Z → 17:18:54Z) records **71** `File change detected` WRITE events —
   **23** each for the function directory, `contract.ts` and `index.ts`, plus 2 for
   `supabase/functions/.env` — **26** `Serving functions on…` re-setups and only **5** requests that
   reached `serving the request`. The new fact is what happened after the suite finished (~17:07Z): the
   identical three-file cycle kept firing at a fixed 60-second cadence (17:07:31, 17:08:31, 17:09:31 …
   17:18:32Z) with **no test process running and no request in flight**, and the four watched paths
   still report mtimes of 2026-10-11T16:52:26.205Z (directory and `index.ts`),
   2026-10-06T08:04:30.756Z (`contract.ts`) and 2026-10-06T11:46:25.985Z (`.env`) — unchanged to the
   millisecond across all 23 cycles. So the events cannot be writes, and they are not traffic-driven: a
   Windows-side watcher on this tree reports a WRITE on the whole function directory every minute whether
   the directory is touched or not, and every re-setup it triggers is a window in which Kong has no
   upstream. That converts note 8's open question from *what wrote the files* to *why this host's
   watcher is blind*, which is a Docker/Windows bind-mount question and not a repository one; the
   remedy this matrix will accept is still the same — run the battery where the serve is stable, which is
   what limitation 7's CI measurement now does, or on the WSL side of the tree.
9. **Row N is green on CI and stalls on this host, and the difference is the PostgREST build, not the
   repository.** The four non-502 failures in limitation 8's run are all the SQLSTATE **40001** path:
   three in `tests/stage4-local-edit-workflows.test.ts` and one in
   `tests/stage4-local-repository-edit.test.ts` (`rejects a write that carries a token the row has
   outgrown`), each reported as `Test timed out in 5000ms`. It reproduces in isolation (that one file,
   one test, `1 failed | 6 passed`) and survives a raised ceiling (`30032ms → Test timed out in
   30000ms`), so it is a stall rather than slowness, while its siblings in the same file finish in
   389–963 ms. Taken out of the test harness entirely, a plain `POST
   /rest/v1/rpc/update_client` carrying an outgrown token against the loopback stack produced no
   response at all — Kong's access log closed it as **499** after 25 s — while the *same* session,
   seconds earlier, got `create_client` 200 in 422 ms and a matching-token `update_client` 200 in
   137 ms, and a `P0002` refusal in the same suite returned HTTP 500 promptly. `pg_stat_activity`
   shows the transaction reaching `idle in transaction (aborted)` within seconds and no database work
   for the rest of the wait, so the server decides the write is refused immediately and never delivers
   that refusal to the caller. The discriminator is the build: this host's `supabase_rest_dueweave`
   was created `2026-10-06T10:12:45Z` from `public.ecr.aws/supabase/postgrest:v14.18`, whereas the job
   in limitation 7 pulled `postgrest:v16.2` and ran both files green at the same SHA
   (`✓ tests/stage4-local-edit-workflows.test.ts (14 tests) 676ms`,
   `✓ tests/stage4-local-repository-edit.test.ts (7 tests) 752ms`). The local containers are stale
   artifacts of an older CLI stack, kept running deliberately: the restored production snapshot lives in
   the named volume `supabase_db_dueweave`, and a `docker start` preserves it where a full
   stop/start cycle would not. `v16.2`, `v16.3` and `v16.4` are already in the local image store, so
   the remedy is to recreate this stack on the pinned images when `C:` has room (1.9 G at this
   measurement) — after which `pnpm test:live` can be re-run for a local 332.
   **One consequence this records as unmeasured, not as fine:** production's PostgREST build was not
   read. `GET https://ugzd…supabase.co/rest/v1/` without a key answers `401` with only
   `Server: cloudflare`, and this line holds no key path that would let it ask with one. If hosted
   PostgREST were 14.x, the conflict refusal `supabase/migrations/20260814170000_current_stage4_persistent_edits.sql:97-99`
   exists to show a customer would never reach the screen — the save would hang instead. Reading the
   `Server` header of an authenticated `GET /rest/v1/` on production is the one-request instrument that
   closes this, and it is not yet run.
   **Closed by a better instrument than the one this note proposed, on 2026-10-16, and CL-39 is the
   repair.** Rather than read a header, the refusal itself was sent to production: the same session
   answered a `P0002` refusal in 76 ms and 128 ms, while the stale-token `update_client` was still
   unanswered after 30 s and the edge gave up with HTTP 504 "upstream request timeout" at 125,140 ms;
   the owner's read-back afterwards showed the row untouched, so the customer waited two minutes for a
   message the code already contained. That settles the conditional above on production, without naming
   a version. The forward migration `20261017090000_current_cl39_edit_conflict_errcode_reachable.sql`
   re-raises both routines with the private-use code `DW001`, which v14.18 answers promptly (HTTP 400
   in 181 ms, and 15 ms on a second call after both stalls, so the stall belonged to the code and not to
   a wedged pool), and `supabase/tests/stage4_02_edit_conflict_code.sql` pins the code, the wording and
   a catalog-wide sweep for the two retryable codes. The four local failures this note attributed to
   the `40001` path are therefore the defect, not host flakiness. **And the repair's own latency
   re-measurement on this host's v14.18 container, which this note recorded as owed, was taken on
   2026-10-17 at `6f5e919` once the daemon came back: six stale or tokenless edit calls answered
   `HTTP 400` with `DW001` in 10-20 ms each, and the fresh-token control edit answered `HTTP 200` in
   21 ms — the full reading is in the row-N bullet above.** **And on 2026-10-17 the same instrument ran
   against production after migration 26 was pushed:** the four stale or tokenless edit calls that this
   note recorded as unanswered-for-30-seconds on that project answered `HTTP 400 DW001` in 40-69 ms, the
   two authorized fresh edits answered `HTTP 200` in 67 ms and 195 ms with the token moving, and the
   account's ledger read the same rows afterwards — so the production half of this repair is measured on
   production, not inferred from the local container. CI cannot stand in for it: its
   `postgrest:v16.2` answers `40001` in 676/752 ms, which
   is precisely why every CI head stayed green while customers hung.
