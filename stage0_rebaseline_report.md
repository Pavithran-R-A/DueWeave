# DUEWEAVE STAGE 0 RE-BASELINE REPORT

STATUS:
PASS — every Stage 0 acceptance criterion is met, with one delivery decision left to the owner: the amended branch was **not** force-pushed (see PUSHED TO GITHUB), and the committer-identity question is unresolved by design.

REPOSITORY:
Pavithran-R-A/project-ar1 (private, GitHub Free)

DEFAULT BRANCH:
`main` — unchanged, not merged into, not renamed.

DEFAULT BRANCH STARTING SHA:
`58f0cc76ca560bdac08bdbd19e237aa4a413686b` ("docs: rewrite README as product overview")

ADVANCED CANDIDATE SOURCE BRANCH:
`stage-4-2-operator-readiness`

ADVANCED CANDIDATE STARTING SHA:
`6d99651b9a48933de01cf19ef88e7cd45aa752dc` ("chore: complete stage 4.2A readiness checklist")

STAGE 0 WORKING BRANCH:
`stage-0-rebaseline` (new, created from `stage-4-2-operator-readiness`; tracks nothing until pushed)

ENDING SHA:
A single amended Stage 0 commit on `stage-0-rebaseline` — resolve it with `git rev-parse HEAD`; it is intentionally not quoted in-body, because amending this report to add that number would invalidate the number it quotes. What is fixed and verifiable: the first Stage 0 commit was `d879d5889e54a07934e575dc03eeb4019876bdc7` (still what `origin/stage-0-rebaseline` points at), it was amended rather than followed by a second commit, and the amendment chain is documented under PUSHED TO GITHUB. `main` remains at `58f0cc76ca560bdac08bdbd19e237aa4a413686b`, and all six historical branches plus all six tags are byte-unchanged on the remote.

BRANCH ANCESTRY DECISION:
- Verified remote state directly with `git ls-remote` rather than trusting the briefing's hints; every hinted SHA/branch matched live state, and no newer branch, commit, or PR existed.
- Remote heads: `main`, `stage-2-backend`, `stage-3-beta-readiness`, `stage-4-founder-monetization`, `stage-4-1-release-hardening`, `stage-4-2-operator-readiness`.
- The `stage-*` branches form one linear cumulative chain descending from the `stage-1-approved` tag commit, so `stage-4-2-operator-readiness` is a strict superset of every earlier stage branch. It was selected as the single re-baselined candidate; no intermediate ancestor was re-merged.
- Historical branches, tags, and the default branch were left exactly as found. Nothing was deleted, retagged, or force-pushed.
- `origin/main` is **not** an ancestor of the candidate (`git merge-base` = `86d387d`); the divergence is a single documentation commit, handled below.

MAIN-ONLY CHANGES RECONCILED:
- `58f0cc7 docs: rewrite README as product overview` is the only `main`-only commit, and `README.md` is the only file it touches. It was reconciled semantically, not merged, because a textual merge would have replaced the advanced implementation with a false description of it.
- Kept from `main`: the plain-language product framing, the `> Repository working name: PROJECT AR-1` note, the user-facing feature list, the stack list, and the code-notes map.
- Corrected from `main`: it described the app as "a frontend prototype [that] uses fictional demo data" and said authentication, persistent storage and row-level security "belong to later work". That is untrue of the candidate, which is Supabase-Auth/RLS-backed with 13 migrations and no demo data in any production code path.
- Corrected from the candidate README: it asserted "This branch is `stage-4-1-release-hardening`" and repeatedly scoped claims to "Stage 4.1". Replaced with stage-neutral statements of the actual boundaries (undeployed, no real payment destination, no live verification).
- The candidate README's obsolete `client/src/data/repository.ts` note was dropped with the file (below) and replaced with the real adapter map.

