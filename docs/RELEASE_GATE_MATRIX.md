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
| G | Secret / privileged-credential scan | `pnpm verify:secrets` | `scripts/verify-secrets.mjs` (11 shapes, tracked tree + `dist/`) | built bundle for the bundle half | static + `browser` artefact scan | — | yes |
| G' | CI **job-log** credential redaction (D-S9-7) | the start step pipes through the filter: `pnpm supabase:start 2>&1 \| node scripts/redact-cli-secrets.mjs` under `set -o pipefail` in `.github/actions/local-supabase/action.yml` | `scripts/redact-cli-secrets.mjs` masks the `sb_secret_`/service-role family, connection-string passwords and privileged-role JWTs before they reach the retained log; pinned by `tests/ci-log-credential-redaction.contract.test.ts` (5 cases, incl. the anti-vacuous control and the step-shape pin) | filter + step composition, no stack needed | static (as a unit case) **and** measured live on run `36569878819`: zero privileged shapes across all six expanded logs, `[redacted-sb-secret-key-41-chars]` and `[redacted-db-password]` rows present in both environment logs | — | yes |
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

### What has moved since these measurements were taken

Rows A-T are the Stage 9 measurement of 2026-09-29 and are deliberately **not** rewritten here —
that is what makes them usable as a baseline. Four numbers in them are now known to describe an older
tree, and a reviewer should read them with this pointer:

- Row H says 23 migrations. The chain committed **24** before this phase (Phase 3B applied all 24 to
  the hosted project and measured parity), and Arc 3C adds a **25th**: it has replayed from zero on the
  loopback stack (`pnpm verify:migrations` → "Migrations on disk: 25. Applied in the local database:
  25.") and it is **not** applied to the hosted project, because this phase made no hosted write.
- Row J says `Files=8, Tests=364`. There are **9** pgTAP files on disk now, and the measured run is
  `Files=9, Tests=405 … Result: PASS` — the ninth being `arc3c_01_account_erasure.sql`, which plans 41.
- Row D's unit counts are the Stage 9 series. At the Phase 3C head `pnpm test:unit` measures
  **33 files / 463 tests, 0 skipped**, and the live manifest's **10th** file
  (`tests/arc3c-local-account-erasure.test.ts`) has now executed inside `pnpm test:live`
  (**10 files / 331 tests**, 22 of them that file's).
- Row U's executing gates ran on 2026-10-06 against the loopback stack; they have **not** run in CI.
  The measurements, the two red pgTAP executions that preceded the green one, the authorised prune
  passes and the daemon probe timings are in `docs/CONSUMER_LIVE_PROGRESS.md` ("Phase 3C — account
  erasure (B17)") and `docs/ACCOUNT_ERASURE_DESIGN.md` ("Execution status").

## "Cannot run" is a different answer from "passed"

Three mechanisms keep the matrix honest, and all three are executable, not prose:

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
   sheet has never been rendered in a browser.
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
