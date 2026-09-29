# Test skip classification (Stage 9)

`tests/suite-manifest.ts:25` points here, and this file is the reason the roadmap needed it.

A skipped test and a passed test produce the same exit code. A release gate that reads
"0 failed" therefore cannot tell "the product was qualified" from "nothing was
qualified". Stage 9's answer is not to ban skipping — several suites genuinely cannot run
against a local stack — but to make every skip site belong to a named class, with the
command that makes it run stated beside it, and with any skip that a gate can silently
inherit treated as a defect and repaired.

Everything below was measured on this commit against the local Docker Supabase at
`http://127.0.0.1:54321`. The commands are in the last section.

## The rule this stage agreed to

1. A **missing environment is an error**, never a skip. Both release halves refuse to
   start without a loopback stack (class A).
2. A skip that a canonical release command can inherit **silently** is a defect. Four
   such defects were found and repaired (class F).
3. A skip that can only happen in a command nobody qualifies with is a **belt**, and is
   recorded as one rather than being presented as safety (class B).
4. A suite that cannot run in this stage's environment at all is **excluded from the
   release halves**, not reported by them (class E).

## Classes

| Class | Mechanism | Can a release gate inherit it? |
| --- | --- | --- |
| A | Fail-closed stack guard (`scripts/local-stack-check.mjs`) | No — an absent, unreachable or non-loopback stack exits non-zero |
| B | In-suite `describe.skip` fallback in the nine database suites | No, under `test:live` and `test` — both configs now carry class A; only reachable via a hand-rolled config |
| C | `it.skipIf(!dist)` in the three bundle contracts | **Yes**, until this commit's ordering repair |
| D | `test.skip(!STAGE*_LOCAL_E2E)` in the browser suites | **Yes**, until this commit's flag and script repairs |
| E | Hosted-project and hosted-credential suites, by design | No — excluded from both release halves and never counted as evidence |
| F | Skip sites that a green command was inheriting | Repaired in this commit |

## A — fail-closed guards

- `scripts/local-stack-check.mjs` — one definition of "the disposable stack this
  repository qualifies against is present". It fails on: no
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, a **non-loopback** URL (these suites
  create users, rewrite the singleton Founder offer row and purge fixture accounts, so a
  hosted project must not be reachable by accident), a connection error, or a non-2xx
  `/auth/v1/health`.
- `tests/live-stack-guard.mjs` is `globalSetup` of `vitest.live.config.ts` **and**, from
  this commit, of `vitest.config.ts`.
- `e2e/local-stack-setup.mjs` is `globalSetup` of `playwright.config.ts` and of
  `playwright.react-warnings.config.ts`.
- `node scripts/local-stack-check.mjs` asks the same question by hand.

## B — the in-suite belt (nine database suites)

`tests/stage2-local-foundation.test.ts:10`, `stage3-local-rls.test.ts:20`,
`stage4-local-edit-workflows.test.ts:15`, `stage4-local-repository-edit.test.ts:17`,
`stage5-local-lifecycle.test.ts:26`, `stage6-local-profile.test.ts:19`,
`stage7-local-export.test.ts:27`, `stage8-local-founder-readiness.test.ts:20`,
`stage9-abuse-matrix.test.ts:36` each resolve
`describeLocalStack = isLoopbackStack && anonKey.length > 0 ? describe : describe.skip`.

This is defence in depth, not the gate. Before this commit it was reachable from
`pnpm test` (and `pnpm test:stage2`, `pnpm test:stage3`, `pnpm test:stage8`, all of which
use the unguarded whole-battery config); the guard now covers that config too, so a
skipped database suite under any command in `package.json` is no longer possible.

Which files these are is not left to a naming convention: `tests/suite-manifest.ts` lists
them, and `tests/release-command-contract.test.ts` fails if a listed suite disappears, if
a new `stage*-local-*`/`*.live` suite is not classified, or if the classification repeats a
path. Falsified by probe: a `tests/stage99-local-probe.test.ts` file made that contract
name the offender, and was then deleted.

## C — the three bundle contracts