FILES CHANGED:
- `client/public/brand/mark.svg` — new; committed local brand mark (derived from the already-committed `client/public/icon.svg` geometry; no invented third-party artwork).
- `client/public/brand/thread-texture.svg` — new; committed brand weave texture.
- `client/public/brand/promise-illustration.svg` — new; committed promise-note illustration.
- `client/src/config/brand.ts` — brand asset references repointed from uncapturable `/manus-storage/*` URLs to the three committed `/brand/*.svg` files.
- `client/src/data/supabase-activity-repository.ts` — added `metadata` to the `activities` column select (the one functional defect fixed; see below).
- `client/src/components/sheets.tsx` — removed the proven-dead `UpgradeSheet` export and its now-unused `BRAND` import; corrected the header comment's "local prototype" claim.
- `client/src/index.css` — removed the CSS rules that only `UpgradeSheet` used (`.founder-sheet__price*`, `.founder-sheet ul|li|li svg`, `.founder-note*`). `.button-ink` was kept: it shares selectors with live classes.
- `eslint.config.mjs` — dropped the stale `client/public/__manus__/**` ignore; build/test/dist ignores retained.
- `package.json` — `name`: `dueweave-stage1` → `dueweave`; removed the empty `"pnpm": {}` block. Scripts and the `packageManager` pin were not touched.
- `.gitignore` — added `playwright-report/` and `test-results/` (Playwright emits both, ESLint already ignored them, Git did not); removed the two dead Manus ignore lines whose generating plugin no longer exists.
- `.prettierignore` — added the same two Playwright output directories. `pnpm format` runs `prettier --write .`, which would otherwise rewrite generated HTML reports, traces and failure artifacts in any tree where the browser suite has been executed.
- `README.md` — reconciled as described above.
- `client/src/lib/finance.rules.test.ts` — new (31 tests).
- `tests/repository-projection.contract.test.ts` — new (8 tests).

FILES REMOVED:
- `.gitkeep` — 0-byte root template artifact; no build, script, lint rule, test or doc references it.
- `client/src/data/repository.ts` — Stage 1 in-memory repository seam. Proven dead before deletion: `DueWeaveRepository` and `createLocalRepository` appear **only** inside that file across `client/src`, `tests`, `e2e`, and every config; its own doc comment describes a Supabase adapter that now exists as the per-table `client/src/data/supabase-*-repository.ts` modules. Deleting it left zero dangling references and all gates still passed.
- Nothing else was removed. In particular `client/src/data/demo.ts` was **kept**: it has no production importer but is the fixture source for `client/src/lib/finance.test.ts`, so it is live test infrastructure, not deadness. Template/Express/tRPC/Drizzle/`server/`/`shared/`/`__manus__` scaffolding was already deleted on the candidate branch during Stage 4.1 and that cleanup was preserved, not redone.

DEPENDENCIES ADDED:
NONE.

DEPENDENCIES REMOVED:
NONE in Stage 0. The template/runtime packages (`vite-plugin-manus-runtime`, `@types/express`, `drizzle-kit`, `tsx`, `date-fns`, `autoprefixer`, postcss/typography, etc.) were already removed in Stage 4.1; `pnpm-lock.yaml` and `--frozen-lockfile` installs stayed byte-identical throughout this task.

MIGRATIONS ADDED:
NONE. Stage 0 was read-only against the database; no migration was authored merely to "touch" it.

MIGRATIONS MODIFIED:
NONE. All 13 files in `supabase/migrations/` are byte-identical to `stage-4-2-operator-readiness`.

