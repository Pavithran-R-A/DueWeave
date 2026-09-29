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
| D | Unit + boundary contracts | `pnpm test:unit` | 23 files / 359 tests, incl. `tests/credential-boundary.contract.test.ts`, `tests/production-module-graph.contract.test.ts`, `tests/security-contract.test.ts`, and the three gate contracts this stage added (`tests/ci-gate-manifest.contract.test.ts`, `tests/release-command-contract.test.ts`, `tests/e2e-battery-flags.contract.test.ts`) | built bundle for the 3 bundle contracts | static | — | yes |
| E | Production build | `pnpm build` | `dist/` (measured: built in 12.34 s, `index-*.js` 498.18 kB / 144.28 kB gzip) | none | static + browser (before the journeys) | — | yes |
| F | Production dependency audit | `pnpm audit --prod --audit-level=high` | `pnpm-lock.yaml` runtime graph | network | static | — | yes |
| F' | Toolchain audit (dev tree) | `pnpm audit --audit-level=high` | same, dev graph | network | static | — | **no** — recorded, see below |
| G | Secret / privileged-credential scan | `pnpm verify:secrets` | `scripts/verify-secrets.mjs` (11 shapes, tracked tree + `dist/`) | built bundle for the bundle half | static + `browser` artefact scan | — | yes |
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
expected work plus Docker Supabase start, the Chromium download and a cold `vite dev` start. That
headroom is **still an estimate**: PHASE 27 pushed the branch and observed the run, and no job of
it ever started a runner (see the billing block recorded in
`current_stage9_security_ci_report.md`), so no CI-measured duration exists for this head. If a
re-run after the account blocker is cleared times out, the budget is raised from the observed
number rather than from a guess. `retries` stays **0** in both Playwright configs, so a red CI run
is a defect report, not a retry counter.

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