| Site | Condition |
| --- | --- |
| `tests/credential-boundary.contract.test.ts:64` | `it.skipIf(!existsSync(dist))` |
| `tests/production-module-graph.contract.test.ts:77` | same |
| `tests/stage8-founder-contracts.test.ts:338` | `it.skipIf(!existsSync(distDir) && isDirectory)` |

They check the bundle directory, not its freshness. `.github/workflows/ci.yml` builds
before the static job's tests; the local `verify:release:local` command did not, and was
repaired (F3).

## D — browser battery flags

Eight flags, read by 27 `test.skip` sites across 20 spec files, all set by exactly
one thing: the env block in `scripts/run-e2e.mjs`. `pnpm verify:e2e:local` and
`pnpm test:e2e:smoke` both go through that runner; `pnpm test:e2e` and the per-stage
`test:e2e:stage2|3|6|8` scripts did not, and were repaired (F2).

`tests/e2e-battery-flags.contract.test.ts` now asserts the rule in both directions — every
flag a spec reads must be written by the runner, and every flag the runner writes must be
read by a spec — plus a non-vacuity check that each scan found something, plus F2's
replacement (no `package.json` script may launch a gated suite outside the runner).

## E — outside this stage's environment, by design

| Site | Tests | Why it cannot run here | What replaces it |
| --- | --- | --- | --- |
| `tests/supabase.public-config.live.test.ts:8` | 1 | Addresses a hosted Supabase project; this stage is local-only. Measured: `1 skipped` under `pnpm test` | `hostedOnlySuites` in `tests/suite-manifest.ts`, excluded from `vitest.unit.config.ts` and absent from `vitest.live.config.ts`'s `include`, so neither release half can report it |
| `e2e/accessibility-smoke.spec.ts:18` | 1 | Needs a hosted confirmed QA account (`E2E_EMAIL`/`E2E_PASSWORD`) | Superseded, see mapping below |
| `e2e/auth-lifecycle-limits.spec.ts:20` | 2 | same | partly superseded |
| `e2e/core-workflow.spec.ts:22` | 1 | same | superseded |
| `e2e/founder-purchase.spec.ts:18` | 1 | same | superseded |
| `e2e/responsive-authenticated.spec.ts:18` | 1 | same | superseded |
| `e2e/stage41-client-conversion.spec.ts:29` | 2 | Stage 4.1 fixture credentials | partly superseded |
| `.github/workflows/ci.yml:59` dev-toolchain audit | n/a | `continue-on-error: true`: the development dependency tree has recorded findings this stage is not clearing | The **production** audit two steps earlier is blocking (`pnpm audit --prod --audit-level=high`) |

Total permanently-skipped tests in the class-E specs: 8, measured by counting their `test(`
definitions; none of them is in `pnpm test:e2e:smoke`, and CI never supplies those
credentials. They are not evidence for or against a release; they are listed here so no
report can quietly count them.

### Supersession mapping for those 8

| Legacy test | Executed elsewhere, on the local stack |
| --- | --- |
| `accessibility-smoke` — labels, focus ring, dialog keyboard walk, **reduced motion** | `e2e/stage6-local-accessibility.spec.ts` (8 tests) covers names, focus marks, sheet focus trap, announcements and Space activation; reduced motion existed **only** in this skipped file and now runs in that suite (F4) |
| `auth-lifecycle-limits` — unavailable signup stays at the gateway with a calm alert | Not reproduced locally. `stage6-local-auth-ux` proves the confirmation-required signup branch (`:69`) and the unreachable-server branch (`:187`) against captured provider responses; the "provider rejected the signup" answer itself is a residual gap (see below) |
| `auth-lifecycle-limits` — session removed from browser storage | Now executed locally: `stage6-local-auth-ux` "returns a browser whose stored session was removed to the gateway, not an error screen" (F4) |
| `core-workflow` — client, receivable, promise, payments, session, logout | `stage4-local-persistence` + `stage5-local-lifecycle` + `stage7-local-export`/`followup` + `stage9-release-journey` (a fresh account, typed through the screens, with read-back after reload and sign-out) |
| `founder-purchase` — truthful non-payable placeholder at every viewport, safe logout | `stage8-local-founder-customer` `:133` placeholder + `:427` keyboard-and-width walk + `:526` no payment facts in storage |
| `responsive-authenticated` — real empty-state Today at every width | `stage6-local-responsive` (the measured 7-width matrix) and `stage7-local-followup` per-width follow-up tests |
| `stage41-client-conversion` — deliberately selected existing client creates no duplicate | Partially: `stage4-local-persistence:270/:301` prove refusal and single-save against duplicates, `stage6-local-auth-ux` and `stage6-local-accessibility` drive the existing-client picker for real. The conversion-specific assertion is a residual gap |
| `stage41-client-conversion` — fourth-receivable denial routes to Founder | `stage8-local-founder-customer` "hitting the Free limit routes to Founder without opening a payment" |