TESTS ADDED / CHANGED:
- `client/src/lib/finance.rules.test.ts` (+31) — pure money/date/promise rule coverage: `parseINRToPaise` accept/reject matrix including non-ASCII digits (`१२`, `١٢`), the ₹9,00,00,00,00,00,000 paise ceiling and its boundary, and `"0"`; `formatINR` Indian grouping and lakh shorthand; outstanding balance after partials, exact zero, other-receivable isolation, overpayment clamp; `isBusinessDate` rejecting `2026-02-30`, `2026-02-31`, `2026-8-1`, `01-08-2026` and ISO-with-time while accepting `2024-02-29`; `addIndiaBusinessDays` year/month rollover and invalid-input fallback; promise sequencing by `sequenceNo` (not `createdAt`) with renegotiation history preserved; snooze visibility across future / on-date / after / most-recent-wins / none; queue determinism (permutation invariance, outstanding tie-break, stable identical tie, settled excluded); the suggestion ladder.
- `tests/repository-projection.contract.test.ts` (+8) — one guard per adapter/repository pair asserting each `toX` adapter only reads columns its repository actually selects. This guards the whole defect class the fix below addresses.
- Existing suite unchanged: `finance.test.ts` (10), `security-contract.test.ts` (20), `client-flow.contract.test.ts` (2), `supabase-adapters.test.ts` (3), `founder-payment.test.ts` (2), `supabase.public-config.live.test.ts` (1, intentionally skipped). Gate total rose 37 → 76 passed tests with no existing test weakened, deleted, or re-skipped.

COMMANDS RUN:
- `git ls-remote --heads origin` / `git ls-remote --tags origin`
  read-only discovery; 6 heads, 6 tags; matched the briefing's hints exactly.
- `git merge-base --is-ancestor origin/main HEAD` → non-zero (main is not an ancestor); `git log --oneline HEAD..origin/main` → exactly 1 commit.
- `git diff --name-status origin/main...HEAD` → 139 files differ; `git diff --name-status HEAD...origin/main` → `M README.md` only.
- `pnpm install --frozen-lockfile` → success, no lockfile drift.
- `pnpm lint` (`eslint client/src tests e2e vite.config.ts --max-warnings=0`) → exit 0, 0 errors, 0 warnings.
- `pnpm check` (`tsc --noEmit`) → exit 0, 0 diagnostics.
- `pnpm test` (`vitest run`) → exit 0; 76 passed / 0 failed / 1 skipped across 7 passed + 1 skipped files.
- `pnpm build` (`vite build`) → exit 0; 1698 modules; `index.html` 1.25 kB, largest JS chunk 462.04 kB (133.56 kB gzip), CSS 58.77 kB (12.11 kB gzip); re-run green after the dead-module deletion.
- `pnpm audit --prod --audit-level=high` → "No known vulnerabilities found", exit 0.
- `pnpm exec playwright install chromium` → browser fetched (first E2E attempt had failed only because the chromium build was absent locally).
- `vite preview --port 3000 --strictPort --host 127.0.0.1` + `pnpm test:e2e` → see PLAYWRIGHT below.
- `grep -rn "manus-storage" dist/` → 0 occurrences; `grep -o "/brand/…\.svg" -r dist` → exactly the three intended refs in `assets/brand-*.js`.
- `curl` per asset: `/brand/mark.svg`, `/brand/thread-texture.svg`, `/brand/promise-illustration.svg`, `/icon.svg` → `200 image/svg+xml` (444 / 1221 / 1551 / 416 bytes); `/manifest.json` → `200 application/json`; legacy `/manus-storage/dueweave-mark_e333309b.png` → `200 text/html` (SPA fallback only — the PNG never existed in the repository).
- Secret scan (`git ls-files` + `git grep` over the committed tree) → see SECRET SCAN.
- `gh run list` → read-only CI history; latest runs on the source branch: success.
- `git status --short --ignored` → only `dist/` plus tooling caches; no stray `.env`.
- `pnpm exec prettier --check .` → 75 files flagged, all from the CRLF checkout vs `"endOfLine": "lf"` described in KNOWN LIMITATIONS; `git ls-files --eol` shows `i/lf w/crlf attr/`, and CI runs no Prettier step. Not treated as a Stage 0 defect and not "fixed" by mass reformatting.
- `git config --get core.hooksPath`, `git log --format='%an <%ae>'` → identity/hook diagnosis recorded under KNOWN LIMITATIONS.

