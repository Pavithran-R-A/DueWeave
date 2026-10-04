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

**Phase 1 — takeover, preflight and repository audit.** No deployment, no hosted resource, no
purchase, no merge, no branch-protection change, no `main` write. The deliverable of this phase is
this file plus the branch it lives on.

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

**CI state at the delivered head — green, self-hosted, with the red run kept.** The five most
recent runs on any branch:

| Head | Run event | Conclusion |
| --- | --- | --- |
| `e5b734b` (this start point) | push | `completed / success` |
| `1564c6c` | push | `completed / success` |
| `a86dc09` | push | `completed / failure` — the run that found D-S9-14 and D-S9-15; preserved as evidence, not deleted |
| `7a87d88` | push | `completed / success` |
| `194d09f` | push | `completed / success` |

The run for this exact head is `37009951112`: `Static verification`, `Database contracts` and
`Browser release smoke` all `completed / success`, each executed on runner **`dueweave-local-ci`**
(not a GitHub-hosted fallback), every step `success` except `Upload failure evidence`, whose
conclusion is `skipped` because it is an `if: failure()` step and nothing failed
(`gh api repos/Pavithran-R-A/DueWeave/actions/runs/37009951112/jobs`).

**A push of `release/consumer-live` starts no CI run.** `.github/workflows/ci.yml` triggers on
`pull_request`, on `workflow_dispatch`, and on `push` to `main` and `current-stage-9-security-ci`
only. That is a fact about this branch, not a defect in the file, and it is the first thing Phase 2
has to change before this branch can carry CI evidence.

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

## Tests actually executed in this phase, on `release/consumer-live`

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

**Not executed in this phase**, because they need the Docker/Supabase stack and this phase is
audit-only: `pnpm db:reset:local`, `pnpm verify:types`, `pnpm verify:migrations`, `pnpm test:db`,
`pnpm test:live`, `pnpm db:lint`, `pnpm verify:release:local`, and every browser command. Their
accepted measurements for this SHA are CI run `37009951112` above and
`docs/RELEASE_GATE_MATRIX.md`.

## Evidence inherited from Stage 9 at this exact SHA

Recorded so a later phase does not re-claim it as new work: pgTAP 8 files / 364 assertions `PASS`;
`pnpm test:live` 9 suites / 307 tests; browser battery `79 + 3 = 82` slots with 0 failed, 0 skipped,
0 did-not-run, 0 flaky at `retries: 0`; 0 `PGRST303`; 0 artefacts uploaded by the failure-evidence
step; 4 credential-redaction markers in the job log and 0 raw credential shapes. Full detail:
`current_stage9_security_ci_report.md` (run 35 and run 36 sections).

## Remaining production blockers

Ordered by what has to happen first. Each names the gate that proves it closed, so none of them can
be closed by a claim.

| ID | Blocker | Status now | What closes it |
| --- | --- | --- | --- |
| B01 | **No production backend exists.** No hosted Supabase project has been created, linked or configured. | none | Owner decision (plan and cost), project creation, `supabase link`, migrations pushed, then re-measurement of the hosted database |
| B02 | **No hosting configuration and no public HTTPS URL.** | none | A static host for `dist/` with a real domain; TLS; then `docs/RELEASE_GATE_MATRIX.md` browser gates pointed at the deployed URL |
| B03 | **`main` has no CI workflow file at all** (`git show main:.github/workflows/ci.yml` fails). The three named checks arrive only with the integration PR. | true on `main` | The integration PR; then the required-check picker can see the names |
| B04 | **Hosted Auth is unproven**: signup email confirmation, Site URL, redirect allow-list, and real password-recovery delivery to a mailbox. `supabase/config.toml` disables signup confirmation locally and the recovery journey reads the local Inbucket inbox. | local-only proofs | Hosted Auth configuration plus a hosted smoke journey that signs up, confirms, signs out and recovers through real email |
| B05 | **Hosted project's own default privileges and role grants are unmeasured.** Fail-closed defaults are proved for this repository's migration role on the loopback stack only (`docs/SECURITY_MODEL.md`, "Known gaps"). | loopback-only | The two catalog queries in `docs/SECURITY_MODEL.md`, re-run against the hosted database after B01 |
| B06 | **Branch protection and rulesets are empty**; `main` accepts direct pushes, force pushes and deletion, and all three merge styles are allowed. | 404 / `[]` | Owner enables the rule in `docs/RELEASE_PROTECTION.md`; the plan's entitlement for private repos is UNKNOWN |
| B07 | **Founder monetization is fail-closed with 7 owner gaps and 0 reviewers.** `FOUNDER_V1` reports `destination-not-live`, `vpa-missing`, `support-pending`, `support-contact-unusable`, `refund-policy-pending`, `refund-policy-text-missing`, `disclosures-pending`; `select count(*) from public.founder_admins` is 0 on the delivered database. | NOT READY, by design | Only the owner's 12-step order in `docs/STAGE_4_2_OPERATOR_CONFIGURATION.md` plus the reads in `docs/FOUNDER_LIVE_ACTIVATION_CHECKLIST.md` and `docs/OPERATOR_BOOTSTRAP.md`. Never fabricated by a workstream |
| B08 | **The 23 committed migrations have never been applied anywhere except a disposable local Postgres.** | local replays | Hosted `supabase db push` (or the dashboard) after B01, then `pnpm verify:migrations` and `pnpm verify:types` against the hosted schema |
| B09 | **CI cannot see this branch**: `release/consumer-live` is not in the workflow's push triggers and no PR exists. | no runs for this branch | A forward commit adding the branch to the trigger list, or the integration PR, then a real run at this head |
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
| First CI run green at a `release/consumer-live` head | **not performed** |

These five rows are what tells a reader whether the project has left pre-deployment. Fill them in the
phase that creates the thing, with the measurement command beside each value.

## Phase log

| # | Date | Phase | Branch and head | What was verified | Blockers changed |
| --- | --- | --- | --- | --- | --- |
| 1 | 2026-10-04 | Takeover, preflight and repository audit | `release/consumer-live`, created at `e5b734b6a24489b80fde65b0909f14bb7a56d64b` | The static gate set re-executed on this branch (lint, typecheck, 386-test unit half with the three class-C contracts then executed against a fresh `dist/`, secret scan over 237 files, clean production audit, counted dev-tree advisories); CI run `37009951112` read job-by-job and step-by-step; PR list, protection state, rulesets, trigger list and the absence of any hosting surface measured | B01-B15 recorded; none closed |

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