Deleting the six now-superseded specs is a judgement left to the release owner rather than
taken quietly inside a test-classification pass; the mapping above is the evidence for it.

## F — skips a green command was inheriting, and their repairs

### F1 — 24 browser tests skipped inside a "green" battery

`scripts/run-e2e.mjs` set six of the eight stage flags; Stage 4 and Stage 5 suites existed
and were never enabled. Before: `pnpm verify:e2e:local` reported those 24 as skipped and
exited 0. After the flag repair, measured isolated: **24 passed (5.0m)**, 0 failed.

### F2 — five `package.json` scripts launched gated suites without the runner

Measured RED from the new contract: `test:e2e`, `test:e2e:stage2`, `test:e2e:stage3`,
`test:e2e:stage6`, `test:e2e:stage8`. A probe run of `pnpm test:e2e:stage2` answered
`1 skipped`, exit 0, for the Stage 2 auth journey. All five now route through
`node scripts/run-e2e.mjs`; the contract is 4/4 green.

### F3 — the release command built after the half that reads the bundle

With `dist` moved aside for the measurement, the three class-C contracts reported
`15 passed | 3 skipped` and exited 0. `verify:release:local` ran `test:unit` at step 2 and
`build` at step 5, so a fresh clone qualified an unbuilt bundle. Order repaired
(`tests/release-command-contract.test.ts` pins it: build before `test:unit`, build before
`verify:secrets`, browser half through the runner).

### F4 — two behaviours that existed only inside permanently-skipped specs

- **Session removed → gateway**: added to `e2e/stage6-local-auth-ux.spec.ts`, measured
  `1 passed (9.0s)` against the local stack.
- **Reduced motion**: added to `e2e/stage6-local-accessibility.spec.ts` (which CI's
  `test:e2e:smoke` already runs), measured `1 passed (16.3s)`. This was the only place in
  the repository that exercised `page.emulateMedia({ reducedMotion: "reduce" })`.

### F5 — a permanently-skipped placeholder with an empty body

`e2e/auth-gateway.spec.ts:31-37` was
`test.skip("requires a locally supplied confirmed Supabase QA account", "…", async () => {})`.
Playwright's first argument is a *condition*, and a non-empty string is always truthy, so
this skipped an empty function on every run while its description claimed a journey was
merely deferred. That journey is now executed by the Stage 4-9 local suites. Block
removed; the file's three real gateway tests measured `3 passed`.

### F6 — an inherited 30 s budget on reload-heavy tests

Enabling Stage 4's suite surfaced two tests timing out at the global 30 s once the full
battery shared a worker: measured durations 28.3 s and 16.2 s for the two concurrency
tests. `e2e/stage4-local-persistence.spec.ts` now states `timeout: 60_000` for that
describe, with the measurements recorded beside it. `retries` stays at **0** in both
Playwright configs — PHASE 17 — so a stall still fails instead of clearing on a second
attempt. After the change the same two tests measured 5.6 s and 18.6 s.

### F7 — the gate scripts were not on the lint path

`pnpm lint` covered `client/src tests e2e vite.config.ts`, which left
`scripts/run-e2e.mjs` (the file that decides which browser suites run at all — F1) and
`scripts/local-stack-check.mjs` (the file that decides whether a gate may report green —
class A) unlinted. Probing `eslint scripts` produced exactly one finding,
`scripts/verify-secrets.mjs:29 'Buffer' is not defined`, because the `**/*.mjs` block in
`eslint.config.mjs` listed Node globals without `Buffer`. Repaired: `Buffer` added to
those globals and `scripts` added to the lint command, measured `pnpm lint` exit 0 and
`pnpm check` exit 0 after the change. `tests/release-command-contract.test.ts` now fails
if the lint path drops `scripts` again (measured RED: `pnpm lint covers eslint, client/src,
tests, e2e, vite.config.ts`).