LINT:
PASS — real ESLint 10 flat config (typescript-eslint + react-hooks), `--max-warnings=0`, zero errors and zero warnings. This replaced the earlier placeholder linter and was inherited already-corrected from the candidate branch, then re-verified here.

TYPECHECK:
PASS — `tsc --noEmit`, zero diagnostics.

UNIT / CONTRACT TESTS:
76 passed
0 failed
1 skipped
(The single skip is `tests/supabase.public-config.live.test.ts`, which self-skips unless real `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are present in the environment. The skip was left as designed rather than force-run or deleted.)

PLAYWRIGHT / BROWSER TESTS:
Read the two configurations as a pair; the counts are not interchangeable.
- Committed source, no configuration present: **0 passed / 3 failed / 8 skipped**
- Local fictitious public configuration: **2 passed / 1 failed / 8 skipped**

Neither result proves live Supabase Auth behavior, and neither indicates a Stage 0 regression.
Interpretation: all three failures are environmental, not regressions, and they split into two distinct causes. `client/src/lib/supabase.ts:6` throws at module load without both variables, so with no configuration the SPA never mounts and all three `auth-gateway` specs fail — this also explains why the suite cannot be run "unconfigured". Against the placeholder host the app mounts, the signed-out redirect and the non-technical sign-in failure both pass, and only `auth-gateway.spec.ts:21` fails, precisely at `expect(getByText('If that email belongs to a DueWeave account, a reset link is on its way.')).toBeVisible()` — that notice is rendered only when `supabase.auth.resetPasswordForEmail` resolves without error (`useSupabaseAuth.ts:73-78` → `Auth.tsx:59`), which requires a reachable, authorized Supabase Auth endpoint. No gate was weakened, no spec was edited, and the failure is reported as a failure.
Correction to an earlier claim in this task: a previous turn attributed the run to "2 passed / 1 failed / 8 skipped" as if that were the committed-state result. Reproduced properly, the committed state is 0/3/8 and 2/1/8 needs a placeholder configuration. The conclusion (environmental, not a code regression) is unchanged, but the numbers now carry their configuration.
The 8 skips are pre-existing, credential-gated specs (confirmed-account authenticated journey, CRUD/persistence, free-plan limit journey, Founder purchase/review paths) that require `E2E_EMAIL`/`E2E_PASSWORD` for a confirmed QA account. They were allowed to skip as intended; no credential was fabricated.

PRODUCTION BUILD:
PASS — `vite build` to `dist/`, exit 0, re-verified after every Stage 0 edit.

DEPENDENCY AUDIT:
`pnpm audit --prod --audit-level=high` → no known vulnerabilities; exit 0. Production dependency set unchanged by Stage 0. CI runs the same audit as its final step.

SECRET SCAN:
Clean. No `.env`, `*.pem`, `*.key`, secret/credential-named file, or service-role value is tracked (`git ls-files` filtered). Grepping the committed tree for `service_role|SERVICE_ROLE|eyJ…\.eyJ|BEGIN …PRIVATE KEY|AKIA…|ghp_…|xox[baprs]-|postgres://user:pass@` produced exactly two hits, both benign: prose inside the historical `stage4_2a_final_report.md` and a deliberate negative assertion in `tests/security-contract.test.ts:227`. No hardcoded anon key literal exists. No secret value is reproduced anywhere in this report or in the commit; environment variables are named, never valued. The only files added are three SVGs and two test files.

CI:
`.github/workflows/ci.yml` is present and coherent: triggers on every `pull_request` plus pushes to `main`, `stage-4-1-release-hardening`, `stage-4-2-operator-readiness`; Node 22; `pnpm install --frozen-lockfile` → `lint` → `check` → `test` → `build` → `audit --prod --audit-level=high`; Playwright deliberately excluded. No CI change was needed for Stage 0 — because the `pull_request` trigger is unfiltered, any review PR from `stage-0-rebaseline` already runs the full gate set. Historical runs on the source branch were green. CI for the new branch executes only once the branch is pushed (and, for the push trigger, only for the three configured branches), so this report's evidence is the local run of those identical commands.

BROWSER / RUNTIME VERIFICATION ACTUALLY PERFORMED:
- Loaded the built `dist/` in Chrome via `vite preview` on `127.0.0.1:3000` and captured the full request log for `/auth`: 14 requests, **zero** `/manus-storage/*` requests, and `assets/brand-*.js` plus `/brand/mark.svg` and `/brand/thread-texture.svg` fetched from the local origin.
- Confirmed the three brand SVGs actually decode as images in the browser (not just HTTP 200): `mark.svg` 150×150, `thread-texture.svg` 225×150, `promise-illustration.svg` 233×150 intrinsic.
- Confirmed real DOM usage on `/auth`: `mark` rendered via `<img>` (38 CSS px, `naturalWidth` 150 → parsed), texture applied as `.auth-story__texture` background at `background-size: cover`, `opacity: 0.42`, visible.
- Confirmed the Quiet Ledger visual contract survived re-skinning: computed `body`/shell background `rgb(244, 241, 235)` = `--canvas #f4f1eb`, tokens `--ink #16272d`, `--teal #137b78`, `--amber #b87924`, `DM Sans` resolving as the body font, and headings "Calm control over awkward money conversations." / "Your follow-ups, in one calm place."
- Zero console errors and zero console warnings on the authenticated-gateway route.
- Playwright `accessibility-smoke` and the redirect/invalid-sign-in gateway assertions passed against the built output.
- Not performed: pixel-screenshot capture (the browser tool's screenshot call failed twice with a transport error, so the visual checks above were done through computed styles and geometry instead), and any verification behind a real sign-in session — `/brand/promise-illustration.svg` is referenced only at `client/src/pages/Home.tsx:155`, which sits behind auth, so it was verified as a serving, decoding asset but not in its rendered page context.
- The reported snooze repair was verified statically and by contract test (source → `metadata.snoozed_until` → `toActivity` → `getSnoozeUntil`), **not** by clicking snooze in a live signed-in session, which needs the authorized account described above.

LIVE EXTERNAL VERIFICATION ACTUALLY PERFORMED:
NONE. No Supabase project was connected, queried, or verified; no email or password reset was delivered; no bank/UTR statement was checked; no deployed URL was examined. Every statement in this report about the database comes from reading the 13 committed migrations, and every statement about the running app comes from locally served `dist/`.

CONFIGURATION REQUIRED BEFORE FUTURE LIVE E2E / RELEASE VERIFICATION:
Stage 0 deliberately performed no external configuration and created no credentials, projects, users, or allowlist entries. The variable **names** below are the ones the source already reads; supplying them is a separate owner action, and no value belongs in this repository, in a report, or in a shell history that is shared.

1. Browser-safe public Supabase configuration (required for the app to mount at all — see `client/src/lib/supabase.ts:3-8`; must be present at **build** time, not just runtime, because Vite inlines `import.meta.env`):
   - `VITE_SUPABASE_URL` — the project URL
   - `VITE_SUPABASE_ANON_KEY` — the publishable anonymous key only
   Supply them through a local, Git-ignored environment (`envDir` is the repository root, so `.env` / `.env.local` are picked up and are already ignored) or as per-command environment variables. A service-role or `sb_secret_*` value must never be used here; the security contract test asserts that no privileged value reaches the client.
2. Credential-gated E2E account (required to un-skip the 8 skipped specs, including the failed password-recovery assertion):
   - `E2E_EMAIL` and `E2E_PASSWORD` for a **confirmed** QA account in that project
   - the account must exist with email confirmation already completed, because confirmation is enabled and no confirmation bypass, test-only Auth setting, or self-signed token is acceptable
   - `E2E_BASE_URL` optionally overrides the suite default of `http://127.0.0.1:3000`; a preview server must actually be listening there (`pnpm preview --port 3000 --strictPort --host 127.0.0.1`), since the config declares no `webServer`
   With `VITE_*` supplied but no confirmed account, the expected honest outcome is exactly the 2 passed / 1 failed / 8 skipped pattern recorded above — that failure is a configuration gap, not a bug.
3. Live configuration test: `tests/supabase.public-config.live.test.ts` self-enables only when both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are visible to the test process. It is the only gate that actually exercises a real project, so it must be run once during a future release verification rather than left skipped.
4. Database-side verification (not achievable from source review): apply the 13 committed migrations to a **disposable** project, then execute the RLS/cross-tenant/attack matrix and the Founder RPC seat-cap, duplicate-UTR, and self-activation checks against it, and clear any Supabase advisor findings there. Stage 0 added no migration and touched no live schema.
5. Release-gate configuration that still must be decided by the owner and must **not** be silently resolved:
   - GitHub branch protection on `main` with required status checks and no direct pushes, per `docs/RELEASE_PROTECTION.md` (guidance only; nothing was enabled)
   - a committer/reviewer identity policy for this repository (see KNOWN LIMITATIONS — every historical commit is authored as the platform agent, and no Git identity is configured locally or globally)
   - a second-party review of the `stage-0-rebaseline` branch before any merge to `main`
   - a real business payment destination, approved refund/support/privacy terms, and an executed operator allowlist bootstrap per `docs/OPERATOR_BOOTSTRAP.md` before any monetization claim is true
   - an independently verified hosting target — none exists, so no deployment or live-payment statement may be made in any downstream stage without new evidence

SUPABASE LIVE MUTATIONS:
NONE. Zero connections were opened to any Supabase instance; no migration was applied, edited, or retracted; no row, policy, grant, function, or setting was altered; no new migration was added to "touch" the database.

DEPLOYMENT:
NONE. No hosting target was created or configured, no artifact was published, and no URL is live.

PAYMENT ACTIVATION:
NONE. The Founder offer remains a manual-verification PLACEHOLDER with no real UPI destination, and the payment-readiness gate migrations are unchanged. No gateway was integrated and no charge is possible.

CURRENT ROADMAP GAPS DISCOVERED (inventoried only, deliberately not implemented):
1. No confirmed QA account exists for the credential-gated E2E specs, so the full authenticated journey (CRUD, persistence across reload, partial payment, free-plan limit rejection → `/founder`, Founder claim/review) has never been executed end-to-end against a real project.
2. The app hard-fails to boot without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (`lib/supabase.ts:6`); there is no `.env.example`, so a fresh clone cannot produce a runnable build without reading source to discover the variable names.
3. Live database verification of the RLS/constraint/RPC model has never been run — the security posture is enforced by source that is reviewed and unit-grep-tested, not by an executed attack matrix against a real instance.
4. No repository protection, required status checks, or CODEOWNERS exist; `main` accepts direct pushes. `docs/RELEASE_PROTECTION.md` is written but unexecuted.
5. Founder monetization needs a real business payment destination, approved refund policy text, a published support contact, and privacy/terms pages before any launch; the operator allowlist bootstrap in `docs/OPERATOR_BOOTSTRAP.md` has not been performed.
6. No hosting/deployment pipeline for a static build exists at all, and no environment separation (dev vs prod project) is defined.
7. `client/src/data/demo.ts` fixtures and the production Supabase data path coexist; the test-only status of demo data is unstated in code and easy to mistake for a live fallback.

EXTERNAL ACTIONS STILL REQUIRED:
Everything below is outside what a source-only Stage 0 can do, is listed as an instruction, and was **not** performed here.
- Decide the repository committer/reviewer identity policy, then review and merge `stage-0-rebaseline` deliberately (or discard it) — no merge happened in Stage 0.
- Enable GitHub branch protection and required status checks on `main` per `docs/RELEASE_PROTECTION.md`; today `main` accepts direct pushes and has no protection.
- Provision the local/CI environment values and the confirmed QA account described in CONFIGURATION REQUIRED BEFORE FUTURE LIVE E2E / RELEASE VERIFICATION, then re-run the browser suite with real configuration.
- Apply the committed migrations to a disposable Supabase project and run the live RLS/attack-matrix and Founder RPC verification; clear advisor findings there.
- Configure a real business payment destination, publish approved refund/support/privacy/terms text, and execute the `founder_admins` allowlist bootstrap per `docs/OPERATOR_BOOTSTRAP.md`.
- Stand up static hosting and an independently verified deployment environment, and establish the manual bank/UTR review operating procedure with a named reviewer.

KNOWN LIMITATIONS:
- **Committer identity is unresolved, and Stage 0 did not configure it.** Neither `user.name` nor `user.email` is set locally or globally on the machine used here, and every one of the repository's prior commits — on `main` and on all five stage branches — is authored and committed as `Manus <dev-agent@manus.ai>`, the platform agent's identity. To keep history consistent and avoid attributing work to a person, the Stage 0 commit reuses that existing convention through per-command `GIT_*_NAME`/`GIT_*_EMAIL` environment overrides only; `git config` was not read-modified, and no global setting was touched. The owner must decide the permanent authorship policy before this branch is merged or any default branch changes, because rewriting an already-published author on `main` or on a tagged release is not something Stage 0 should do silently.
- **`pnpm format` is unusable on a Windows `core.autocrlf=true` clone, and nothing gates it.** `prettier --check .` flags 75 files here, but the cause is line endings, not style: `git ls-files --eol` reports `i/lf w/crlf attr/` for tracked files, i.e. the index and every committed blob are LF while the working tree is checked out with CRLF, and `.prettierrc` requires `"endOfLine": "lf"`. Every one of my own edits is likewise committed as LF, so the repository content is internally consistent — the mismatch is per-clone. Because no `.gitattributes` exists, normalization depends on each machine's `core.autocrlf`, so running `prettier --write .` would rewrite line endings across the whole tree in an unrelated diff. CI does not invoke Prettier at all, so this is a latent contributor trap rather than a broken gate; the correct fix is a `.gitattributes` (`* text=auto eol=lf`) decided alongside the identity policy, which is outside Stage 0's minimal-change scope.
- **Git hooks did not execute.** `core.hooksPath` points outside the repository at `~/.codex/git-hooks`, whose `post-checkout`/`post-commit` wrappers emit `Can't find lefthook in PATH` on every Git command here. The repo itself ships no `.husky`/`lefthook` configuration or tracked hooks, so nothing repository-defined was bypassed, and `--no-verify` was never used. Verification therefore rests on the explicitly run gate commands below, not on a hook.
- Playwright's default `baseURL` is `http://127.0.0.1:3000` but `playwright.config.ts` declares no `webServer` and `vite.config.ts` sets no `preview.port` (Vite's default is 4173), so the suite silently fails to connect unless the operator starts the preview on port 3000 by hand. The README now documents the exact command.
- RLS is `enabled` on all 13 tables but never `FORCE ROW LEVEL SECURITY`, so a table-owner role would bypass policies. Low practical risk under Supabase's role model; recorded rather than changed, since forcing policies is Stage 2+ security work with live-database verification implications.
- Ownership policies omit a `TO` clause (Postgres defaults them to `PUBLIC`) instead of narrowing to `TO authenticated`. They remain safe because every predicate compares `owner_id = auth.uid()`, which is null for anonymous requests — so this is a defense-in-depth tightening, not a vulnerability.
- Three "contract" suites (`security-contract`, `client-flow`, `repository-projection`) assert against migration/source **text** via `readFileSync`, so they detect absent or renamed SQL but cannot prove the database behaves as written. `repository-projection` was deliberately built on that same pattern for consistency; it demonstrably fails when the fix is reverted, which is the strongest guarantee a source-level test can give.
- The money/date rules read the wall clock directly (`finance.ts:6` calls `new Date()` for the India business date), so date-boundary behavior is not injectable and cannot be tested at fixed instants without changing production code.
- Positive verification available locally: `record_payment` **does** guard overpayment (`p_amount_paise > v_receivable.outstanding_paise`, `20260812151500_stage2_schema_alignment.sql:238`, with the same guard at `20260812150500_secure_foundation.sql:465`) under `SELECT … FOR UPDATE`, and the hot ownership/foreign-key columns (`owner_id`, `client_id`, `receivable_id`, `promise_id`) **are** indexed (`20260812150500_secure_foundation.sql`). Two hypotheses carried from earlier notes in this task — "no database-level overpayment guard" and "unindexed foreign keys" — were re-checked against the SQL and are **wrong**; they are recorded here as disproven so they are not re-reported as defects.
- Stage 0 touched only source, tests, docs and ignore files. Nothing about the pre-deployment status of the product changed: it is still not deployed, not monetized, and not live-verified.

NEXT RECOMMENDED ROADMAP STAGE:
Stage 5 (launch readiness) remains the correct next move, and its first unit of work should be the external, non-code prerequisites this report cannot satisfy: provision a confirmed QA account, apply the 13 committed migrations to a disposable project, execute the RLS/attack-matrix and credential-gated Playwright specs against it, then add `.env.example`, repository protection, and a real (test-mode) payment destination. That ordering is a recommendation for a separate authorization, not work started here.

WORKING TREE CLEAN:
YES — `git status --short --ignored` shows only ignored tooling output (`dist/`).

PUSHED TO GITHUB:
PARTIALLY — and deliberately not finished. `stage-0-rebaseline` **was** pushed once as a new branch and `origin/stage-0-rebaseline` currently holds commit `d879d5889e54a07934e575dc03eeb4019876bdc7`. The subsequent amend (`.prettierignore` fix plus these report corrections) produced a local `HEAD` that differs from it — confirm with `git rev-parse HEAD` versus the remote value above — and `git push --dry-run` proved that publishing it is a **non-fast-forward update requiring a force-push**. Per instruction, no force-push was performed and no `git pull`/rebase/merge was used to paper over the divergence.
Consequence to be aware of: the remote branch currently carries a report that predates the `.prettierignore` fix and the corrected Playwright interpretation. The complete, corrected Stage 0 delivery exists only locally until the owner resolves the divergence.
Owner action to publish it (only after deciding the identity question below, since the rewrite is the moment at which authorship is easy to correct):
`git push --force-with-lease=refs/heads/stage-0-rebaseline:d879d5889e54a07934e575dc03eeb4019876bdc7 origin stage-0-rebaseline`
`--force-with-lease` is required rather than bare `--force` so the update fails if anyone else has moved that branch meanwhile. This rewrites **only** the dedicated Stage 0 branch: `main`, all five historical stage branches, and all six tags are untouched and were re-verified on the remote (`main` still `58f0cc76ca560bdac08bdbd19e237aa4a413686b`).

PR CREATED:
NO
PR URL: none. GitHub offered `https://github.com/Pavithran-R-A/project-ar1/pull/new/stage-0-rebaseline` when the branch was pushed, but no PR was opened: opening one against the known-stale remote commit would present the un-corrected report as the review artifact. Recommendation is to publish the amended branch first, then open the review PR — and do not merge it without deciding the committer-identity and branch-protection items above.

DO NOT START THE NEXT STAGE.