### F8 — a locally-measured gate that CI never launched

This is the same failure shape as F1 and F2 with a different victim: the suite is not
skipped, it is simply never started. PHASE 16's rule (a release journey that logs a
console error, an uncaught page error, an unanswered request or a React warning has
failed) is enforced by `e2e/problem-watch.ts`, and the warning half of it can only be
observed against `vite dev`, because the shipped bundle carries production React, which
throws minified errors instead of printing warnings. That gate was implemented
(`e2e/stage9-react-warnings.spec.ts`, `playwright.react-warnings.config.ts`), run locally
(measured `3 passed (1.9m)`), and documented — and the `browser` job in
`.github/workflows/ci.yml` ran only `pnpm test:e2e:smoke`. Nothing failed, because a job
that runs four gates looks exactly like a job that runs five.

Repaired by adding the step to the `browser` job after the release journeys, and by
`tests/ci-gate-manifest.contract.test.ts`, which derives the required gate list from
`verify:release:local` plus the two browser commands and fails on any gate CI does not
launch. Measured RED with the step removed: `the browser job never runs pnpm
test:e2e:react-warnings`; measured GREEN after restoring it, 5/5. The one gate CI cannot
run verbatim, `pnpm db:reset:local`, is exempted **with a reason** (the `local-supabase`
action replays the committed migrations onto a fresh database instead), and the contract
fails if that exemption becomes dead, so the ignore list cannot rot the way the F1 flag
list did.

## Residual risks, stated rather than smoothed

1. **Stale bundle.** The class-C contracts test `existsSync(dist)`, not freshness. Deleting
   only `dist/index.html` and re-running still executed all three, so a day-old `dist/`
   would be accepted as today's bundle. `scripts/run-e2e.mjs` does require
   `dist/index.html`; the static half does not hash it.
2. **Provider-rejected signup.** `auth-lifecycle-limits`' calm-alert branch for a signup the
   provider refuses has no local equivalent; local Auth answers that request differently.
   The two generic strings it asserts come from `client/src/hooks/useSupabaseAuth.ts:14,34`,
   which the auth-UX suite does cover through other branches.
3. **Existing-client conversion.** `stage41-client-conversion`'s first test asserts a
   conversion-specific detail (selecting an existing client creates no second record) that
   the local suites cover only through adjacent paths.
4. **`eslint.config.mjs` itself is outside the lint path**, as is any file the lint command
   does not name. `pnpm check` type-checks TypeScript only, so a plain `.mjs` gate script
   that is syntactically valid but semantically wrong is caught by its own contract test
   (F1, F2, F3) rather than by a linter.
5. **Concurrency on one port.** Two simultaneous browser runs share `webServer` ownership,
   and a run started while another is finishing gets `net::ERR_CONNECTION_REFUSED`
   mid-flight. This was reproduced and then measured away: this task's first attempt at F1
   showed `5 failed / 11 did not run / 8 passed` purely from overlapping runs, and the
   isolated re-run showed `24 passed`. A `vite --port 3000` process left over from an
   earlier day also binds `[::1]:3000` only, while `baseURL` names `127.0.0.1:3000`; the
   runner's `--host 127.0.0.1` is what makes its own server reachable.
6. **No WCAG claim.** PHASE 14 asks Stage 9 to retain accepted accessibility coverage, not
   to certify it. The Stage 6 suite is a targeted keyboard/screen-reader qualification.

## Reproducing these measurements

```sh
pnpm test:unit                      # static half, 23 files / 359 tests (measured)
pnpm test:live                      # database half, 9 suites, guard first
pnpm test:db                        # pgTAP, 8 files / 364 assertions
node scripts/local-stack-check.mjs  # the class-A question, asked by hand
pnpm verify:e2e:local               # the whole browser battery, flags set by the runner
pnpm test:e2e:smoke                 # the CI release journeys
pnpm test:e2e:react-warnings        # the PHASE 16 warning/console gate, against `vite dev`
```

Counts for the closure report are taken by the final replay, not copied from this file.
