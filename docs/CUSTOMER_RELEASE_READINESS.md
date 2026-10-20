# DueWeave — Customer Release Readiness

**Prepared:** 2026-10-09  
**Repository:** Pavithran-R-A/DueWeave, branch `release/consumer-live`  
**Site:** https://dueweave.pages.dev  
**Backend:** DueWeave Production, project `ugzdqcytouwfdlcjujqv`  
**Claim permitted today:** publicly deployed release candidate, **not** 100% customer-ready.

This document separates verified evidence from customer-facing promises. A green build and a
successful unauthenticated screenshot do not establish end-to-end customer acceptance.
Any later SHA must earn its own CI and deployment verification.

## Evidence already obtained

| Customer promise or invariant | Evidence | Classification |
| --- | --- | --- |
| Public HTTPS and anonymous auth-page rendering | Cloudflare Pages Git deployment and separate real-Chromium public-route smoke | Verified for unauthenticated screens |
| Mobile login form, signup form validation, forgot-password navigation, route guards, favicon and manifest | `e2e-live/public-release.spec.ts` on `https://dueweave.pages.dev`, no data created | Verified for tested paths, not signup delivery |
| Database authorization, tenant separation and anonymous isolation | Hosted Phase 3B two-account isolation matrix; 13/13 public tables RLS-enabled; anon/PUBLIC routine EXECUTE zero | Verified for measured hosted matrix |
| Monetary dates, receivable/promise/payment history, exports, Founder refusal behavior and customer journeys | Vitest, pgTAP, DB/live, and Playwright local-stack CI gates; consult exact-head run, not earlier counts. **Amended 2026-10-14:** the advertised free-tier journey was then executed signed-in on `https://dueweave.pages.dev` as a real confirmed customer — onboarding, adding a client, promising money, recording a payment, following up and exporting — and each step was read back from `ugzdqcytouwfdlcjujqv` through `scripts/hosted-db-census.mjs --owner <qa-account>`, which answers 5 activities / 1 client / 1 promise / 1 promise event / 1 payment / 1 receivable / 1 entitlement / 1 profile and 0 analytics or Founder rows; Founder stays refused on production, and the eight-character password minimum was proved on the deployed build including a rejected seven-character attempt. **Amended 2026-10-16:** the two hosted gaps this row named are closed — production cross-tenant isolation was executed as 47 declined probes with 0 findings (`scripts/hosted-tenant-isolation.mjs`, `prod-census/isolation-1057.log`, gate 3), and one confirmed signed-in account was erased on production and proved by before/after census (`scripts/hosted-account-erasure.mjs`, gate 4) | Hosted browser acceptance executed for the single-account free-tier journey; production cross-tenant isolation and production account erasure are now measured (2026-10-16); the large-data export joined them the same day (see the next row) |
| User-owned account erasure with history | Production migration 25 and transaction-rollback database acceptance. **Amended 2026-10-12:** CI's `Browser release smoke` executes the destructive path end to end at every head — `e2e/stage9-release-journey.spec.ts:505` opens the sheet, requires the exact phrase, clicks delete through the served `delete-account` function (`.github/workflows/ci.yml:160`), lands on `/auth` and is then refused sign-in with the old credentials (`✓ 80 … (1.6s)` in run `38253358122`) — which is a real cross-origin browser erasure with real Auth removal, against the **local** stack rather than production. **Amended 2026-10-16:** the same removal was executed against `ugzdqcytouwfdlcjujqv` by `scripts/hosted-account-erasure.mjs` — a confirmed, signed-in QA account erased through the served function with its own bearer and the exact phrase, judged by a census read before and after (instrument: `accounts=2 → accounts=1`, `FUNCTION … HTTP 200 status=deleted`, `own-rows none · auth-own none`, `GRANT … HTTP 400 — it no longer signs in`, exit 0; independent frozen census: `DONE 10/10 reads answered`, no `account-state` row, `rows_for_owner` 0 in every auth table, October 5 orphans preserved, QA-A's ledger unmoved). Its **first attempt answered a platform `503` and was reported as `erasure NOT proven — 12 finding(s)` with every count unchanged** rather than retried into a guess (gate 4 records the classification). The deployed sheet's guards were separately walked in headed Chromium on production — 20 checks, 0 failed, `calls=0` reaching the function | Production erasure proven by before/after census for one confirmed signed-in account (2026-10-16); the destructive submit clicked through the deployed UI on production is still open and deferred to the QA-A cleanup run, for the reason stated in gate 4 |
| Real hosted frontend source and Supabase config | Pages project production branch `release/consumer-live`, build `pnpm build`, output `dist`, active Supabase URL/publishable-key envs. **Amended 2026-10-14 at the released tip `505ff51`:** `node scripts/verify-deployed-parity.mjs --dist dist-paused --url https://dueweave.pages.dev` answers exit 0 — a flags-off build of this head reproduces the served entry `assets/index-Bv2LIPpN.js` and the lazily-loaded `assets/Auth-BIHs1b_G.js`, all 20 built files match, and both host configurations hold by effect (`_headers` with 80 live declarations honoured, `_redirects` answering `/parity-probe` with HTTP 200). The served Auth chunk is the closed-flag artifact: the registration affordance is absent from its bytes and "New registrations are temporarily paused" is present in them, so what production holds closed is proved at build time rather than inferred from a runtime conditional. **Re-measured 2026-10-15 with the tree at `51c7689` plus this instrument repair, and the exactness is checkable rather than assumed:** `git diff --name-only 505ff51 HEAD` moves no file under `client/`, `vite.config.ts`, `index.html` or `public/`, so the flags-off artifact in `dist-paused` is still the one this source line produces. The same command against `dist-paused` still answers exit 0 with all 20 files matching, but two ways this gate could lie were found by running it against the wrong directory. (1) Compared against a plain `dist`, eleven chunks now read `MISS … the file is not served by the deployed site` where the instrument used to report "495294 local bytes differ from 1222 served bytes" — Cloudflare Pages answers a path it has no file for with the SPA entry (`_redirects`: `/* /index.html 200`), so an artifact absent from the deployment still returns HTTP 200 with the fallback's 1222 bytes, and the old wording described that as a content change. Production holds the flags-off artifact, so `dist-paused` is the directory that can prove parity, and the eleven "mismatches" were my own wrong input, not a moved deployment: the served entry is still `assets/index-Bv2LIPpN.js` and the served Auth chunk still `assets/Auth-BIHs1b_G.js`. (2) The per-file digests printed are now digests of the bytes the verdict was computed on, so a pass no longer reads `SAME icon.svg local=15c80b908ebf deployed=0f0c1a24583a` — two different numbers under a SAME label, which made a correct verdict look broken — and a checkout-copied static that differs only by carriage returns says so in words. Both repairs were observed RED on the written line before going green; `tests/deployed-artifact-parity.contract.test.ts` carries 15 cases now. **Superseded on the served-entry half at `2026-10-16T14:11Z`, by measurement rather than by assumption:** this row asserted "the served entry is still `assets/index-Bv2LIPpN.js` and the served Auth chunk still `assets/Auth-BIHs1b_G.js`", and that stopped being the canonical artifact the first time a pushed head changed client source. `GET https://dueweave.pages.dev/` now names `assets/index-vEHLqm_5.js`, whose lazy map points at `assets/Auth-CP-OJQ39.js`; the previous pair is still addressable (`index-Bv2LIPpN.js` answers HTTP 200 with 495,042 bytes of `application/javascript` referencing `Auth-BIHs1b_G.js`), so Pages keeps a prior deployment's hashed assets rather than only the SPA fallback — which is exactly the shape that would let an old artifact be mistaken for the live one. The consequence for this gate is that **Pages rebuilds on every push to `release/consumer-live`**, so the deployed bytes track the branch head rather than a pinned release build, and flags-off is held by the project's build environment, not by the deployment being old: the new entry carries the `status===429` predicate shipped at `1a025bd` while the new Auth chunk still carries the pause copy. `node scripts/verify-deployed-parity.mjs --dist dist-paused` has **not** been re-run at this head, because producing `dist-paused` needs a build and this host has 215 M free on `C:`; the exact-head byte-for-byte parity claim therefore stands at the `505ff51`-era artifact and the moved entry is recorded as a measured change, not as a passing re-run. **Re-run and green at `a780209` the same evening (`~2026-10-16T16:14Z`):** free space returned (4.2 G on `C:`), `dist-paused` was rebuilt with the exact flags-off environment `scripts/run-paused-e2e.mjs` uses, and the instrument printed `Compared 20 built file(s) and verified 2 host configuration file(s) … Parity holds` with exit 0 — entry `assets/index-vEHLqm_5.js` (495.17 kB) and `assets/Auth-CP-OJQ39.js` both `SAME`, `_headers` 80 live declarations honoured, `/parity-probe` answering HTTP 200. That is the first exact-head parity pass since the served entry moved, and it retires this row's "outstanding for want of disk". Two limits survive the green exit: no Cloudflare credential is held on this line, so **the deployment's own commit SHA is still unread**, and `a780209` ships no client change, so the artifact equals what `1a025bd` built — parity here proves this head compiles to what is served, not that Pages rebuilt for this SHA. | Deployed flag state and served predicate verified on production; exact-head artifact parity re-run green at `a780209` (20 of 20 files SAME plus both configuration effects); the deployment's own commit SHA remains unread for want of a Cloudflare credential |
| Full ledger and downloadable archive past PostgREST 1,000-row default limit | Page-by-page queries with stable order, unit tests for 1,201 rows and errors. **Amended 2026-10-16: the live half executed.** `tests/stage7-local-export.test.ts` gained a `seedBulkHistory()` helper and the case "carries every row of a history longer than one request can return", which writes 1,201 activities and 1,201 analytics events for the signed-up fixture owner — every row owned by that account and citing that owner's own client and receivable, so the Stage 5 ownership trigger is satisfied rather than skipped — and then builds the archive through the shipping `SupabaseDataExportRepository`. The ceiling is real and silent: the run printed `Stage 7 bulk history: database holds 1211 activity rows; one un-paged read returned 1000`. The case asserts the snapshot's `activities` and `analyticsEvents` id sets equal the owner's database id sets (1,211 each), that the downloadable activities CSV carries those same ids one line per row, that the JSON bundle carries them, and that the paged read left the ledger as it found it (the owner's id sets after the archive are the ones taken before it). GREEN: focused live run 11/11 in 19.92 s. RED watched, not assumed: with `collectAllRows` temporarily made to return after the first page, only the new case failed — `the archive lost activity rows past the first page: expected [ …(500) ] to deeply equal [ …(1211) ]` — and `client/src/data/pagination.ts` was then reverted byte-identical (`git diff -- client/src/data/pagination.ts \| wc -l` → `0`), so the paging the test proves is the paging that ships. Cross-checked against CI at `ddb9340`, where the same file answers `✓ tests/stage7-local-export.test.ts (10 tests) 6635ms` inside `Tests 331 passed (331)`; this host's battery counted 332, which is that 331 plus this case. **(Superseded 2026-10-17: CI now runs the case itself, and the two counts agree.)** At the CL-39 push head `2fb74ca` the `Database contracts` job prints `✓ tests/stage7-local-export.test.ts (11 tests) 5910ms` inside `Test Files 10 passed (10)` / `Tests 332 passed (332)`, `Duration 46.42s`, and the ceiling line is in that job's own output too — `Stage 7 bulk history: database holds 1211 activity rows; one un-paged read returned 1000` — so the large-data read is proven on CI's stack, not only on this host's, and the 331-vs-332 gap was the missing case rather than a divergent instrument. `pnpm test:unit` (50 files / 750 tests, exit 0) and `node scripts/verify-secrets.mjs` (exit 0) both re-run at this change. | Large-data export verified live against the loopback stack (2026-10-16): a 1,211-row history read completely through the shipping repository, read-only, with the failure mode proved by a paging mutation and CI green on the same suite at the exact SHA |
| Password and Auth network errors do not strand the form | Guarded `try/catch/finally` and friendly error responses. **Amended 2026-10-14:** the adverse browser-network simulation was executed against the deployed build in real Chromium with a confirmed customer session, with every REST read routed through an aborting interceptor. A cold load whose profile reads fail answers honestly after the REST client's own GET backoff (attempts measured at 0.26 s, 1.28 s, 3.31 s and 7.34 s, each `net::ERR_FAILED`) with "Couldn't load this view / Your private ledger remains protected. / We could not refresh this screen. Check your connection and try again…" and a `Try again` button, and no technical detail; retrying against a still-failing read returns that same screen with no blank or detached frame in between; retrying after the connection returns reproduces the online money brief exactly; and a client save attempted with the browser offline refuses in 581 ms with "Could not add client — We could not reach DueWeave. Check your connection and try again.", keeps the typed name on screen, re-enables Save, and leaves the hosted row census byte-identical to the one taken before the run. The wait before the error is the library's documented retry (`@supabase/postgrest-js` 2.112.3: 3 attempts, GET only, 1 s/2 s/4 s), not an application strand — money writes are POST RPCs and are never retried, so a flaky network cannot double-apply one. **Amended 2026-10-16 at `1a025bd`:** the same friendly-mapping path carried a reachable defect of its own — a customer throttled by the auth server was answered "We could not complete that request. Please try again.", which is advice that lengthens the window every time it is followed. `friendlyAuthError` recognised only the substring "rate limit", and gate 7 records that this project's 429 body has never been captured; the client library provably puts the HTTP status on the error, so the reading now keys on `status === 429` first and keeps the wording only for replies that arrive without one. Three call sites in `client/src/hooks/useSupabaseAuth.ts` (`signOut`, `resetPassword`, `updatePassword`) now pass `error.status`, and the two interpreters that already received the whole reply read it. Watched RED as 4 failures reporting the wrong sentence, then 6 cases green (`tests/confirmation-resend.test.ts`); the security contract's `friendlyAuthError(error.message)` grep was widened to tolerate the second argument, not deleted, so it still fails if the hook stops mapping refusals into friendly copy. **Live re-measurement at `2026-10-16T14:11Z` corrected this row's own first claim about the bundle:** the canonical served entry is now `assets/index-vEHLqm_5.js` (495,166 bytes) and its bytes carry the minified predicate — `function iy(i){return i.status===429\|\|i.message.toLowerCase().includes("rate limit")}` — so the repair is deployed, not merely unit-gated; and the chunk that entry lazy-loads, `assets/Auth-CP-OJQ39.js` (10,026 bytes), still contains "New registrations are temporarily paused" and contains no "Create an account", so what shipped is still flags-off. | Network path and refusal copy verified on deployed production, with the `status===429` predicate read out of the served bytes at `14:11Z` |
| A stale edit is refused in words the customer can read, not left hanging | Both edit routines refuse a write that carries a `p_expected_updated_at` the row has outgrown. **Found and repaired 2026-10-17 (CL-39):** the refusal was raised with SQLSTATE `40001`, which a PostgREST in front of Postgres reads as an instruction to re-run the transaction rather than as an answer to send back, so the refusal existed in the code and never reached the caller. Measured on production `ugzdqcytouwfdlcjujqv` on 2026-10-16: the same session answered a `P0002` refusal in 76 ms and 128 ms while the stale-token call was still unanswered after 30 s and the edge returned HTTP 504 "upstream request timeout" at 125,140 ms, with the owner's read-back afterwards proving the row untouched — the customer waited two minutes for a message the code already had. Reproduced on the pinned local build `postgrest:v14.18` on 2026-10-17 in one run: `40001` unanswered at 40 s and `40P01` unanswered at 20 s, while `P0001` answered in 253 ms and a private-use `DW001` in 181 ms, and `P0001`/`DW001` answered again (124 ms / 15 ms) after both stalls, so the stall belonged to the raised code and not to a wedged pool. `20261017090000_current_cl39_edit_conflict_errcode_reachable.sql` re-raises both refusals with the private code `DW001` and changes nothing else — verified against the original routine bodies statement by statement (1800 vs 1800 characters for `update_client`, one differing statement, signature identical, grants, revokes and comments restated byte-identical), so the fail-closed authorisation the Stage 4 migration set up is preserved rather than inherited. `supabase/tests/stage4_02_edit_conflict_code.sql` (`plan(5)`) pins the code out of each routine's own source next to its own message, pins the customer-facing wording that drift would silently drop, and sweeps the whole `public` schema for any routine raising the two retryable codes. The adapter renders `DW001` as "This record changed while you were editing. Reopen it and save again with the latest version.", and five leak guards (`tests/stage6-error-copy.test.ts`, `tests/repository-boundary.contract.test.ts`, two browser specs, the adapters' own unit cases) now refuse the code itself reaching the screen. CI at `2fb74ca` measures the tenth pgTAP file `... ok` inside `Files=10, Tests=410 … Result: PASS`, with `Migrations on disk: 26. Applied in the local database: 26.` and the live battery `Tests 332 passed (332)`, `✓ tests/stage4-local-edit-workflows.test.ts (14 tests) 592ms` carrying the three `DW001` assertions. **Written as not claimed, claimed now (re-measured 2026-10-17 at `6f5e919`):** this row first said the hang-to-prompt-refusal re-measurement against the *migrated* local build had not run because this host's Docker daemon was down and `C:` had 1.1 GB free. The daemon came back and that half was taken: migration 26 was applied forward to the running local database (`pnpm verify:migrations` → `Migrations on disk: 26. Applied in the local database: 26.`), and a throwaway account driving the real routines over HTTP through this stack's gateway (`127.0.0.1:54321`, `postgrest:v14.18`) got `HTTP 400` with `code=DW001` and the unchanged wording in 14/10/20 ms across three stale `update_client` calls, 13 ms with no token at all, and 18/13 ms for stale `update_receivable_details` — while the legitimate fresh-token edit answered `HTTP 200` in 21 ms and returned the new name, so the repair did not loosen the write it protects. CI still cannot supply either half, because its `postgrest:v16.2` answers `40001` in 676 ms and 752 ms, which is exactly why every CI head in this release line stayed green while real customers hung. The full reading, including what the BEFORE half is and why the stall cannot be re-created on a repaired database, is in the row-N bullet of `docs/RELEASE_GATE_MATRIX.md`. Also recorded rather than fixed: `40901` (Stage 5's idempotency-key refusal) is class 40 too but answers promptly (HTTP 500 in 27 ms, measured on the same build and session) and its wording is already mapped, so it is a rough edge, not this defect. **Promoted to production 2026-10-17:** `supabase db push --skip-vault --yes`, authenticated to the session pooler with the project's database credential rather than a management token, applied the exact committed file in **2,873 ms** at exit `0` after `--dry-run` had named only that file (2,516 ms), and the hosted catalog now reads **26/26** with both routine bodies carrying `DW001` (md5 `ad3f752c…` / `b1700d6a…`, signatures, owner, definer and ACL byte-identical to the pre-push reads). The same instrument, `scripts/hosted-stale-edit-probe.mjs`, on the same signed-in account then answered `FRESH update_client HTTP 200 in 67 ms` (token moved), `STALE … HTTP 400 DW001 in 69 ms`, `NO-TOKEN … HTTP 400 DW001 in 40 ms`, `FRESH update_receivable_details HTTP 200 in 195 ms` (token moved), `STALE … HTTP 400 DW001 in 42 ms`, `NO-TOKEN … HTTP 400 DW001 in 46 ms`, and the account's ledger read the same rows afterwards — against the BEFORE run at 25 migrations on this very instrument, where the authorized writes were already fast (148 / 159 ms) but **all four** rejected attempts answered *nothing at all* until the client gave up at 30,025 / 30,004 / 30,013 / 30,002 ms. So this row's refusal latency is now a production measurement rather than a laptop one, and `verify:hosted:census` at 26 migrations (`DONE 8/8`) shows no policy, grant or definer drift against the 25-migration census. | Conflict code and refusal wording pinned by pgTAP and CI at the exact SHA, and the transport behaviour that made the old code unreachable measured on production and on the pinned build; the post-migration latency re-measured on this host's serving `v14.18` build at `6f5e919` (six stale or tokenless refusals in 10-20 ms, fresh-token control write `HTTP 200` in 21 ms); and the same latency re-measured **on production** at 26 migrations on 2026-10-17 — four refusals `HTTP 400 DW001` in 40-69 ms where the identical four calls had answered nothing for 30 s, two authorized writes `HTTP 200` in 67 / 195 ms, ledger rows unchanged afterwards |

## Blocking gates before the words “100% customer-ready”

1. **Email signup and password recovery:** Supabase's built-in sender is not suitable for
   public production accounts; the connected Resend account has **no verified sending domain**.
   Configure a legitimate production SMTP identity/domain, verify SPF/DKIM/DMARC, and execute
   signup-confirmation and password-recovery acceptance with a real mailbox. Do not claim an email
   arrived based only on an API 200 or a local test inbox.
   **Amended 2026-10-14:** the signup-confirmation half now rests on delivered evidence rather than
   configuration intent. A confirmation message for the released QA identity was sent with
   `emailRedirectTo=https://dueweave.pages.dev/auth`, read from the real Gmail mailbox, and the link
   completed confirmation at 07:46:57 UTC; navigating that same link again four seconds later was
   refused, because its one-time token had already been spent. Recovery **delivery** has since joined
   it as delivered evidence — genuine reset messages arrived in the same mailbox and the link they
   carried opened on `https://dueweave.pages.dev/auth/update-password` (see gate 2) — so what this gate
   still lacks is the **completion** of one recovery on the deployed route, proving the new password
   signs in and the old one is refused, plus the SPF/DKIM/DMARC properties, which are
   provider-console facts no probe from this repository can read. The request side is now an
   executable, repeatable step rather than a hand command:
   `node scripts/hosted-auth-status.mjs --identity ~/.config/dueweave/qa-a-identity.json --request-recovery` asks the hosted
   sender for a reset mail at `https://dueweave.pages.dev/auth/update-password`, which is the
   destination `client/src/hooks/useSupabaseAuth.ts:83` asks GoTrue for and the only route that
   renders the password form. Measured 2026-10-15, the same address was accepted twice 63 seconds apart
   (`HTTP 200` at `06:10:27Z` and `06:11:30Z`), while a faster repeat had answered `HTTP 429` on
   2026-10-14 — the sender throttles, and a 429 means nothing new was mailed. **That 200 is not evidence the link lands on
   DueWeave** — see gate 2's measured control.
   **Second identity created through the public API 2026-10-14, confirmed 2026-10-15:**
   `dueweave+releaseqa-b-20261014@gmail.com` (`81a37c9e-9103-4e4c-b89c-3991965da1cd`) was created by
   `POST /auth/v1/signup` — the same call a customer's browser makes, not an admin insert — and the
   answer carried a user object with **no session**, which is what a confirmation-required project
   returns. The census on `ugzdqcytouwfdlcjujqv` read it back rather than trusting that response:
   `auth.users` 1 → 2 and `unconfirmed` 0 → 1, with `profiles` and `entitlements` each 1 → 2. The
   credential-bearing probe then refused it: `GRANT … HTTP 400 — sign-in refused ("Invalid login
   credentials")`, while the same probe for QA-A answers HTTP 200. **That refusal proved the stored
   credential was not the account's password, nothing more — see the correction below.**
   **Corrected 2026-10-15: the second half of gate 1 is closed for QA-B, by a completed recovery rather
   than a confirmation link.** The census read `email_confirmed true` / `email_confirmed_at
   2026-10-15 10:40:28.861752Z` / `last_sign_in_at 2026-10-15 10:40:28.868984Z`, i.e. the GoTrue
   behaviour documented two paragraphs below did exactly what it says: the owner opened a reset link in
   their own browser and completing it confirmed the address. So QA-B is real, is confirmed, and is
   signed-in-able — but **not with either credential this repository holds**, because the password the
   form received was typed by the owner, not read from `qa-identity-b.json`: the probe now answers
   `OLDPW … HTTP 400` and `NEWPW … HTTP 400`. The live pair is therefore still owed, and the only exits
   are the owner typing this file's `recoveryNewPassword` into a fresh link or writing the password they
   chose into the file. **Superseded 2026-10-19: neither exit remains open, because neither file does.**
   QA-B was erased from production on 2026-10-16 by its own authenticated deletion, and the two QA
   identity files this paragraph names were retired out of the repository on 2026-10-19; the surviving
   keeper is off-repo and its pattern is recorded in `docs/SECURITY_MODEL.md`. QA-A's recovery pair is
   now closed by a completed recovery on the deployed route (gate 5, step 7-8), so the two-account
   isolation matrix has since been re-run against QA-C rather than this account. **The instrument that printed the wrong inference has been repaired:**
   `scripts/hosted-auth-status.mjs` used to render any refused grant as "so confirmation is still
   required", which the catalog then contradicted, and it rendered a refused recovery password as "so
   the delivered link has not been used", which is exactly what a link that installed a *different*
   password also looks like. Both lines now keep that conclusion only when GoTrue states the state
   itself (`"Email not confirmed"`) and otherwise name the two readings and point at
   `hosted-db-census.mjs --owner <account>`, with two contract cases per line pinning which refusal text
   may carry a conclusion and which may not — this file at `23 passed (23)`, re-measured against
   production at `12:13:17Z` where QA-B's `NEWPW` refusal now prints the ambiguous form.
   **How it gets closed, measured from the GoTrue source rather than assumed:** this project runs
   GoTrue v2.197.0 (`supabase/.temp/gotrue-version`), whose `internal/api/verify.go` `recoverVerify`
   runs `user.Recover(tx)` and then, `if !user.IsConfirmed()`, logs `UserSignedUpAction` and calls
   `user.Confirm(tx)`. Completing a password recovery therefore **confirms an unconfirmed address**, so
   one mailbox action on a reset link for that identity both sets a usable password and closes the
   confirmation — no management credential is needed. The link is time-boxed: `2026-10-14T15:07:03Z`
   was the first request, it lapsed unused, and re-requesting costs one command. Measured on
   2026-10-15 the probe answered `RECOVER … HTTP 200` for QA-B at `05:28:50Z`, `06:10:27Z` and
   `06:11:30Z` and for QA-A at `05:29:37Z` and `06:10:33Z`, and the credential-bearing probe still read
   `GRANT … HTTP 400 … confirmation is still required` at `06:09:47Z` — so the token was in the mailbox
   and unused, not lost. That corrects an earlier claim on this very gate, which held that this
   identity required an admin `deleteUser` because a first signup attempt was misread: the script looked
   for `json.user` while GoTrue returns the user at the top level when confirmation is required, and the
   account existed all along, as the census above shows. It also corrects gate 3's flag reasoning,
   because the recovery **completion** route is not flag-gated at all (see gate 3).
   **The completion check became an instrument, and was measured on production 2026-10-15:**
   `--verify-recovery` signs in twice and reports the pair of outcomes, so the claim rests on what the
   two credentials do rather than on an accepted request. Run against `ugzdqcytouwfdlcjujqv` at
   `06:17:46Z` it read QA-B as `OLDPW … HTTP 400 — the pre-recovery password no longer signs in` plus
   `PROBLEM NEWPW … HTTP 400 ("Invalid login credentials"), so the delivered link has not been used`,
   and at `06:17:54Z` it read QA-A as `PROBLEM OLDPW … HTTP 200 — the pre-recovery password still signs
   in, so the reset was never completed` (exit code 1). That is the accurate pre-state, not a green
   gate: no reset has completed on either identity, QA-A's existing sign-in still works, and the
   recovery password is refused everywhere. Four contract cases pin both refusal paths, the accepted
   pair, and the skip when an identity holds no recovery password — `21 passed (21)` for this file.
   **The refusal text cannot close this half, so the census now reads the catalog (measured
   2026-10-15):** that same `HTTP 400` answers `"Invalid login credentials"` for an address that was
   never confirmed *and* for a confirmed account whose password was just changed, so QA-B's refusal
   could not distinguish "the link is unused" from "the link worked and this probe typed the old
   password". `scripts/hosted-db-census.mjs --owner <account>` now answers it out of `auth.users`:
   `READ account-state` returns the confirmation state plus `recovery_sent_at`, `last_sign_in_at` and
   `updated_at`, and it is offered **only when an account is named**, so a census naming nobody prints
   no account's state. The first shape of this read asked for `password_changed_at` and production
   refused it (`column u.password_changed_at does not exist`), so the four columns it names now are the
   ones this catalog actually holds, chosen after listing all 35. At `07:04:32Z` QA-B read
   `email_confirmed false` / `email_confirmed_at NULL` / `last_sign_in_at NULL` /
   `recovery_sent_at 06:11:32Z` / `updated_at 06:11:35Z` — an unspent link, read rather than inferred.
   At `07:05:02Z` QA-A read confirmed at `2026-10-14T07:46:57.528688Z` with `last_sign_in_at
   06:29:20Z`, and **that timestamp is the verifier's own old-password probe signing in, not a reset** —
   which is the honest limit of this read: `last_sign_in_at` stops proving "nobody has used this
   account" the moment the operator instrument authenticates successfully, and is also why the unscoped
   census moved `sessions` 17 → 21 across 2026-10-15 while no customer did anything. Seventeen census
   contract cases, and the unit suite at this head is `47 files / 678 tests`.
   **That "completion is not flag-gated" claim is now measured on the deployed build and pinned in CI
   (2026-10-15).** Loading `https://dueweave.pages.dev/auth/update-password` with no session — the flags-off
   `505ff51` artifact, credential-free — renders `ACCOUNT RECOVERY` / "This recovery link is not active.",
   zero `input[type=password]` and no "Save new password" control, with the flags-off status line
   "Password recovery emails are temporarily unavailable. No reset request can be sent right now." and a
   working "Back to sign in". So the paused build refuses an *undelivered* request while keeping the route
   that consumes a delivered link; a link mailed before the flags flip therefore stays completable, and the
   flag flip is not a precondition for this gate's remaining half. `tests/auth-email-readiness.contract.test.ts`
   gained three cases that hold that ordering open at every head: the email flag may guard exactly one
   submit — `mode === "forgot"` — the update submit dispatches to `updatePassword(password)` rather than to
   a flag test, and the guard scan is proven not blind by feeding it a source where `mode === "update"` *is*
   gated. Verified rather than asserted: run against the real file the scan returns `["forgot"]`, and against
   the same file with an update-mode guard injected it returns `["forgot","update"]`, which is the shape the
   pin refuses. The file goes `15 → 18` cases and the unit suite `49 files / 722 tests`, `lint` exit 0,
   `tsc` exit 0, `verify:secrets` `Scanned 297 files for 11 credential shapes` clean.
   **D-Rec-1 found and repaired 2026-10-20 (CL-7 item 10): the screen a lapsed recovery link lands on
   explained the rule and not the situation.** Read on production on 2026-10-19 (`tmp/cl5-qa/LEDGER.md`):
   `/auth/v1/verify` answers **303 with an empty fragment for a valid recovery link and for a spent or
   expired one alike** — `hashLength=0 query=[]` in both cases — so unlike a confirmation link, which was
   measured arriving with `error_code=otp_expired|validation_failed`, a recovery arrival carries no reason
   in its address at all. That makes the "This recovery link is not active." panel the only place the
   customer can be told anything, and its body named only a security rule ("For your security, a new
   password can only be set from the private link DueWeave emails you…"), leaving an expired link
   indistinguishable from a broken one and the next step unwritten. `client/src/pages/Auth.tsx:227` now
   states both causes the application can honestly name — used once, or expired while unread — and the
   remedy, "Ask for a fresh link below, then open it in this browser", which the button beneath it
   performs when recovery is enabled. Two proofs, watched RED before they were GREEN: a source contract
   (`tests/security-contract.test.ts`) asserts on the panel's own block rather than the whole file, so a
   reason parked in a comment elsewhere cannot satisfy it, and it matches word stems (`been used`,
   `expired|lapsed`) rather than a fixed sentence so the wording can improve without a test edit; and
   `e2e/stage6-local-auth-ux.spec.ts` asserts the rendered paragraph in Chromium, which CI's
   `Complete customer-browser regression` job executes at every head against the flags-on local stack —
   the reason no shared local stack was started for this repair. Red proved by reverting only the copy:
   `× … explains to a customer whose recovery link did not work both why and what to do next → expected
   'outcome === "no-recovery-session" && …' to match /been used/i`, `1 failed | 27 passed`, then
   `28 passed`, and the full unit battery `53 files / 790 tests`, `tsc` exit 0, `lint` exit 0,
   `vite build` exit 0, `verify:hygiene` 0 untracked, `verify:secrets` 309 files clean.
   **What this does not claim:** it cannot tell a customer which of the two causes applied to their own
   link, because the arrival carries no reason; and with `VITE_AUTH_EMAIL_ENABLED` false in the served
   bundle the fresh-link button is still replaced by "Password recovery emails are temporarily
   unavailable.", so the explanation is reachable but the remedy it points to is only delivered once the
   owner opens the flag — the same flag dependency gate 1 already records.
2. **Auth URL configuration:** Re-read hosted Site URL, exact redirect allow-list, signup
   confirmation settings, SMTP identity and rate limits. Historical production measurement had
   Site URL `http://localhost:3000` and password minimum 6; set Site URL to
   `https://dueweave.pages.dev`, allow exactly required HTTPS recovery redirects, set
   hosted password minimum to 8, then independently re-measure and test.
   **Amended 2026-10-14:** the three writes named here have landed, and were re-measured by their
   consequences rather than accepted on report. The confirmation link that arrived pointed at
   `https://dueweave.pages.dev/auth` and the sign-in it enabled succeeded on that origin — which is
   what a correct Site URL and redirect allow-list must produce — and the hosted Auth API refused a
   seven-character password change while the eight-character replacement was accepted and used for a
   fresh sign-in. A *configuration read* of these values still needs the management credential, since
   `GET /auth/v1/settings` exposes neither `site_url`, `additional_redirect_urls` nor
   `password_min_length`, and rate limits were not read at all.
   **Further amended 2026-10-14, because the behavioural substitute for that read failed its own
   control:** `POST /auth/v1/recover?redirect_to=…` on this project answers **HTTP 200 for a
   destination it was never configured to allow** — a probe carrying
   `redirect_to=https://redirect-control-not-configured.example/auth/update-password` for an address
   that exists was accepted exactly as the production destination was, and the same endpoint answers
   `HTTP 429` inside roughly a minute of a prior request, which is a rate window and not a refusal.
   Two consequences, both stated rather than smoothed over: a 200 from the recovery probe certifies
   nothing about the allow-list, so the only proof of a reset link's destination is the delivered
   message read in the mailbox; and whether an arbitrary `redirect_to` is honoured in the emailed link
   or silently replaced by the Site URL was left as **an open hosted-configuration question** that no
   credential-free probe can settle.
   **Closed 2026-10-14 by the mailbox read, not by a status code:** the two reset messages that
   actually arrived were opened in the connected DueWeave Gmail mailbox (`dueweave@gmail.com`, which
   also receives the QA identities' plus-addressed mail). The attribution that matters here is who read
   them: the mailbox is connected to the owner's assistant, so the link bodies were **read from the
   delivered mail by the owner**, and this repository has no credential that can open that mailbox — the
   record therefore cites delivered artefacts, not an operator's recollection of them, and nothing about
   the destination is inferred from an HTTP status. The request carrying the approved destination
   produced a reset link pointing at `https://dueweave.pages.dev/auth/update-password`; the control
   request carrying `redirect_to=https://redirect-control-not-configured.example/…` produced a link
   pointing instead at the configured Site URL, `https://dueweave.pages.dev`. The
   unauthorised destination is therefore **replaced, not honoured**, so the phishing shape the open
   question worried about does not exist on this project, and the `Redirect URLs` dashboard read is no
   longer needed to settle it. What still stands from the original probe is the reason the mailbox was
   needed at all: `/recover` answers `HTTP 200` to either request and `HTTP 429` inside its rate
   window, so no response from that endpoint is allow-list evidence.
3. **Live signed-in customer acceptance:** Use disposable verified QA users in a real production
   browser. Test onboarding; client/receivable create/edit; partial payments; promise creation,
   withdrawal and timeline; follow-up drafts and manual WhatsApp handoff; snooze; free-tier cap;
   search, dark mode, export/download, signout, account erasure, and cross-account refusal.
   Assert before/after DB rows and remove every QA user/artifact. No customer funds.
   **Amended 2026-10-14:** one identity is done and read back — see the free-tier journey row above,
   executed signed-in on `https://dueweave.pages.dev` with every step counted in `ugzdqcytouwfdlcjujqv`
   — and the rest of this gate is **ordered behind the owner's flag decision, not in front of it.**
   A second disposable identity cannot be created through the deployed product while
   `VITE_PUBLIC_SIGNUP_ENABLED` is false in the served bundle, password-recovery delivery cannot be
   observed while `VITE_AUTH_EMAIL_ENABLED` is false in it, and account erasure then needs a confirmed
   second session to be worth anything as an isolation test. Both flags are proved false *in the served
   bytes* by the exact-head parity row above, so the remaining sub-items of gates 1, 3 and 4 all unblock
   from one owner action — open the two flags and let Pages rebuild — and none of them can be reached by
   more engineering on this side.
   **Corrected 2026-10-14: that paragraph overstated the flag dependency in two places, and the
   correction widens what this side can finish before any flag moves.**
   - A second disposable identity does not need the product's form. `GET /auth/v1/settings` read off
     the served bundle reports `disable_signup=false` and `mailer_autoconfirm=false` on this project,
     so the legitimate public signup API is open at the backend, and asking it is the same code path a
     customer's browser uses. An identity created that way with confirmation required answers with a
     user object and **no session**, which is the confirmation-required behaviour this gate wants
     proved; the census then counts the account rather than trusting the response.
   - Recovery is not blocked by `VITE_AUTH_EMAIL_ENABLED`. The flag gates the two **request** entry
     points only — `client/src/pages/Auth.tsx:141-144` refuses the forgot-password mode and `:228`
     replaces its retry button with a note, and `client/src/pages/Home.tsx:279,388` refuses the
     settings-screen action. The **completion** route reads its mode from the address
     (`client/src/pages/Auth.tsx:38`, `location.includes("update-password")`) and shows the password
     form to any browser holding a recovery session, with no flag consulted. So a reset link requested
     by the operator instrument (`scripts/hosted-auth-status.mjs --request-recovery`) can be opened and
     used on the bundle production serves today, and the new-works/old-fails pair is measurable.
   - **That route is on the artifact production serves — measured in a browser, not argued from the
     source.** At `2026-10-15T06:26Z` real Chromium navigated to
     `https://dueweave.pages.dev/auth/update-password` holding no credential and no session. It is
     neither a 404 nor a redirect: the accessibility tree carries `ACCOUNT RECOVERY` and the heading
     "This recovery link is not active." with no password field, and the note inside it — "Password
     recovery emails are temporarily unavailable. No reset request can be sent right now." — is
     `VITE_AUTH_EMAIL_ENABLED` being false reaching the page. So the seam that decides whether a reset
     can be completed is the browser holding a recovery session, not the flag, and the mailbox link has
     a landing place on the released SHA.
   - What the flag genuinely still gates is self-service: a locked-out customer asking for their own
     reset link from the deployed UI, and a new customer creating an account from that UI. Those two
     journeys cannot be walked before the owner opens the flags, and the flag-flip row below stays the
     place where they get proved on the released SHA.
   - **The second identity exists, and it was created the legitimate way.** QA-B was made by
     `POST /auth/v1/signup` against the production host — the census `newest_user` timestamp reads
     `2026-10-14 14:08:50.277677 +0000 UTC` — with confirmation required, so the answer carried a user
     object and **no session**. No flag was flipped and no admin insert was used. Read back from
     `ugzdqcytouwfdlcjujqv` at `2026-10-15T09:49Z`: `accounts=2 confirmed=1 unconfirmed=1`, and for QA-B
     specifically `email_confirmed=false`, `email_confirmed_at=NULL`, `last_sign_in_at=NULL`,
     `recovery_sent_at=2026-10-15 09:09:58.927234 +0000 UTC`, owning `profiles=1` and `entitlements=1` and
     **zero rows in every ledger table**. It therefore cannot sign in, which is why gates 1, 3 and 4 still
     queue behind one landing confirmation. The same read preserves the standing debt rather than touching
     it: `auth.identities` 4 with 2 naming no account, `auth.sessions` 23 with 11 orphaned,
     `auth.refresh_tokens` 24 with 11 orphaned — the October 5 records are counted, not cleaned, until
     separately authorised — and the migration ledger answers 25 recorded with newest version
     `20261006120000`. The recovery pair requested at `09:10:01Z` was still unopened in the controlled
     browser at `09:49Z`, so its completion half is an owner action, not an engineering gap. That pair
     lapsed unopened, so a fresh one was requested at `10:06:08Z` and `10:06:14Z`; re-reading QA-B at
     `10:22Z` answers the same state — the instrument's password grant returns `HTTP 400 — sign-in refused
     ("Invalid login credentials")`, and the controlled browser is still on `/auth` with a zero-length
     hash — and the standing census is unchanged: the October 5 orphaned `auth.identities`, `sessions` and
     `refresh_tokens` rows are still counted, not cleaned, and QA-B still owns zero ledger rows. Both
     instruments ran credential-free and printed no secret. A re-run of `scripts/hosted-db-census.mjs` at
     `10:41Z` answers `DONE 8/8 reads answered` with `users_total=2 confirmed=1 unconfirmed=1`,
     `identities=4` of which 2 name no account, `sessions=24` with 11 orphaned and `refresh_tokens=25` with
     11 orphaned, and `one_time_tokens=3` with 0 orphans. The point this read carries for the gate is that
     the **orphan** counts are identical to the `09:49Z` read (2 / 11 / 11), so neither recovery request,
     nor any instrument run since, has touched the October 5 residue; the two totals did move up by one
     row each against that read, which is consistent with a live session being rotated rather than a new
     identity appearing — no third `users_total` row exists and `newest_user` is still
     `2026-10-14 14:08:50.277677 +0000 UTC` — but whose session it is was not measured and is not claimed.
     The migration ledger still answers 25 recorded, newest `20261006120000`.
   **The isolation instrument was audited for the same fail-open class, and one hole was found and closed
   (2026-10-15).** `scripts/hosted-tenant-isolation.mjs` is the command that will answer cross-tenant
   isolation on production, and its own header states the rule that makes a write refusal provable: *a
   refused write is proved by the owner reading the row back, never by the attacker's reply*, because
   PostgREST answers a write that matched no visible row with an empty representation. The `PATCH` and
   `DELETE` probes followed that rule; the eleven RPC attacks did not — they were judged by the attacker's
   reply alone. A function declared to return nothing answers `204` with an empty body whether it refused
   the target or moved it, and the four mutate-in-place attacks (`cancel_receivable`, `snooze_receivable`,
   `update_receivable_details`, `update_client`, `cancel_promise`) change no row **count**, so the recount
   that guards the victim's ledger at the end of the run is blind to them as well. A deployment whose
   policy had actually broken would therefore have been reported as `REFUSED` on those five probes and a
   clean gate. Each targeted attack now reads its own target back as the owner before and after, and any
   moved column — or a target that no longer reads back — is a finding naming that probe; an owner who
   cannot read its own sacrificial row fails the run instead of clearing it. Observed RED first with the
   stand-in policy that applies the write and answers 204 (`1 failed | 10 passed`: `the instrument never
   read an RPC attack's target back as its owner`), then `11 passed (11)`; neutering the column comparison
   fails exactly 1 case, so the finding is earned by the read-back and not by the request count. Insert-
   shaped attacks stay covered by the ledger recount rather than a second rule. **This repair changes what
   the instrument is willing to call a refusal; it does not make the production run any less open** — that
   still needs a second confirmed session. Local gates with this repair in the tree: unit `49 files / 719
   tests`, `lint` exit 0, `tsc` exit 0, `verify:secrets` `Scanned 297 files for 11 credential shapes` clean.
   **One CI gate went red at `55b97d4`, and the diagnosis named the test, not the product (2026-10-15).**
   Attempt 1 of that head: `CI` `38715383443`, `Live production public smoke` `38715383281` and `CodeQL`
   `38715383215` all success; `Complete customer-browser regression` `38715383273` failed in job
   `116356674406`
   (`all-customer-journeys`) at `Running 193 tests using 1 worker` → `1 failed / 8 skipped / 2 did not run
   / 182 passed (17.9m)`. The failed test is `[chromium] › e2e/stage6-local-forms.spec.ts:270:3 › takes a
   busy submit out of the keyboard order while the write is in flight`, and `git diff --name-only a651f2e
   55b97d4` answers exactly two files — `scripts/hosted-account-erasure.mjs` and
   `tests/hosted-account-erasure.contract.test.ts` — neither of them a Playwright input, while the same
   slot printed `✓ 80 … stage6-local-forms.spec.ts:270:3` (2.4s, 2.0s) on each of the two preceding heads
   (`38706290724` at `ca4d78d`, `38710064339` at `a651f2e`). The job log then states the mechanism in the
   test's own words: `Expected substring: "Close"`, `Received string: "input input input input UPIBank
   transferCashOther input input input input UPIBank transferCashOther input Cancel"` — twelve stops that
   ran out at `Cancel`, with the payment-method group surfacing once per pass carrying its container's
   concatenated text instead of four labelled inputs, so the walk never reached the control it asserted
   on. Nothing left the sheet (`every(inSheet)` was true for all twelve) and the busy submit was correctly
   absent from every stop, so the defect is a walk shorter than the cycle it was measuring rather than a
   focus escape. The repair gives the busy walk the same 16 stops that the idle walk on *that same sheet*
   proves in *that same run* — slot 79 `holds the keyboard contract for Record payment` passed at 1.5s
   with `toContain("Close")` and `every(inSheet)` both asserted at 16 — and keeps the escape assertion over
   every stop, so a focus escape that really happens still fails here at any length. **This spec cannot be
   replayed on this machine:** `C:` was 100% full (212 MB free at diagnosis, 206 MB at 10:16Z) so the local
   Supabase stack would not start, and the WSL root carries no `docker`, so CI is the verifier for the walk
   length — which is why 16 was taken from a pass CI had already produced against the same sheet instead of
   a longer, unmeasured guess. **The repair head `5bd3064` answers that verification.** All four workflows
   succeeded at attempt 1 — `CodeQL security review` `38719471329`, `Live production public smoke`
   `38719471498`, `CI` `38719471330` and `Complete customer-browser regression` `38719471491` — and that
   regression job (`116370185775`) reports `Running 193 tests using 1 worker` → `8 skipped / 185 passed
   (18.5m)` with no `failed` line and nothing left unrun, printing
   `✓ 79 … stage6-local-forms.spec.ts:237:3 › holds the keyboard contract for Record payment (1.6s)` and
   `✓ 80 … stage6-local-forms.spec.ts:270:3 › takes a busy submit out of the keyboard order while the write
   is in flight (2.0s)`. The sweep for the same shape found no other fixed-length walk: the two `tabWalk`
   callers are both in that file, and the fourteen other Tab-driven sites in `e2e/` either walk until the
   control is found, walk until the cycle repeats, or judge per-stop properties rather than a named control.
   `C:` later freed to 5.6 GB (99% used, 10:45Z), but the local stack was deliberately not started for a
   replay: this machine's Docker host is shared with the CI's Supabase project, and the green CI verdict at
   the exact head is the stronger evidence.
   **QA-B's recovery was completed on the deployed site, which is what this gate queued behind
   (2026-10-16).** The link was consumed once in the controlled browser and the new password set from the
   locally stored `recoveryNewPassword`; `pnpm verify:hosted:auth` at `10:02Z`
   (`prod-census/qab-recovery-proof-1002.log`) answers the pair this gate asks for — `OLDPW
   dueweave+releaseqa-b-20261014@gmail.com HTTP 400 — the pre-recovery password no longer signs in` and
   `NEWPW … HTTP 200 — the recovery password signs in, so the reset landed and the address is confirmed` —
   beside `disable_signup=false mailer_autoconfirm=false external.email=true` and the same
   `delete-account` preflight/`401` pair. New-works / old-fails is the proof the rotation took effect
   rather than that a grant succeeded; QA-A was left unchanged and no run printed a password, token or link.
   **Production isolation was then executed, and four runs were needed before its refusals meant what
   they claimed (2026-10-16).** Each run was redirected to an operator-side log under `prod-census/`
   (`*.log` is gitignored, so those files live on this laptop and are quoted rather than committed); every
   credential was read from the served bundle or the local identity files and none was printed.
   *Run 1* (`isolation-1006.log`) declined 36 and printed **4 findings**, and each one was a defect in the
   instrument rather than a boundary that broke: `update_receivable_details … never reached a row-security
   policy: HTTP 404 PGRST202 Could not find the function public.update_receivable_details(p_amount_due_paise,
   p_due_date, p_invoice_ref, p_label, p_notes, p_receivable_id)` — the attack named six arguments while the
   deployed function declares five (`20261004170000_current_arc2_ledger_required_blank_class.sql:148`), so
   PostgREST answered from the schema cache and no policy ran; `get_founder_offer as a customer: the Founder
   payment gate opened` — the judgement read *answered at all* as the gate, while that projection is granted
   to `authenticated` by design and the purchase page calls it, so the gate is
   `founder_offer_payment_ready()` (`20260928090000_current_stage8_readiness_parity.sql:175`) and the offer's
   own status fields decide it; `forged bearer read clients … HTTP 401 PGRST301 Expected 3 parts in JWT; got
   1` — a one-part string only proves PostgREST counts dots, so the probe now sends a structurally valid JWS
   claiming the victim's `sub`, and a gateway refusal of it is reported as the authentication refusal it is,
   never as evidence about a row policy; and `the victim's real ledger moved during the probes: activities 5
   -> 6` — creating the sacrificial receivable and promise writes the victim's own activity rows
   (`20261004170000…:142`, `20260815100000…:547`), so the protected window now starts after setup rather than
   before it.
   *Run 2* (`isolation-1018.log`) declined 42 with **1 finding**: `SETUP the victim could not create a
   sacrificial promise (HTTP 400 P0001)`. Read off the deployed body rather than guessed, the cause was two
   rules `create_promise` enforces *before* its owner-scoped guard — `p_source` in
   `('WHATSAPP','CALL','EMAIL','MEETING','OTHER')` (`20260815100000…:446`) and `p_made_on` no later than
   `public.current_business_date()` (`:469`, which is `timezone('Asia/Kolkata', now())::date` per
   `20260815090000…:67`) — and both answer the same `HTTP 400 P0001` as the guard at `:477`. The payload
   carried `p_source: "verbal"` and `p_made_on: "2099-12-01"`, so the promise row never existed, the
   `cancel_promise` attack silently left the run, and the 42 green lines said nothing about it. Repaired
   test-first: the contract stand-in now models each pre-guard rule of both money functions, four cases were
   watched to fail on exactly that shape, the payloads were corrected, and every refusal the report prints
   now carries the message the function raised — `REFUSED create_promise on the victim's receivable HTTP 400
   P0001 — "Receivable is not available for this account"` — so a payload complaint can never again be filed
   as a boundary refusal. The payment attack was dated the same way and the reason differs: `record_payment`'s
   own future-date rule runs at `:610`, *after* the guard at `:583`, so its earlier payload did reach the
   boundary; measured, not assumed.
   *Run 3* (`isolation-1041.log`) declined **0** and found `SETUP the victim could not create a sacrificial
   receivable (HTTP 400 P0001)`. A read-only census answered why: the account held 4 clients (1 real, 3
   probe) and 3 active receivables, so `enforce_free_receivable_limit`
   (`20260812150500_secure_foundation.sql:238-263`, trigger `receivables_free_limit` at `:348`) raised
   `Free plan allows up to 3 active receivables`. That is the instrument refusing itself: every run minted a
   fresh sacrificial client and receivable, and its own residue ate the free tier's headroom, so a gate that
   only closes twice is not a gate. Setup now reads the victim's own rows first and reuses what already
   carries `PROBE_NAME` — an unarchived client, an `OPEN`/`PARTIALLY_PAID` receivable under it, an `ACTIVE`
   promise on that receivable — creating only what is missing and saying which in the report.
   *Run 4* (`isolation-1057.log`) is the clean gate: `SETUP reused client 890fbe14-44b2-4c03-8df2-5ced84cd0051,
   reused receivable 06f7fa0c-c578-42f8-9a68-697c93021b4f, created promise 5875a12f-3726-4736-a03d-c4decd692f72`
   → **`DONE 47 probe(s) declined as expected, 0 finding(s)`**, with `OWN … ledger reads identical after
   every probe, sacrificial rows included`. What that run shows about `ugzdqcytouwfdlcjujqv` today: the
   attacker read none of the victim's 4 clients, 3 receivables, 1 promise, 1 payment and 7 activity rows and
   listed 0 of them; `profiles` and `entitlements` returned nothing for the victim's user id;
   `founder_admins` answered `403 42501`; the cross-tenant `PATCH`, `DELETE` and the insert with a spoofed
   `owner_id` each answered `403 42501` **and** the owner read its row back unchanged; all eight RPC attacks
   were refused by the ownership guard's own words (`"Receivable is not available for this account"`,
   `"Receivable is not available to snooze"`, `"That receivable is not available in this private ledger"` at
   `500 P0002`, `"That client is not available in this private ledger"` at `500 P0002`, `"Client is not
   available for this account"`, `"Promise is not available for this account"`); the Founder projection read
   `CLOSED … held shut by payment_destination_status=PLACEHOLDER, support_contact_status=PENDING,
   refund_policy_status=PENDING_APPROVAL, disclosures_status=PENDING` and both Founder review RPCs refused
   the customer session; every anonymous read answered `401`/`400` with nothing exposed, and the forged
   bearer was declined at the token check. **Local gates carried with this repair:** unit `49 files / 731
   tests` (this file `18 passed (18)`, the re-runnability case seen RED first as `a re-run was stopped by the
   plan's cap instead of a policy`), `lint` exit 0, `tsc --noEmit` exit 0, `verify:secrets` `Scanned 297
   files for 11 credential shapes` clean. **Its limits, stated:** it is a laptop-and-operator command, never
   a CI step, because it writes sacrificial rows to production; it judges one tenant pair on the free tier,
   and the reused probe rows persist until the QA erasure removes them.
4. **Account-deletion runtime:** Redeploy the updated `delete-account` source after exact-head
   gates. Test browser CORS preflight (including `apikey` and `x-client-info`) and the complete
   Auth-account removal, not just a transaction-scoped SQL simulation.
   *Measured 2026-10-12, no credential used:* the function is deployed and answers from
   `ap-south-1`; preflight from `https://dueweave.pages.dev` returns `204` with that exact origin and
   `authorization, apikey, x-client-info, content-type, x-retry-count, traceparent, tracestate,
   baggage` allowed, a foreign origin returns `403` with no allow-origin, a non-JWT bearer returns
   `401 UNAUTHORIZED_INVALID_JWT_FORMAT` and a missing bearer returns the function's own
   `401 Sign in before deleting your account.` The preflight half of this gate is therefore measured;
   the complete Auth-account removal for one real signed-in customer, with its before/after row
   census, **was still open at that head and is closed below**. That removal is **not** missing a mechanism: CI already runs it on the local
   stack — `e2e/stage9-release-journey.spec.ts:505` deletes through the served function and proves the
   old credentials are then refused (slot 80 of `Running 80 tests`, run `38253358122`) — so what this
   gate lacks is the identical run against `ugzdqcytouwfdlcjujqv`, which needs a confirmed hosted
   session. **Attribution:** the preflight pair was not discovered by that pass — it has
   been asserted on production by `e2e-live/public-release.spec.ts:50` in the
   `Live production public smoke` workflow on every push since the release line began; what that pass
   added is the `POST`-level refusal ladder (`401` malformed bearer, `401` missing bearer, `400` wrong
   body) **measured on the production host** — the same shapes are already asserted against the locally
   served function by `tests/arc3c-local-account-erasure.test.ts:351-410` in CI, and no spec ever
   `POST`s to `ugzdqcytouwfdlcjujqv`. See `docs/CONSUMER_LIVE_PROGRESS.md` row 8, including its own
   correction paragraph.
   **Instrumented, executed on its safe halves, and repaired before it was trusted (2026-10-15).**
   `scripts/hosted-account-erasure.mjs` (`pnpm verify:hosted:erasure`, delivered at `a651f2e`) is the
   operator command that walks this gate end to end in one run: it signs in with an identity file, reads
   the five census labels, calls `functions/v1/delete-account` with the caller's own bearer and the exact
   confirmation phrase, reads the census again, re-tries the credential, and only then judges the deletion
   — a surviving account row, a row still owned by the erased uuid, an auth-schema row still naming it, an
   account count that moved by anything but one, an October 5 orphan that moved, or a ledger table that
   shed more rows than the account owned are each a finding, and any finding exits 1. It is named by no CI
   job and by no release gate, because it deletes an account.
   Two credential-free halves have been executed against `ugzdqcytouwfdlcjujqv`. At `09:16Z` the refusal
   path ran on the real QA-B identity file: it printed the plan and `REFUSED … was not erased. Deletion
   cannot be undone, so pass --confirm-erase when you mean it.` and exited 1 with zero credential bytes in
   its log. At `09:17Z` the census half answered all five labels as JSON through the session pooler
   (`auth-users 1 row, auth-residue 12, ledger-census 13, account-state 1, owner-census 12`), so the
   numbers the proof is computed from are read, not eyeballed.
   **A review of that instrument found four fail-open judgement holes, and each was repaired under a test
   that was seen to fail first** (`10d9395`, `55b97d4`). Every rule iterates the rows a read *returned*, so
   a read that failed did not fail the run — it deleted the rule that would have needed it. Concretely: the
   before census checked only 2 of the 5 labels and erased on the other 3; the after census read a missing
   label as "no rows left", which is the exact opposite of a finding; the auth schema carried
   `total`/`orphaned`/`forOwner` per table but used none of them, so an auth purge wider than the account
   was invisible while the public tables had that rule; and the uuid came from the token while the account
   was *chosen* by the identity file, so pointing at the wrong file produced a clean-looking delta. Six new
   cases were observed RED (`6 failed | 22 passed`) before the guards existed, then `28 passed (28)`.
   Mutation-verified rather than asserted: deleting the absence record from the snapshot fails 5 cases,
   neutering the auth collateral rule fails 1, neutering the identity-file guard fails 1. Local gates at
   `55b97d4`: unit `49 files / 718 tests`, `lint` exit 0, `tsc` exit 0, `verify:secrets` `Scanned 297
   files for 11 credential shapes` clean. **The signed-in half was open at that head** — it needed a
   confirmed QA session, because erasing an account that never completed confirmation proves a state no
   customer is ever in. It has since been executed; see the run below. Neither repair head reaches the customer
   bundle: `git diff --name-only 505ff51..HEAD` matches zero files under `client/`, `vite.config.ts`,
   `index.html`, `.env*` or `wrangler*`, and the served entry is still `assets/index-Bv2LIPpN.js`, so
   production is running the same flags-off `505ff51` artifact this record has been describing. Re-measured
   at the repair tip `5bd3064` (10:20Z): the same command exits 0 with all 20 built files `SAME` and both
   configuration effects honoured (`_headers` 80 live declarations, `_redirects` `/parity-probe` HTTP 200),
   so the exact-head parity claim moved forward with the branch instead of being inherited from `505ff51`.
   **Executed against `ugzdqcytouwfdlcjujqv` on 2026-10-16: one real, confirmed, signed-in customer was
   erased on production and the census proves it.** The account was created through the public signup API
   and confirmed through a real mailbox (gate 1 and 2), so the state erased is the state a customer is
   actually in. Every line below is quoted from the log named in front of it.
   *`11:15Z`, first attempt — the platform 503, and the instrument refusing to call it a deletion*
   (`prod-census/erasure-b-1115.log`, exit 1): `BEFORE accounts=2 confirmed=2 unconfirmed=0 own-rows
   entitlements=1 profiles=1 · auth-own identities=1 refresh_tokens=9 sessions=9`, then
   `FUNCTION delete-account HTTP 503 status=unreadable message="Service is temporarily unavailable"`.
   The after census read `accounts=2 confirmed=2 … entitlements=1 profiles=1 … identities=1
   refresh_tokens=9 sessions=9` — byte-identical to before — and `GRANT the erased credential answered
   HTTP 200 — it still signs in`, giving
   `DONE erasure NOT proven — 12 finding(s) against the census taken before it`. This is the behaviour the
   four fail-open repairs above were made for: an unreadable reply produced findings rather than a clean
   delta, and the run refused to licence a second deletion off a first one it could not see. The 503 was
   then *classified* rather than retried blindly into an irreversible action: `supabase/functions/delete-account/index.ts`
   emits `204/400/401/403/405/500/501/200` and has no 503 path at all, so the code cannot have produced it
   and it is platform-level. The differential was measured twice — at `11:18Z` before the retry, and
   re-measured reproducibly at `11:34:26Z` (`prod-census/function-surface-1134.log`) with a live session:
   wrong phrase `HTTP 400 in 440 ms` carrying the function's own `"Type the confirmation phrase exactly as
   it is shown."`, empty body `HTTP 400 in 199 ms` with `"The deletion request must carry only a
   confirmation."`, `GET` `405`, no bearer `401`, `OPTIONS` `204` with
   `access-control-allow-origin=https://dueweave.pages.dev`, and a non-existent function path `404
   NOT_FOUND`. The deployed code answers its own pre-purge path in under half a second, so the retry was
   aimed at a cold start, not at a defect — and no source change was warranted.
   *`11:20Z`, the run that closed the gate* (`prod-census/erasure-b-1120-retry.log`,
   exit 0):
   `BEFORE accounts=2 confirmed=2 unconfirmed=0 own-rows entitlements=1 profiles=1 · auth-own identities=1
   refresh_tokens=12 sessions=12` → `FUNCTION delete-account HTTP 200 status=deleted` →
   `AFTER accounts=1 confirmed=1 unconfirmed=0 own-rows none · auth-own none` →
   `GRANT the erased credential answered HTTP 400 — it no longer signs in` →
   `DONE erasure proven: the account, its records and its auth rows are gone, every other count unmoved,
   and the credential no longer signs in`. The auth-owned counts read 9 a minute earlier and 12 here
   because each sign-in mints a session and a refresh token; the rules judge before-against-after *inside*
   one run, which is why they were written that way.
   *`11:21Z`, the same proof from the independent frozen read-only census* (`prod-census/census-b-after-1121.log`,
   `DONE 10/10 reads answered`, taken by `hosted-db-census.mjs` rather than by the erasure instrument, so
   no judgement made by the tool that performed the deletion is the only evidence for it):
   `users_total 1 / confirmed 1 / unconfirmed 0`; `account-state` answers **no row** for the erased uuid;
   `owner-census` is 0 in all twelve public tables; the whole-table ledger reads
   `activities 8, clients 4, receivables 3, promise_events 2, promises 2, payments 1, entitlements 1,
   profiles 1, founder_offer_config 1, analytics_events 0, founder_admins 0, founder_audit_events 0,
   purchase_claims 0` against the `…entitlements 2, profiles 2…` taken before it, so the only two tables
   that moved shed exactly the one row each the erased account owned and **QA-A's ledger is untouched**;
   and the October 5 orphans are preserved — `identities 3` with 2 naming no account (was 4 total / 2
   orphaned), `sessions 34` with 11 orphans (was 42), `refresh_tokens 35` with 11 (was 43),
   `one_time_tokens 1` with 0. `rows_for_owner` is 0 in every auth table, which is the residue half of
   migration 25's contract measured on production rather than asserted from its SQL.
   *The deployed customer UI's deletion path, proved non-destructively on production* (headed Chromium,
   `11:24:35Z`–`11:27:27Z`, `prod-census/ui-erasure-guard-1129.log` — **20 checks, 0 failed**, exit 0,
   screenshot `prod-census/ui-delete-sheet-unlocked.png`). Run as the still-signed-in QA-A against
   `https://dueweave.pages.dev`, i.e. through the served `assets/index-Bv2LIPpN.js` and its lazy
   `assets/Home-BVRrDT29.js`: sign-in reaches the app, `More` offers the destructive row, the sheet opens,
   the archive download is offered inside it, `the scope names the signed-in account —
   dueweave+releaseqa-20261012@gmail.com`, `the destructive button starts disabled`, `lowercase does not
   unlock it`, `a near miss does not unlock it`, `clearing re-locks it`, `the exact phrase unlocks it`,
   `Keep my account closes the sheet`, `no request reached delete-account during the sheet journey —
   calls=0`, `no console errors during the journey`, and the browser's own cross-origin `POST` with a
   wrong phrase is refused by the function with `HTTP 400 "Type the confirmation phrase exactly as it is
   shown."` using the app's own 46-character publishable key and its `x-client-info`.
   Two assertions in the first draft of that driver came back FAIL and **both were the probe's wrong
   assumptions, not product defects** (`prod-census/ui-erasure-guard-1127.log` keeps them as measured):
   it expected page JavaScript to read `Access-Control-Allow-Origin` from the cross-origin reply — the
   Fetch specification never exposes that header to a cross-origin script, so `ACAO as seen by JS=null` is
   the *correct* observation and a readable body is the accepted-origin evidence; and it expected Playwright
   to surface the CORS preflight as a request event, which it does not (`NOTE … the method(s) Playwright
   surfaced on the endpoint: POST`). The preflight proof therefore stays where it is genuinely asserted on
   production — `e2e-live/public-release.spec.ts:50`, run by `Live production public smoke` on every push.
   **What this gate still does not claim, and why:** the destructive submit *clicked through the deployed
   browser UI* against `ugzdqcytouwfdlcjujqv` has not been run. It needs a sacrificial signed-in,
   confirmed account and QA-B was the only one — it was spent on the census-carrying instrument above,
   which judges the removal by the numbers rather than by a screenshot. QA-A is deliberately **not** erased
   yet: CL-6 still needs a signed-in customer, and its 8 activities / 4 clients / 3 receivables / 2 promises
   / 2 promise events / 1 payment are exactly the rows that make the ledger cascade visible in the cleanup
   run that finishes this. Erasing both QA accounts also ends the *repeatability* of the hosted isolation
   gate — `scripts/hosted-tenant-isolation.mjs` needs two signed-in accounts, and re-creating a pair needs
   public signup plus a mailbox confirmation, both still gated closed; the matrix currently standing is the
   one executed at `10:57Z` (`prod-census/isolation-1057.log`, `DONE 47 probe(s) declined as expected, 0
   finding(s)`), taken while both accounts existed. The guard was re-measured on this head at `11:33:34Z`
   (`prod-census/erasure-guard-1133.log`): `REFUSED dueweave+releaseqa-b-20261014@gmail.com was not erased.
   Deletion cannot be undone, so pass --confirm-erase when you mean it.`, exit 1, no credential byte in the
   file. **Local gates carried by this record:** `pnpm test:unit` `49 files / 731 tests passed (731)`
   exit 0 and `pnpm verify:secrets` `Scanned 297 files for 11 credential shapes` clean, run against the
   tree these paragraphs land in (no source file changed for them, which is why they are carried rather
   than re-earned). **CI at the head that carries this record (`666a220`):** all four workflows
   succeeded at attempt 1
   — `CodeQL security review` `38891303235`, `Live production public smoke` `38891303238`, `CI`
   `38891303255`, `Complete customer-browser regression` `38891303263`.
   **CI at the two heads since, each observed at its own exact SHA, all four workflows green at attempt 1:**
   `35e6aa2` — `CI` `38895445876`, `Live production public smoke` `38895445960`, `CodeQL security review`
   `38895445789`, `Complete customer-browser regression` `38895445912`. `1a025bd` (the rate-window copy
   repair) — `CI` `38906225689`, `Live production public smoke` `38906225615`, `CodeQL security review`
   `38906225617`, `Complete customer-browser regression` `38906225607`; measured out of those logs, unit
   `49 files / 737 tests passed (737)` at `13:14:06Z`, database contracts `10 files / 331 tests passed
   (331)`, `Browser release smoke` `81 passed (11.0m)` plus the paused-bundle flag gate `3 passed (5.1s)`
   and console discipline `3 passed (31.1s)`, `live-public` `6 passed (29.8s)`, and the full journey job
   `185 passed (18.4m)`. The local unit gate at this head re-measured the same `49 / 737` before the push,
   so the six added cases are earned here rather than carried, and `pnpm verify:secrets` ran again after the
   last source edit: `Scanned 297 files for 11 credential shapes`, clean. `git ls-remote origin
   refs/heads/release/consumer-live` returned `1a025bdaddac48754240513a6fe5830cc0928261`, equal to local
   `HEAD`. **CI at the record head that followed (`949edca`):** `CI` `38910654288`, `Complete
   customer-browser regression` `38910654292`, `Live production public smoke` `38910655114`, `CodeQL
   security review` `38910654430` — all four `completed success`, with its remote read-back equal to local
   `HEAD` before those ids were taken. Gate 8 now carries what that same afternoon's fetch proved about
   Pages: it builds from each push, and its superseded asset stays addressable, which is a trap for anyone
   reading deployed identity off an asset name.
   **CI at the CL-38 head (`99dce90`), all four workflows `completed / success`:** `CI` `38940510855`,
   `Complete customer-browser regression` `38940510883`, `Live production public smoke` `38940510861`,
   `CodeQL security review` `38940510860`. **CI at the CL-39 head (`2fb74ca`), the four ids taken after
   `git ls-remote origin refs/heads/release/consumer-live` returned that SHA:** `CI` `39013772775`
   (`Static verification` `117341546489`, `Database contracts` `117341546277`, `Browser release smoke`
   `117342266800` — all `completed / success`), `Complete customer-browser regression` `39013772830`
   (job `117341546756`, `completed / success`), `Live production public smoke` `39013772976`, `CodeQL
   security review` `39013772873`. Read out of those four jobs' own logs, at that SHA: static
   `Test Files 50 passed (50)` / `Tests 752 passed (752)` in `Duration 11.74s` and
   `Scanned 301 files for 11 credential shapes`; database contracts
   `Migrations on disk: 26. Applied in the local database: 26.`, pgTAP
   `Files=10, Tests=410 … Result: PASS` including the new
   `supabase/tests/stage4_02_edit_conflict_code.sql ... ok`, and the served-function battery
   `Test Files 10 passed (10)` / `Tests 332 passed (332)` in `Duration 46.42s`; browser smoke
   `Running 81 tests using 1 worker` → `81 passed (11.0m)`, the flags-off bundle gate `3 passed (5.0s)`
   and the console gate `3 passed (31.3s)`, in a job window of `07:32:35Z → 07:47:29Z` (**14 m 54 s** of
   its 45-minute budget) on a GitHub-hosted runner; `live-public` `6 passed (28.3s)`; the full journey job
   `Running 193 tests using 1 worker` → `8 skipped`, `185 passed (18.5m)`. The same job's 81st slot is
   `e2e/stage9-release-journey.spec.ts:505 › account deletion is gated by exact confirmation and removes
   the last QA account (1.2s)`, executed against the `delete-account` function it served
   (`delete-account is served and ALLOWED_APP_ORIGIN reached the runtime (1349 ms …)`).
   What that green did **not** test is the thing CL-39 changed: CI's PostgREST is
   `postgrest:v16.2`, which answers `40001` in 676/752 ms, so the 125 s production hang CL-39 repairs is
   unreachable there; the repair's latency half is proven on production's own build and, from the
   afternoon of 2026-10-17, on this host's `v14.18` **after** the migration landed as well — six stale or
   tokenless edit calls through the local gateway answered `HTTP 400` with `DW001` in 10-20 ms, and the
   fresh-token control edit answered `HTTP 200` in 21 ms and persisted, at 26 migrations (see
   `docs/RELEASE_GATE_MATRIX.md`, note 9 and the row-N bullet). And the 26th migration **is now hosted**:
   the catalog read recorded here had been **25/25**, and on 2026-10-17 this workstream applied it
   forward-only with `supabase db push --skip-vault --yes` over the session pooler (exit `0`, 2,873 ms,
   `--dry-run` having first named only that file), after which the hosted catalog reads **26/26** and the
   stale-edit refusal is reachable on production itself — `scripts/hosted-stale-edit-probe.mjs` answered
   `HTTP 400 DW001` in 40-69 ms for the four rejected attempts that had answered nothing for 30,025 /
   30,004 / 30,013 / 30,002 ms at 25 migrations, while the two authorized fresh edits still answered
   `HTTP 200` (67 / 195 ms) and the account's ledger read the same rows afterwards. So a real customer's
   stale edit on production is now refused in words rather than hanging.
   **CI at the recording head that followed (`6f5e919`), with its four run ids taken after
   `git ls-remote origin refs/heads/release/consumer-live` returned that SHA:** `CI` `39015502946`
   (`Static verification` `117346680766`, `Database contracts` `117346680580`, `Browser release smoke`
   `117347416313`), `Complete customer-browser regression` `39015502960` (job `117346680472`), `Live
   production public smoke` `39015502940`, `CodeQL security review` `39015502956` — all six of its jobs
   `completed / success`, the two long ones closing at `08:15:49Z` and `08:18:15Z`. Read out of those
   jobs' own logs at that SHA: static `Test Files 50 passed (50)` / `Tests 752 passed (752)` in
   `Duration 11.89s` and `Scanned 301 files for 11 credential shapes`; database contracts
   `Migrations on disk: 26. Applied in the local database: 26.`, pgTAP `Files=10, Tests=410 … Result:
   PASS`, served-function battery `Test Files 10 passed (10)` / `Tests 332 passed (332)` in
   `Duration 42.97s`; browser smoke `Running 81 tests using 1 worker` → `81 passed (10.9m)`, the
   flags-off gate `3 passed (4.5s)`, the console gate `3 passed (30.3s)`, serve readiness
   `1149 ms`; `live-public` `6 passed (29.7s)`; the journey job `Running 193 tests using 1 worker` →
   `8 skipped`, `185 passed (18.5m)`. **That `332 passed (332)` is the discriminator for this host's own
   live run at the same head**, which finished `7 failed | 325 passed (332)` with every failure carrying
   a machine signature (`runtime: cannot allocate memory`, `spawnSync docker UNKNOWN`, gateway `502` and
   `503`) while `C:` sat at 100 % used with 150 MB free; the classification and the two cleanups that run
   owed are in `docs/RELEASE_GATE_MATRIX.md` (the live-battery bullet under "What has moved since these
   measurements were taken").
   **CI at the measurement head that followed (`f037521`)**, taken after
   `git ls-remote origin refs/heads/release/consumer-live` returned that SHA: `CI` `39017299816`
   (`Static verification` `117351942238`, `Database contracts` `117351942066`, `Browser release smoke`
   `117352563553`), `Complete customer-browser regression` `39017299831` (job `117351942140`), `Live
   production public smoke` `39017299758`, `CodeQL security review` `39017299918` — all six of its jobs
   `completed / success`, the two long ones closing at `08:44:00Z` and `08:47:17Z`. Read out of those
   jobs' own logs at that SHA: static `Test Files 50 passed (50)` / `Tests 752 passed (752)` in
   `Duration 12.05s` and `Scanned 301 files for 11 credential shapes`; database contracts
   `Migrations on disk: 26. Applied in the local database: 26.`, pgTAP `Files=10, Tests=410 … Result:
   PASS` with `stage4_02_edit_conflict_code.sql ... ok`, served-function battery
   `Test Files 10 passed (10)` / `Tests 332 passed (332)` in `Duration 46.39s`, including
   `✓ tests/stage4-local-edit-workflows.test.ts (14 tests) 569ms` (the three `DW001` refusal
   assertions) and `✓ tests/arc3c-local-account-erasure.test.ts (22 tests) 4505ms` (the erasure
   battery this host could not finish locally); browser smoke serve readiness
   `delete-account is served and ALLOWED_APP_ORIGIN reached the runtime (1686 ms …)`, `Running 81 tests
   using 1 worker` → `81 passed (10.9m)`, the flags-off gate `3 passed (4.7s)`, the console gate
   `3 passed (30.5s)`; `live-public` `6 passed (30.0s)`; the journey job `Running 193 tests using 1
   worker` → `8 skipped`, `185 passed (18.8m)`. **This head is a docs-only commit**, so its green
   repeats `6f5e919`'s CI rather than adding new executable coverage; the CL-39 measurement itself is
   `6f5e919`'s, and production's own hang-to-refusal behaviour was measured after this workstream pushed
   the 26th migration on 2026-10-17 (gate row "A stale edit is refused in words the customer can read").
   **CI at the promotion head `7c33fd15a8525a97c2682b1f82d3447f89c463df`, read from the API after
   `git ls-remote` returned that SHA:** all four push runs `attempt 1 / completed / success` —
   `CI` `39049440581`, `Complete customer-browser regression` `39049440594`,
   `Live production public smoke` `39049440653`, `CodeQL security review` `39049440552`.
   That head carries the committed stale-edit instrument and its contract cases, so the production
   refusal timings quoted above are reproducible by a command in the tree rather than by a driver that
   only existed on this laptop.
5. **Founder monetization:** Production readiness deliberately reports `false`; no actual live
   UPI destination, approved support/refund/disclosures or reviewer allowlist. Do not collect or
   represent real Founder payments as enabled. Finish operator decisions and perform refund/manual
   review tests separately, or explicitly release only the free plan without a purchasable offer.
6. **Customer trust, support and compliance:** Publish an accurate privacy policy, terms,
   data-retention and deletion policy, and real reachable support address. Verify jurisdiction and
   payment disclosures with the business operator; do not invent a support mailbox or payment details.
   **Items 11–12 delivered 2026-10-20 (CL-7 Stage C), and the "real reachable support address"
   half is refused rather than invented.** `client/src/pages/Legal.tsx` (206 lines) publishes
   Privacy (10 sections), Terms of Use (10) and Support (6) at `/privacy`, `/terms` and `/support`,
   routed outside the protected shell at `client/src/App.tsx:107`, so a stranger can read them
   before handing the product a name and a phone number. `client/public/_redirects` — `/* /index.html
   200`, read again today in `dist/_redirects` after the build — is what makes those three addresses
   resolve on Cloudflare Pages instead of 404ing. Both entry points the brief asks for carry the
   links: the sign-in screen itself, above any credential (`client/src/pages/Auth.tsx:267-271`), and
   the signed-in More screen that holds the export and the erasure control
   (`client/src/pages/Home.tsx:388`).
   **Accuracy is enforced, not asserted — that is item 12's real content.**
   `tests/trust-surface.contract.test.ts` (10 cases as delivered, 11 at the head recorded in row 10)
   refuses a document that claims a host the app
   does not use, a deletion that differs from the migration, a retention period nobody measured, or
   a support channel that does not exist: the third-party list must name Supabase, Cloudflare and
   Google Fonts *and* `client/index.html` must really load the font host; the erasure paragraph must
   match what `delete_my_account()` implements, and the test derives the table list from
   `supabase/migrations/20261006120000_current_arc3c_account_erasure_path.sql` rather than from a
   sentence — measured there: 10 owner-scoped `delete from public.…` statements plus
   `analytics_events`; any `30/60/90/180/365-day` or `seven/thirty/ninety days` retention promise
   fails the file, so the page says "We have not published how long a backup is kept" instead
   (`Legal.tsx:111`); `mailto:`, an email-shaped token, `Pvt|LLC|Inc.|GmbH|LLP` and any
   promising-direction guarantee are forbidden, and the file must contain "has not published a
   support email" (`Legal.tsx:178`). Three owner decisions are therefore listed inside the product
   as undecided — a monitored support channel, a backup retention period, and a named legal entity
   with refund terms (`Legal.tsx:202`) — which is this gate's remaining operator half, not a
   completed one. Founder stays disabled and the file refuses "buy now", "subscribe now" or
   "auto-renews".
   **D-Trust-1 found and repaired here: the deletion copy pointed customers at a channel that does
   not exist.** `client/src/lib/account-deletion.ts:26` told a Founder-entangled customer to
   "Settle that review with DueWeave support first" and `:28` offered "contact support" for an
   incomplete erasure, while the same build publishes no support address at all. Both now name the
   Support page, which is the thing the app can actually deliver; `tests/arc3c-account-deletion.test.ts`
   keeps the wording inside the message table and still recognises both outcomes.
   **Measured at this head, and proved able to fail:** the surface went RED for the reason a
   contract must — wrapping only `/privacy` in `<ProtectedPage>` produced
   `× … serves each document at a public address that needs no session → /privacy is not routed to
   PrivacyPage`, `1 failed | 9 passed`, and unwrapping it returned `10 passed (10)` with the two
   Founder routes still the only wrapped ones. `pnpm test:unit` at that head was `54 files / 801 tests` (53 / 790
   at `2a4872c`): the new file's 10 cases, plus one more because the boundary contract enumerates
   every UI source and `Legal.tsx` joined that scan — i.e. the new page is now proven not to touch
   the Supabase client. `pnpm check`, `pnpm lint`, `pnpm build` exit 0, the three documents ship as
   one lazy chunk (`dist/assets/Legal-*.js`, 15.38 kB / 5.55 kB gzip) rather than inside `Home` or
   `Auth`, `verify:hygiene` reports the repository root clean, and `verify:secrets` is
   `Scanned 313 files for 11 credential shapes. No privileged credential found.`
   **What this does not claim:** the browser half of item 11 has never executed except in CI.
   `e2e/stage6-local-trust-surface.spec.ts` — `playwright test --list` collects `Total: 17 tests in
   1 file`: each document served to a session-less browser with one `main` and one `h1` and no
   `sb-*` storage, document-to-document switching, "Return to sign in", the three links on the
   sign-in screen, the six viewport widths 360–1440 measured for horizontal overflow and reading
   measure, and the signed-in More screen — needs the local Supabase stack, which is not running on
   this host (Docker's engine socket is absent), and `--list` compiles the file without running it.
   Its first execution is therefore this head's `Complete customer-browser regression` job, and the
   claim being made here is that CI ran it, not that it was checked locally. **It did run, and the
   reading below is taken off the job log, not inferred:** run `39387657868`, job `118511274956`
   (`all-customer-journeys`, which is `pnpm verify:e2e:local` and therefore collects all of `e2e/`),
   `2026-10-20T07:36:49Z → 07:59:33Z`, reporting `3 failed / 8 skipped / 199 passed (19.3m)`. All 17
   trust-surface cases passed — log ids 107–123: each of `/privacy`, `/terms` and `/support` served to
   a session-less browser, switched to the other two, carried back to the screen that can sign in,
   then the sign-in row, the six viewport widths and the signed-in More screen — so the documents were
   not the failing half of a red job. The three failures were
   `e2e/stage6-local-auth-ux.spec.ts:256:3`, `:335:3` and `:442:3`, and each died on its own *leak
   guard* rather than on a screen a customer sees: the guard refused any body text matching the
   Postgres / PostgREST / GoTrue error vocabulary **plus the bare English word** `policy`, and this
   gate had just put a link labelled "Privacy Policy" on the sign-in screen. The log prints the
   received body, and its only match is the trailing `…Privacy PolicyTerms of UseSupport` — no engine
   token appears in it. Row 10 records the repair and the gate that stops the collision being
   "fixed" by weakening the guard. The other three runs at this head — `39387657754` (CI),
   `39387657945` (Live production public smoke), `39387657721` (CodeQL security review) — each
   finished `success`. Two further limits are recorded rather than smoothed over. (1) `supabase/functions/delete-account/contract.ts:36` still
   returns the old "or contact support" sentence for the `incomplete` outcome; the client maps that
   outcome to its own message so the deployed text is not what a customer reads, but proving that
   and re-deploying the function needs the management credential this line does not hold.
   (2) The pages are English-only and describe India-facing product facts (INR, Asia/Kolkata);
   jurisdiction, GST and any consumer-affairs disclosure remain the operator's decision, which is
   exactly what this gate has always asked for.
   **Corrected again on 2026-10-20 under the CL-7 final-corrections brief, because one pinned
   sentence was itself false.** The Privacy Policy said "The hosting platform takes database
   backups, and restoring one is how an incident is recovered." Supabase's Free plan includes no
   automatic backups and no point-in-time recovery, so that sentence credited the plan with a
   protection it does not sell. The section now states the absence, keeps "deletion erases the live
   ledger", says no retention period has been published, describes the operator's manual logical
   snapshot as an unscheduled procedure rather than a product feature, and points at the customer's
   export as the copy whose retention they control. The support half gained a gated integration:
   `client/src/config/support.ts` resolves `VITE_SUPPORT_EMAIL` and returns null unless the value is
   a usable address, so while the variable is unset the page renders the "no published channel" copy
   and no mailbox at all. The owner publishes an address by setting that variable in the Pages build
   environment — one decision, no code edit, and no literal address in this public tree.
   `tests/trust-surface.contract.test.ts` is 13 cases at this state: one reads the backup section
   alone and rejects the platform-backup sentence, a retention window, and any claimed
   disaster-recovery or restore guarantee; another calls the resolver with absent, blank, malformed
   and valid values, forbids a hard-coded address, and requires every `mailto:` target to be
   `${SUPPORT_EMAIL}`. Both were watched RED before the repair — the backup case on the delivered
   sentence, the support case on `Cannot find module '@/config/support'` — and are green after it.
   In this working tree `pnpm test:unit` is `56 files / 818 tests`; the CI-reachable tree without the
   held `tests/response-headers.contract.test.ts` is `55 files / 808`. `pnpm check` and lint are
   green. **Still open, and not papered over:** item 4's row-data half has never been dumped or
   restored — `--data` writes customer content to disk and stays the operator's call — and a fresh
   structure dump/restore could not be re-run today because Docker Desktop 4.93.0 stopped at its own
   failed-update dialog ("Insufficient disk space for update", 1544 MB available against 3366 MB
   required) and never opened its engine socket. The executed 2026-10-16 structure rehearsal and its
   nine-count MATCH below remain the evidence; this host added none.
7. **Durability, abuse and performance:** Define zero-cost backup/restore and incident response
   appropriate to the hosted Free plan (no PITR), anti-abuse/rate-limit acceptance, load estimates,
   and investigate the five informational unindexed foreign keys using measured workloads.
   *Corrected, then executed, 2026-10-15.* The sentence this gate carried — that `--db-url` and
   `--password` "put the database credential in the process command line, which this release line does
   not do" — is withdrawn as false. The committed census instrument does exactly that: it percent-encodes
   the password from `~/.config/dueweave/prod-db-password` into
   `postgresql://postgres.<ref>:…@aws-0-ap-south-1.pooler.supabase.com:5432/postgres` and passes it as
   `--db-url` **argv to a directly spawned CLI child**, then scrubs the raw and encoded forms from
   everything it prints. What the release line avoids is a shell-interpreted command string and a
   credential in Git, CI logs or an interactive environment — not argv, and saying otherwise made this
   gate look blocked by a rule that never existed.
   The gap was that no backup command existed on that convention, so this head adds one:
   `scripts/hosted-db-backup.mjs` (`pnpm verify:hosted:backup`) wraps `supabase db dump`, keeps the same
   off-repo password file and scrubbing, and **refuses any `--out` that lands inside the repository**
   before the CLI is reached, because this tree is published. Structure-only unless `--data` is passed,
   which adds `--data-only` and prints the warning that the file then holds client names, receivables,
   promises and payments. Eight contract cases pin the containment rule, the credential handling and the
   `--data` opt-in; like the census it is an operator command, named by no workflow and by no release gate.
   **The gate caught the instrument that was written to satisfy it.** Staging this file made it readable to
   `pnpm verify:secrets` for the first time — that scan walks `git ls-files`, so a script written this session
   is invisible to it until it is committed — and the scan reported one hard finding, `database-url-with-password`,
   on the dry-run plan line, which handed `--db-url` a full scheme-and-authority connection string whose
   password field held the redaction marker. The marker was no defence: `verify-secrets.mjs:153` applies the
   placeholder guard only to non-hard rules (`if (!rule.hard && nonLiteral.test(line)) continue;`) so a file
   cannot be edited into blindness, and a hard rule therefore fires on the *shape* regardless of what its
   password field says. The plan line now names the argument instead of reproducing that shape, which loses no
   information because the `TARGET` line above it already prints ref, user, host, port, database and
   `password=[redacted-db-password]`; and because the real fix was only discoverable at staging time, a
   contract case now asserts that the instrument's own source contains no connection-string shape, so
   `pnpm test:unit` catches it before `git add` does. Observed as RED on the written line and GREEN after the
   repair; `verify:secrets` then scanned `292 files` with `No privileged credential found`. The repair touched
   only a printed line, so the executed dump below — run by the pre-repair script — handed the CLI the same
   argv either way.
   **This release record is itself scanned source, and it failed that gate on this head.** CI run
   `38698052579` reported `Static verification → Secret and privileged-credential scan` as
   `docs/CUSTOMER_RELEASE_READINESS.md:238: HARD database-url-with-password`, because the paragraph above was
   first written by *quoting the rejected string* to explain it — to a pattern matcher a quotation is a
   literal, and a prose edit changes a scanned file like any other. The sentence now describes the shape in
   words instead of reproducing it. **The lesson is about ordering, not vocabulary:** the last local
   `verify:secrets` in that pass ran before this paragraph was written, so the other three gates were green and
   only the scan was stale. Re-run all four gates after the final edit — including an edit that only touches
   prose — and read the CI log's own `file:line` before classifying a hosted failure as someone else's
   environment.
   **Executed against production at `2026-10-15T07:09:12Z`**, structure-only, to
   `~/.local/share/dueweave/backups/dueweave-hosted-schema-20261015T070912Z.sql`: 140,710 bytes / 3,291
   lines carrying 15 `CREATE TABLE`, 51 `CREATE FUNCTION` (the census independently counts 51 routines),
   15 `CREATE POLICY` and 13 `ENABLE ROW LEVEL SECURITY` — matching the measured 13-of-13 RLS posture —
   152 grant/revoke statements, and migration 25's `public.delete_my_account`. No line of it matches a
   credential shape. The dump therefore preserves the authorization posture, which is precisely the part
   a backup that restores it wrongly would silently lose.
   **Re-run attempted for the migration-26 promotion, 2026-10-17, and it failed closed — reported rather than
   glossed.** `pnpm verify:hosted:backup` answered `failed to connect to the docker API at
   npipe:////./pipe/dockerDesktopLinuxEngine` at exit 1 and left a 0-byte file, which was deleted instead of
   being kept as a fake backup; `pg_dump` is absent from this host's PATH and from the Ubuntu distro. So the
   structure dump above is now **one migration behind** production (it carries migration 25's
   `public.delete_my_account`, not 26's redefined edit routines), and the reversibility of migration 26 rests
   on the committed definition-level restore `supabase/rollback/20261017090000_revert_cl39_to_hosted_25_definition.sql`,
   whose two routine bodies are hashed to the exact digests production held before the push. Taking a fresh
   structure dump at 26 migrations is an operator command on any host with a working container runtime, and it
   has not been done.
   *What remains open, measured rather than assumed:* (a) **no restore has been executed.** The dump
   names `anon`, `authenticated`, `service_role` and `postgres` as grantees, so replaying it requires
   those roles to pre-exist in the target, and this host still has no `pg_dump`/`psql`/`pg_restore`
   (`where pg_dump` → not found, re-checked 2026-10-15). Docker was reachable for the dump
   (`server=29.8.1`, 20 containers at `06:41:52Z` and again at `07:09Z`) after failing on 2026-10-14 at
   `failed to inspect docker image: … dockerDesktopLinuxEngine`, which is why the backup half could
   finally run here — the restore rehearsal needs a scratch database with the Supabase role set created
   first, and that has not been built or run. **Re-measured 2026-10-16:** this route is closed on this host
   — `docker ps` now hangs without answering (wedged daemon, no output in 120 s) and `df -h /c` reports 475
   G used of 476 G with 215 M free (100 %), so no scratch Postgres container and no local replay can be run
   here; the restore rehearsal needs a host with working Docker and free disk. **Both conditions returned
   later the same day, and the rehearsal was run — see the restore paragraph below, which is the end of item
   (a) and the beginning of what it found.** (b) Row data has never been
   dumped: `--data` exists and is
   pinned by tests, but producing it writes real customer content to disk, so it stays an explicit
   operator decision. (c) Anti-abuse acceptance and load estimates are untouched by this instrument; the
   only abuse measurement on this line is the `/recover` rate window (HTTP 429 inside ~1 minute) in gate 1.
   **Re-measured 2026-10-16, and it found the copy on the other side of that window was wrong.** Two rapid
   `POST /auth/v1/recover` requests for a reserved `example.com` address, issued back to back (739 ms then
   107 ms), both answered `HTTP 200 {}` (`prod-census/recover-shape-1220.log`, 2026-10-16T12:20Z), which
   proves the recovery throttle is
   **per-account** — an address with no account cannot be used to observe a 429, so the body of this
   project's rate-window reply has still never been captured by anything on this line, and reading it
   would mean mailing a real identity. What the screen did with a throttled customer until this head was
   the defect: `friendlyAuthError` keyed on the substring "rate limit", and a refusal that never uses
   those words fell through to "We could not complete that request. Please try again." — advice that
   pushes the window further out each time it is followed. The reading now keys on the HTTP status the
   client library provably carries (`@supabase/auth-js` 2.112.3: `throw new AuthApiError(_getErrorMessage(data),
   error.status || 500, errorCode)`), keeping the wording only for replies that arrive without a status;
   six cases in `tests/confirmation-resend.test.ts`, watched RED first. Rate-limit *configuration* is
   still unread without the management credential, and no load estimate has been made.
   **Item (a) is closed: a restore was executed on 2026-10-16 between `15:29Z` and `16:07Z`, and the run is
   why the restore is now an instrument rather than a sentence.** A fresh structure dump taken by the backup
   instrument, `~/.local/share/dueweave/backups/dueweave-hosted-schema-20261016T152904Z.sql`, is 140,710
   bytes — the same size as the 2026-10-15 dump, so production's structure had not moved in between. The first
   restore was hand-run into a `createdb` database inside `supabase_db_dueweave`, and it looked like a
   success: **psql exited 0** while 26 errors went to stderr, and the database that came back held 13 tables,
   51 functions and 21 triggers and **0 of the 15 row-level-security policies**, because every policy
   references `auth.uid()` and a bare database has no `auth` schema. With `relrowsecurity` true on all 13
   tables and no policy granting anyone anything, a runbook that reads the exit code would have declared a
   recovered database that lets no tenant read any row. `scripts/hosted-db-restore-rehearsal.mjs`
   (`pnpm verify:hosted:restore`) is that trap coded shut: it refuses a target missing `auth`, `extensions` or
   `vault` before feeding a dump byte, refuses a target already holding public tables unless the operator says
   they mean it, reads the *production* census over the session pooler, replays the dump with
   `psql -q -v ON_ERROR_STOP=1 -f -` on stdin, treats any stderr as a failure, and then compares nine object
   counts between the live project and the restored database. The credential keeps the backup instrument's
   rules: read from the off-repo password file, handed over as `docker exec -e PGPASSWORD` — key without a
   value, so no secret enters argv — and scrubbed from every printed byte.
   **Executed, refusal:** `--container supabase_db_dueweave --database dueweave_restore` printed
   `REFUSED … has no auth, extensions, vault schema` and exited 1. **Executed, recovery:** the same dump into
   a fresh `public.ecr.aws/supabase/postgres:17.11.0.002` container — the image the local stack is built from,
   so the Supabase roles already exist there — printed `RESTORED … with ON_ERROR_STOP=1 and nothing on
   stderr`, then `PRODUCTION tables=13 views=0 functions=51 triggers=21 policies=15 indexes=36 sequences=0
   rls_tables=13 constraints=93` and `RESTORED` with the same nine numbers and `MATCH`, exit 0. So the backup
   this gate asks for has been proved to restore, structurally, onto a project-shaped database, and the
   census pair the instrument prints is the evidence rather than an exit code.
   **Two defects only the real run could find, because a recording stub replays fixtures and never parses
   what it is handed.** The first attempt stopped at `fe_sendauth: no password supplied`: the instrument had
   passed `PGPASSWORD` to the `docker` process it spawned, and `docker exec` gives the child the *container's*
   environment, not the client's, so the variable was silently absent inside until the census call named
   `-e PGPASSWORD`. The second stopped at `syntax error at or near
   "'CENSUS_PROBE'"`: the census is built by joining counts with `||`, and the leading marker made the whole
   argument an expression list with no `select`, which a stub that matches argv substrings accepts happily and
   psql does not. Each was pinned by a contract case watched RED first — one asserts the pooler census carries
   `-e` and `PGPASSWORD` and never `PGPASSWORD=`, the other asserts both census statements begin `select ` —
   then fixed. `tests/hosted-db-restore-rehearsal.contract.test.ts` was 13 cases at that measurement; `pnpm test:unit` is 50 files /
   750 tests (49 / 737 at `3e63ac8`), and `pnpm check`, `pnpm lint` and `pnpm verify:secrets`
   (`Scanned 297 files for 11 credential shapes. No privileged credential found.`) are green locally at this head.
   **The row half was made executable and then executed on 2026-10-20, and its first attempt failed in a way
   the recording stub could not.** `--rows <file>` was added under TDD (six cases, watched RED at 6 failed /
   13 passed, then 20/20 green): the rehearsal loads the row dump after the structure with
   `ON_ERROR_STOP=1` and `set session_replication_role = replica` — the latter because a public row dump
   names auth users whose identities are not in it, so FK triggers would stop on the first reference — reads
   every public table's count from production and from the restored copy, refuses a row dump that is
   missing or inside this temporarily-public repository, and on a failed row load prints only psql's
   `ERROR:` line while stating that `DETAIL` and `CONTEXT` are withheld because they quote the rows. The
   first real run used the instrument's unrestricted `--data-only` dump and died at `psql:<stdin>:47:
   ERROR: column "email_confirmed_at" of relation "users" does not exist`: the structure half is
   application-only, but the data half also emitted `auth.users` inserts, and GoTrue owns that schema —
   the image's auth schema is a different version from production's. The data dump is now scoped with
   `--schema public` (one new backup contract case, watched RED first: 9/9 green), the auth-bearing file
   was deleted by its exact path, and a fresh rehearsal ran clean:
   `RESTORED dueweave-hosted-schema-20261020T112854Z.sql … with ON_ERROR_STOP=1 and nothing on stderr`,
   `PRODUCTION`/`RESTORED` both `tables=13 views=0 functions=51 triggers=21 policies=15 indexes=36
   sequences=0 rls_tables=13 constraints=93`, `MATCH`; then `ROWS LOADED dueweave-hosted-rows-20261020T113105Z.sql`
   (10,185 bytes, 9 tables carrying rows) and `ROWS PRODUCTION`/`ROWS RESTORED` both `promises=2 clients=4
   profiles=1 receivables=3 payments=1 promise_events=2 activities=8 founder_admins=0 founder_audit_events=0
   entitlements=1 purchase_claims=0 analytics_events=0 founder_offer_config=1`, `ROWS MATCH every public
   table came back with the same row count (13 tables)`, exit 0. The target was a fresh, port-less
   `public.ecr.aws/supabase/postgres:17.11.0.002` container (the image the local stack uses, so its auth,
   extensions and vault schemas exist); it was removed by its exact name after the run and left no volume.
   **What the row rehearsal does not claim:** the SQL backup covers the `public` schema only — auth
   identities stay with GoTrue and account sign-in recovery is not claimed from this file; FK enforcement
   was deferred during the load, so references from restored rows to auth identities were not validated;
   the census compares row counts, not row contents, and the 152 grant statements in the structure dump
   are still not compared; storage objects are not covered; and the process remains manual, unscheduled
   and without a published retention period, which is what the Privacy Policy now says.
   **What this does not claim:** the structure comparison is an object census, not the 152 grant statements
   inside the dump, which were preserved but not compared. And it proves the dump replays onto a database
   provisioned like a Supabase project; replaying onto a bare Postgres instance is precisely what the
   instrument now refuses, which is the finding, not a gap.
   Teardown was scoped to what this rehearsal created: `DROP DATABASE dueweave_restore`, and both rehearsal
   containers removed by name, leaving the other tenant's containers on this shared host untouched. The dumps
   live outside the repository, so no broad `git add` can publish them.
   **The customer-facing statement was corrected on 2026-10-20:** the Privacy Policy no longer credits
   the Free plan with backups. The plan provides none automatically, the operator procedure is manual
   and unscheduled, and no retention period is published. Gate 6 records the correction, its contract
   cases and the measured Docker block that kept today's rehearsal from running.
8. **Release governance:** Reconcile the long-lived `main` branch, branch/PR protection, final
   changelog and operations rollback; verify head==GitHub CI SHA==Pages deployed SHA, all intended
   gates pass, and no secret is in Git or client assets. The repository is temporarily public for
   hosted Actions and must not silently be called private.
   **Amended 2026-10-16, because the Pages half of "head==CI SHA==deployed SHA" was assumed rather than
   read, and reading it changed the record:** `https://dueweave.pages.dev/` served `assets/index-Bv2LIPpN.js`
   until this afternoon and now serves `assets/index-vEHLqm_5.js`, whose bytes contain the `status===429`
   predicate first pushed at `1a025bd`. So Pages is building from each push to `release/consumer-live`;
   the deployment is not pinned to an old commit, and the flags-off posture is held by the project's build
   environment rather than by the artifact's age — proved by the same fetch: the chunk that entry
   lazy-loads, `assets/Auth-CP-OJQ39.js`, still carries "New registrations are temporarily paused" and
   carries no "Create an account". Two limits on what this establishes, stated rather than smoothed over.
   (1) No Cloudflare credential is held on this line, so **the deployment's own commit SHA has never been
   read**; identity here is inferred from shipped bytes matching a specific head, which is weaker than the
   API read this gate asks for. (2) A prior deployment's hashed assets stay addressable — the superseded
   `index-Bv2LIPpN.js` still answers HTTP 200 with 495,042 bytes of JavaScript — so fetching an asset name
   from an old link proves nothing about what is live; only the name referenced by `GET /` does. The
   exact-head parity instrument (`node scripts/verify-deployed-parity.mjs --dist dist-paused`) has not been
   re-run at this head because building `dist-paused` needs disk this host no longer has (215 M free of
   476 G).
   **Corrected and executed the same evening, `~2026-10-16T16:14Z` (the parity run finished before the
   `16:15:16Z` read of `date -u`):** that sentence is now false, because
   free space returned (`df -h /c` reported 4.2 G at the run) and the flags-off bundle built. Rebuilding
   `dist-paused` with exactly the environment `scripts/run-paused-e2e.mjs` uses — `VITE_PUBLIC_SIGNUP_ENABLED
   =false`, `VITE_AUTH_EMAIL_ENABLED=false`, the hosted URL and publishable key — produced entry
   `assets/index-vEHLqm_5.js` (495.17 kB) and `assets/Auth-CP-OJQ39.js`, the two names this gate's own fetch
   had already read off `GET /`, and the instrument compared them byte for byte: **`Compared 20 built file(s)
   and verified 2 host configuration file(s) … Parity holds`, `EFFECT _headers 80 live header declaration(s)
   honoured`, `EFFECT _redirects /parity-probe answers HTTP 200`, exit 0.** Four of those twenty lines carry
   the instrument's own note that the raw files differ only by the checkout's carriage returns, which is the
   `core.autocrlf` behaviour of this host recorded rather than smoothed over. Two limits survive the green
   exit, and they are the reason this row is not the gate's closure. (1) **The deployment's commit SHA is
   still unread** — no Cloudflare credential is held on this line, so what is proved is that production serves
   every byte *this head compiles*, which is weaker than head==CI SHA==deployed SHA. (2) This head changed no
   build input (`scripts/`, `tests/`, `package.json` and this file), so the artifact is the same one `1a025bd`
   shipped; the parity claim is that this head's build equals production, not that Pages was rebuilt for
   `a780209`. Both facts are measurable only with the deployment API, which is the owner-side half of gate 8
   that remains open.
   **CL-7 final corrections, 2026-10-20 — the automatic-deployment stop is bracketed by GitHub's own
   records, and the deployed-SHA half of this gate now has an instrument that fails closed.** The brief's
   claims are not repeated here; what was read at this line is. (a) **The integration was working at the
   last push before the stop and produced nothing after it.** The Cloudflare GitHub App
   (`cloudflare-workers-and-pages`, app id 85455, subscribed to `push` and `pull_request`) created a
   completed/success check-run for every commit through `4d829780` — that one's suite opened
   `2026-10-17T17:01:54Z` and closed `17:02:34Z`, 57 seconds later, at deployment
   `9478a012-0cf9-42f9-81e6-b8dc0a8229c1` in account `cdfe06b4a219190fcbd20b647b926b0e` (read from the
   check-run's `details_url`, not from a credential this line holds). The first push with **no** Cloudflare
   check-run at all is `e9759a59` at `2026-10-20T06:17:28Z`; `2a4872c`, `c0fc2d8` and `2eed7dd` likewise carry
   only `github-actions` check-runs, zero legacy status contexts, and no Deployments API record. So the stop
   is bounded to `2026-10-17T17:02:34Z → 2026-10-20T06:17:28Z`, which is what "after October 17" means when
   dated from evidence rather than from a sentence. (b) **Nothing on the repository side refused it.** The
   branch is unprotected (`GET …/branches/release/consumer-live/protection` → 404 "Branch not protected"),
   `GET …/rulesets` is `[]`, and `GET …/hooks` is `[]` — Cloudflare Pages uses the GitHub App, not a repo
   webhook, so there is no delivery log here to read. The installation itself is not readable from this
   line: `GET /user/installations` answers 403 ("must authenticate with an access token authorized to a
   GitHub App") and `GET /repos/…/installation` answers 401 ("A JSON web token could not be decoded") with a
   user PAT. This establishes the shape of the failure — pushes arrived, GitHub created the check-suite
   input, and no Cloudflare check-run was ever posted — and it does **not** name the Cloudflare-side cause:
   a suspended or removed installation and a project whose automatic production deployment was turned off
   produce the same repository-side silence. That reading needs the connected account, which this line does
   not hold; the existing Pages project was not reconnected, replaced or otherwise touched.
   (c) **The deployed-SHA requirement is now executable, and its first real run says production cannot
   name its commit.** `scripts/build-info.mjs` emits `dist/build-info.json` as
   `{"schema":1,"commit":…,"source":…}`, taking `CF_PAGES_COMMIT_SHA` from a Pages build, else `GITHUB_SHA`
   from a workflow build, else an explicit `DUEWEAVE_BUILD_COMMIT` claim labelled `source: "operator"`; a
   laptop build names no commit rather than reading HEAD from a dirty tree. Two real builds were measured:
   plain `pnpm build` wrote `{"schema":1,"commit":null,"source":"none"}`, and
   `DUEWEAVE_BUILD_COMMIT=$(git rev-parse HEAD) pnpm build` wrote
   `{"schema":1,"commit":"e5e8090bbce9a6472b9a640e23d47b4bf99f3f6a","source":"operator"}`. The gate is
   `pnpm verify:deployed:current --sha <commit>` (`scripts/verify-deployed-currentness.mjs`): it reads
   `https://dueweave.pages.dev/build-info.json`, requires schema 1 and a **full** 40/64-hex commit, and
   refuses a missing file, the SPA fallback answering HTTP 200 for it, unparsable JSON, a null commit, a
   prefix, or any byte-level difference from the target — all before it can print `CURRENT`. Run against
   production at this head it answered
   `NOT CURRENT — https://dueweave.pages.dev answered /build-info.json with something that is not a build
   stamp (text/html; charset=utf-8, 1220 bytes)…` and exited 1. That is the correct answer for a deployment
   built before the stamp existed, and it means **"production serves `2eed7dd`" is, at this line, the
   platform owner's claim rather than a measurement**: the site serves the same stable bundle it served
   before, which is exactly the certificate item 10 forbids. After one stamp-bearing deployment, the same
   command either prints `CURRENT — … serves commit <sha>` or names the commit it actually serves. The gate
   is contract-tested as an operator command that no workflow or local release gate may reach
   (`tests/deployed-currentness.contract.test.ts`), because a deployment that legitimately lags its branch
   is not a CI failure; `verify-deployed-parity.mjs` now excludes `build-info.json` for the same reason,
   with its own case proving that two different stamps are not an artifact defect
   (`tests/deployed-artifact-parity.contract.test.ts`). The written line was watched RED first —
   `19 failed | 16 passed (35)` with both modules absent — then green at `35 passed (35)`; `pnpm test:unit`
   is `58 files / 838 tests passed`, and the release header now names the currency command for the P4
   manifest. **What remains open in this row is the same owner-side half as before, now with one fewer
   excuse:** restore the Pages integration from the connected account, deploy one build that carries the
   stamp, then record `verify:deployed:current` against the pushed SHA. Until that output exists, this gate
   may not be called closed and the live site may not be called current.
   **Read again at `2026-10-20T11:20Z`, after the owner reported a repair:** the origin now serves entry
   `assets/index-C4rUFk9x.js` (495,564 B) and `assets/index-DzfHaBba.css`, whose legal chunk is
   `assets/Legal-Cz0mKZ7o.js` — the flags-off fingerprints the CI build printed at `523fa26`, which the
   docs-only remote tip `2eed7dd` leaves byte-identical — where at `09:05Z` it served the older
   `index-C7pebI3S.js` / `index-CUm43t91.css` pair. **A build was delivered after the silence this row
   dated, so delivery is no longer stalled**; whether the integration rebuilt on push or the owner
   triggered a deployment from the connected account cannot be told from the bytes. The stamp is still
   absent (`/build-info.json` is the 1,220-byte SPA fallback), so the gate remains open exactly as stated:
   a stamped build is what closes it, and "production serves `2eed7dd`" is still the owner's claim rather
   than a measurement.
9. **Temporary QA cloud cleanup:** `DueWeave Validation` was paused but is **not confirmed
   permanently deleted**; this administrative cleanup remains open.
10. **Production CSP, HSTS, accessibility, mobile behavior and customer-facing error handling
   (CL-7 Stage C item 14):** reassessed against what the live origin really sends, and two of the
   five were not there. *Executed 2026-10-20.*
   **Measured before anything was written:** `GET https://dueweave.pages.dev/` with a cache-busting
   probe at `2026-10-20T08:29:52Z` answered `HTTP/1.1 200 OK` carrying four application headers
   (`permissions-policy`, `referrer-policy`, `x-content-type-options`, `x-frame-options`) and **no
   `Content-Security-Policy` and no `Strict-Transport-Security`**. So the honest answer to "reassess
   production CSP and HSTS" is that neither existed on the origin customers reach, even though the
   other four have shipped from `client/public/_headers` since this release line began.
   **The product repair is those two directives (`client/public/_headers:6-7`), deny-by-default with
   every allowance traced to a feature.** `default-src 'self'` and `script-src 'self'` — no inline
   script and no third-party JavaScript, because DueWeave ships no analytics script;
   `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` and
   `font-src 'self' https://fonts.gstatic.com`; `img-src 'self' data:` (the `data:` concession is
   paid for — the Founder QR and the export preview are generated image URIs, not fetched ones);
   `connect-src 'self'` plus the one hosted Supabase origin over `https` **and** `wss`, because
   realtime is a feature a customer sees; and the four surfaces this product never uses are shut —
   `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, with
   `upgrade-insecure-requests`. `'unsafe-inline'` for styles is not a shortcut around the policy:
   React writes inline `style` attributes, and the static gate below couples the concession to the
   sources that write it, so deleting one breaks the other. HSTS is
   `max-age=15552000; includeSubDomains` — eighteen months, and deliberately **not** `preload`,
   because a preload listing cannot be undone from this line.
   **Gated twice, because a header file can assert anything.** `tests/response-headers.contract.test.ts`
   (10 cases) pins the text and re-derives it from the sources rather than from a copy of itself: the
   stylesheet and font-file hosts are read out of `client/index.html`'s own `<link>` tags, so a
   policy that drops a host the document really loads fails; hosted `https` **and** `wss` must both
   appear in `connect-src`; wildcards and bare scheme sources are refused; `style-src 'unsafe-inline'`
   must have a real inline-style writer; and HSTS must reach 15,552,000 seconds without claiming
   `preload`. The other two cases answer the hole in the browser file below — that no signed-in screen
   is ever loaded under the policy. *leaves script-src 'self' nothing to refuse anywhere in the
   bundle* walks every `.ts`/`.tsx` under `client/src` and refuses the constructs this policy has no
   concession for: `eval(`, `new Function(`, a `Worker`, `navigator.serviceWorker`, `document.write(`,
   an `<iframe>` and a written `<script>`; measured result, none anywhere in the app, which is what
   makes `script-src 'self'` with no `unsafe-eval` and no `worker-src` or `frame-src` safe to run on
   the ledger, the export and the Founder screens as well as the sign-in page. *keeps every
   cross-origin data call inside connect-src, on every screen* allows no origin written into a
   `fetch`/`new WebSocket`/`XMLHttpRequest`/`sendBeacon` call that `connect-src` does not name — and
   separates `wa.me`, which is an `<a target="_blank">` navigation no fetch directive governs, from a
   fetch to the same host, which would be governed. That case carries its own control: the matcher
   must read a probe `fetch` to an origin the policy refuses, the host extractor must name it, the
   origin must really be absent from `connect-src`, and the scan must have walked more than 30 source
   files — because a reading that found nothing is only worth having if it could have found something.
   **Proved able to fail by measurement, three times:** lowering the shipped directive to
   `max-age=86400` produced `× requires HTTPS for every visitor, without claiming a preload listing →
   a policy under six months is a policy that expires mid-incident: expected 86400 to be greater than
   or equal to 15552000`, `1 failed | 9 passed (10)`, and restoring it returned `10 passed (10)`;
   putting `new Function("return 1")` and a `fetch("https://a-host-outside-the-policy.example/x")`
   into `client/src/lib/download.ts` produced `2 failed | 8 passed (10)`, with both messages naming
   that file — `client\src\lib\download.ts uses something the policy refuses: generated functions
   require script-src 'unsafe-eval'` and `client\src\lib\download.ts fetches
   a-host-outside-the-policy.example, which connect-src refuses` — and the hand revert returned
   `10 passed (10)` with `git diff` on that file empty.
   `e2e/response-headers.spec.ts` (5 cases) then runs the app under that policy in real Chromium. It
   reads the shipped string out of `_headers` and injects it onto the document response, because
   `vite preview` ignores that file — a harness that waited for the server to send the header would
   have been measuring nothing. Under the injected policy the sign-in screen must paint in its own
   webfont family (asked of the page: which family the computed style names, then whether
   `document.fonts.check` says it arrived — not an assumed weight), all three trust documents must
   render, the allowlisted API origin must be reachable with its `wss` realtime sibling and a
   generated `data:` image must decode, and a late `<base href>` must be refused. One control case
   holds the other four up: an appended inline script must **not** execute and a fetch to an origin
   outside the policy must be refused, or the passes above would mean the reading was impossible
   rather than the policy harmless. Re-measured at the shipping state, twice: `5 passed (24.9s)` and
   then `5 passed (10.7s)` in the run recorded at the end of this row.
   **The activation is deliberately separated from the repair, because a push to this branch deploys.**
   Cloudflare Pages rebuilds the production site on every push to `release/consumer-live`, so the two
   new directives in `client/public/_headers` would go live for every customer in the same push as an
   unrelated CSS repair — and the only browser proof of that policy covers the sign-in screen and the
   three trust documents, because no local or CI harness can load a signed-in screen under it (the
   stack is not on this host, and `vite preview` ignores `_headers` for every path). So the pushed head
   carries the trust-row target repair, the guard-vocabulary repair and `e2e-paused/auth-trust-links.spec.ts`
   — whose first CI execution is that head's own `pnpm test:e2e:paused`, since that script collects all
   of `e2e-paused/` — while the two new lines in `client/public/_headers`, `e2e/response-headers.spec.ts` and
   `tests/response-headers.contract.test.ts` are kept in this working tree **uncommitted** — the two
   directives unstaged in that file and the two specs untracked — so that no push of this branch can
   carry a site-wide policy by accident. Committing them is Stage E item 19's controlled step, made
   after item 18's battery is green at one head, and
   item 20's signed-in validation on the newly deployed artifact is what measures the live policy on
   the surfaces this line cannot reach. **Nothing in the pushed head is a policy claim:** after that
   push the origin still sends no `Content-Security-Policy` and no `Strict-Transport-Security`, which
   is the state the probe at the top of this row measured, and what is proved here is the text of the
   policy and a browser's behaviour under it, not the deployment.
   **Which artifact production answers for, read rather than assumed, `2026-10-20T09:05Z`.** The
   premise of the paragraph above — that a push to this branch deploys — was tested by fetching what
   `GET /` names and reading the bytes behind it. The origin serves entry `assets/index-C7pebI3S.js`
   (495,166 B) and `assets/index-CUm43t91.css` (68,415 B); that entry lazy-loads
   `assets/Auth-Bm6EgDao.js`, whose bytes carry `"This recovery link is not active"` (the D-Rec-1 copy
   pushed at `2a4872c`) and still carry "temporarily paused" with no "Create an account", so the
   flags-off posture holds in what is live. That entry's lazy map names no `Legal-*.js`, the served
   stylesheet has `auth-legal-link`, `legal-shell` and `min-height:24px` at zero occurrences each, and
   the same command against the working tree's flags-off build prints
   `MISS assets/Legal-Cz0mKZ7o.js … not served by the deployed site` for twelve of 21 built files plus
   `DIFF index.html` (`accbde1aac36` local against `7abf0e5edf53` served). So the rebuild *does* follow
   pushes — `2a4872c` got there — and as of this reading it has not yet caught up with `c0fc2d8`,
   `4a8211f` and `523fa26`, which were pushed at `08:58Z` and `09:01Z`. **The consequence for the
   customer is stated plainly: the three trust documents and the 24-pixel trust row are committed and
   not yet what a visitor on `https://dueweave.pages.dev/` receives.** That lag is not new —
   `playwright.live-public.config.ts` budgets for it, and its comment records a push taking 17 minutes
   to serve a byte-identical stylesheet on 2026-10-13 — but re-read at `09:27Z`, 29 minutes after the
   first of those pushes, the entry had still not moved, so this head's wait is **longer than the 17
   minutes that precedent recorded** and cannot be quoted as a bound. This line's instrument cannot
   shorten it, but item 20's validation on the newly deployed artifact must re-read these fingerprints
   rather than inherit them. A third read at `09:32Z`, cache-busted, still names the same two files —
   34 minutes after the first of those pushes — so the wait grows with each read rather than closing.
   **One way this gate could be misread, found while reading it.** `scripts/verify-deployed-parity.mjs`
   checks the host configuration files by *effect*, and it reads `client/public/_headers` out of the
   working tree, so while the two directives are held uncommitted the instrument reports
   `DIFF _headers … declares "Content-Security-Policy: …" but
   https://dueweave.pages.dev/.gitkeep answered nothing`. Its arithmetic is worth spelling out because
   it is easy to mistake for a broken deployment: `84 live header declaration(s) honoured` is the four
   headers the deployment really does send, counted over the 21 built artifacts, and the 55 reported
   mismatches are exactly 12 absent artifacts + `index.html` + 42 problems, which is the held CSP and
   the held HSTS failing on all 21 paths. `verify:deployed:parity` is a laptop and operator command and
   never a CI step, so this reading is a status report, not a gate result — and it is why the artifact
   half above is the `MISS`/`DIFF` file list rather than the exit code alone. Committing the policy
   without deploying it is impossible — the file *is* the deployment — which is the point of keeping it
   unstaged until Stage E item 19.
   **D-Trust-2, found by measuring the artifact production serves: the trust row was a 21.75-pixel
   target.** `e2e-paused/auth-trust-links.spec.ts` clicks the flags-off bundle that
   `scripts/run-paused-e2e.mjs` builds with the same two environment variables production builds
   with, and its first case failed with `"Privacy Policy" is a 67.6x21.8px target of 10.5px type …
   Expected: >= 24 / Received: 21.75`. Both rows shipped as `padding:3px 0` on 10.5–11px type, under
   the 24×24 CSS px floor this repository already applies to every other touch target
   (`e2e/stage6-local-responsive.spec.ts:198`, the rule CL-16 and CL-17 were measured against). The
   repair sets the floor on the box rather than on the type — `display:inline-flex`,
   `align-items:center`, `min-height:24px` on `.auth-legal-link` and `.more-legal-link`
   (`client/src/index.css:284,287`) — so the row still reads as a footnote on a phone and a thumb can
   land on it. Re-run after the repair: `7 passed (11.7s)` for the whole paused battery.
   **Four falsifications, all reverted by hand, so the gate is known to be watching:** deleting
   `min-height` from the sign-in rule and rebuilding reproduced `Received: 21.75` at exit 1; deleting
   it from the More rule produced `.more-legal-link sets a 0px-tall target on an 11px link: expected 0
   to be greater than or equal to 24`, `1 failed | 10 passed (11)` — which is why the static case
   loops both selectors; setting `color:var(--rule)` produced
   `"Privacy Policy" is 1.16:1 against the background it sits on … Expected: >= 4.5 / Received:
   1.159906846463471`, `1 failed | 3 passed`; and `tabIndex={-1}` on one link with its `to` swapped
   produced `the tab stop after the sign-in button was "Support", not "Terms of Use"` and
   `"Support" opened something other than /support`. A fifth falsification is the one that kept the
   repair small: forcing `white-space:nowrap` with side padding made the sign-in screen scroll
   sideways at 360px (`550 inside 360`), which is why the fix adds height instead of width.
   **Accessibility, gated where it can be measured and left open where it cannot.** The same file
   computes each link's contrast by compositing the ancestor background chain under it and requires
   4.5:1, walks the keyboard from the submit control through the three links in document order and
   requires `:focus-visible` to match with a drawn outline on every stop, and re-measures horizontal
   overflow (`scrollWidth ≤ clientWidth + 1`) at 360×800 against the flags-off copy — a different
   screen from the one CI's flags-on `stage6-local-trust-surface` measures, not a second copy of it.
   The signed-in More row is pinned statically instead, because reaching it needs a session and this
   host has no stack to give one. **One limit kept as an owner decision rather than quietly styled
   away:** WCAG 2.2 2.4.13 (focus appearance) is not gated. The shipped ring is
   `a:focus-visible { outline: 3px solid rgba(19,123,120,.28); outline-offset: 3px }`
   (`client/src/index.css:39`), whose contrast against `--canvas #f4f1eb` is about 1.4:1 —
   **calculated by hand, never measured**, and against a 3:1 expectation, which is precisely why this
   row is left open rather than claimed. `e2e/stage6-local-accessibility.spec.ts:4` already disclaims
   WCAG conformance, so restyling focus across the app is the operator's design decision.
   **Customer-facing error handling is where the red CI run turned out to be the finding.** The three
   failures at `c0fc2d8` were guards, not screens, and the guard's purpose is right — a customer must
   never read engine internals. The repair keeps every arm and replaces the bare word with the
   signature Postgres actually emits, `row-level security`, at the four whole-document guards
   (`e2e/stage6-local-auth-ux.spec.ts:286,349,464` and
   `e2e/stage6-local-ledger-states.spec.ts:190`), with every engine arm each guard already carried
   left in place — `PGRST`, `SQLSTATE`, `postgrest`, `gotrue`, `InvalidLogin`, `constraint`,
   `failed to fetch`. The two `stage6-local-workspace-gate.spec.ts` guards already named SQL error
   codes rather than words and needed no change. `tests/leak-vocabulary-vs-legal-copy.contract.test.ts` (4 cases) then holds
   both halves of that line against the product's own shipped copy, read out of `Auth.tsx` and
   `Legal.tsx` rather than retyped here: no guard may fire on a label or heading a customer is asked
   to read, every guard carrying authorization vocabulary must fire on the real
   `new row violates row-level security policy …` and `duplicate key value violates unique
   constraint …` messages, and no whole-document guard may hold a bare English word
   (`policy`, `role`, `grant`, `permission`, `table`, `schema`, `session`) as an alternative.
   **Proved able to fail by putting the bug back:** restoring `policy` as an arm of the first guard
   produced `stage6-local-auth-ux.spec.ts:286 calls the product's own wording a leak: expected
   'Privacy Policy' not to match …` and `… bans a bare English word the product may legitimately
   use: expected 'policy' not to match …`, `2 failed | 2 passed`, and the restore returned
   `4 passed`. So the collision cannot be closed later by deleting the guard it complains about.
   **Gate set at this state, each run re-executed after the final edit of this row:** `pnpm check` and
   `pnpm lint` exit 0. `pnpm test:unit` is `56 files / 814 tests passed` in this working tree; the same
   suite run with the two held files moved out of the repository reads `55 files / 806 tests passed`,
   which is the number the pushed head really carries (`54 / 801` at `c0fc2d8`, plus this head's 4 + 1
   new cases). `pnpm test:e2e:paused` is `7 passed (20.6s)` — the three cases already in that directory
   plus the four new trust-row cases — after a fresh `1718 modules transformed / built in 11.80s`
   flags-off build. `e2e/response-headers.spec.ts` is `5 passed (10.7s)` under the throwaway harness
   described above (kept outside the repository and deleted at the end of this pass, because the
   repository must not carry a config that runs a stack suite without a stack).
   **The two gates that read prose ran last, after this row was written**, which is the ordering
   lesson `## Blocking gates` row 7 records. At the head this row was pushed with, `verify:hygiene`
   answers `Read the working tree: 2 untracked, non-ignored file(s) in the git add -A surface.` — exactly
   the two specs held above, with the `_headers` directives showing only as a modification to a tracked
   file — and adds that the repository root carries no untracked, non-ignored artifact, so nothing at it
   can be staged by accident. `verify:secrets` then answers `Scanned 317 files for 11 credential shapes.
   No privileged credential found.`, over the tracked tree, the untracked files a `git add -A` would
   stage, and the built bundle — so a policy file that names a hosted origin is scanned before it is
   committed rather than after.
   **CI at the head carrying this row's product work, read out of the job logs:
   `523fa26af3fb76926e7e5a7b712236651c0955f3`.** All six check-runs are `completed/success`.
   Static verification prints `Test Files 55 passed (55)`
   and `Tests 806 passed (806)` — 55, not 57, because the two header specs are held untracked in this
   working tree — then hygiene (`0 untracked, non-ignored file(s) in the git add -A surface`) and
   `Scanned 315 files for 11 credential shapes. No privileged credential found`. Browser release smoke
   built flags-off *in CI* and printed the same fingerprints this row's local build has
   (`../dist-paused/assets/Legal-Cz0mKZ7o.js 15.38 kB`, `index-DzfHaBba.css 71.13 kB`,
   `index-C4rUFk9x.js 495.56 kB`), then ran the **first CI execution** of
   `e2e-paused/auth-trust-links.spec.ts`: `✓ 2 … hands a phone customer three documents whose targets a
   thumb can hit (1.1s)`, `✓ 3 … keeps the trust row inside the narrowest phone and readable on it
   (798ms)`, `✓ 5 … lets a keyboard reach every document from the sign-in screen, and says where it is
   (718ms)`, `✓ 7 … opens the document each link names, on the artifact production serves (3.3s)` —
   inside `7 passed (7.4s)`, alongside `81 passed (11.0m)` for the stack battery and `3 passed (30.2s)`
   for the React-warning suite. `all-customer-journeys` is `202 passed (19.0m)` and its cases 107–123 are
   `e2e/stage6-local-trust-surface.spec.ts`, including `links all three from the sign-in screen, before a
   credential is typed` and `links all three from the signed-in screen that holds the data controls`.
   **These numbers are not portable to the head before it.** At `4a8211f`, three minutes earlier,
   `Database contracts`, `Browser release smoke` and `all-customer-journeys` all end
   `completed/cancelled` — the `cancel-in-progress` group firing when this head was pushed, after
   Static verification had already succeeded there — while `analyze` and `live-public` completed. Only
   those two are shared readings; the trust-row evidence is `523fa26`'s alone.
   **What `live-public` green does not prove, found in its own log.** Its settle step read the
   deployment at `09:02:01Z` and printed `[live-settle] https://dueweave.pages.dev/auth read 1 names
   /assets/index-C7pebI3S.js, /assets/index-CUm43t91.css`, then `served the same build twice
   (index-C7pebI3S.js + index-CUm43t91.css) after 2 reads in 15344ms` — the two `2a4872c` fingerprints
   this row re-measured by hand at `09:05Z` and `09:27Z`. The instrument certifies that the origin is
   *stable*, not that it is *current*, and `e2e-live/` holds no trust-document or target-size
   assertion, so `6 passed (32.2s)` validates the deployed sign-in screen as it stood before items
   11–12. Item 20's acceptance on the newly deployed artifact therefore has to be taken against the
   moved fingerprint, not against this run.
   **The hold recorded above ended with the final-corrections brief, and item 16's repository half is
   complete at `2026-10-20T11:20Z`.** CL-7 final-corrections item 16 is the controlled step the
   earlier paragraph reserved for Stage E item 19 — "complete the already-authored CSP/HSTS rollout
   with real browser testing and a rollback path" — so `client/public/_headers`,
   `tests/response-headers.contract.test.ts` and `e2e/response-headers.spec.ts` are committed
   together at this head rather than held. Re-measured at the shipping state: the contract suite is
   `10 passed (10)`; the browser suite is `5 passed (32.1s)` in real Chromium against a freshly
   built bundle (`✓ built in 11.67s`), covering the sign-in screen with its webfonts, all three
   trust documents, the refusal control, the allowlisted API origin with a `data:` QR, and the
   shut base/frame surfaces; and the live origin is unchanged — a cache-busted
   `GET https://dueweave.pages.dev/` at `2026-10-20T11:19:39Z` answered `HTTP/1.1 200 OK` with
   `permissions-policy`, `referrer-policy`, `x-content-type-options` and `x-frame-options`, and
   **no `content-security-policy` and no `strict-transport-security`**.
   **The origin has moved since the morning reads, but not to this work.** It now serves entry
   `assets/index-C4rUFk9x.js` (495,564 B) and `assets/index-DzfHaBba.css`, whose legal chunk is
   `assets/Legal-Cz0mKZ7o.js` (15,378 B) — the flags-off fingerprints the CI build printed at
   `523fa26`, which the docs-only remote tip `2eed7dd` leaves byte-identical. That chunk still
   carries the pre-correction sentence "The hosting platform takes database backups, and restoring
   one is how an incident is recovered." and contains neither `no automatic backups` nor
   `point-in-time`, so P1's corrected Privacy copy (`e5e8090`), P2's currentness stamp
   (`1d85395`) and these two directives are **committed on this laptop and not on the remote
   branch**, let alone served; the remote tip is still `2eed7dd`. The customer-facing consequence
   is exact: the live Privacy page still makes the backup claim the brief asked to remove, and the
   live site still has neither header. Neither may be called corrected here until a Pages build
   carries them.
   **Rollback path, written before the policy ships.** The repair is exactly two lines
   (`client/public/_headers:6-7`). To roll back, delete those two directives and redeploy: a
   `Content-Security-Policy` applies per response, so the next response without it is unpoliced
   and a CSP regression is undone by the next deploy with no waiting. HSTS is not symmetric — a
   browser that has seen `max-age=15552000; includeSubDomains` keeps requiring HTTPS for 180 days
   even after the header is removed, and nothing this line can serve revokes it early; the client
   cache must expire or be cleared. That asymmetry is why the directive deliberately omits
   `preload` (a submitted preload listing cannot be withdrawn from here) and why the commitment is
   180 days rather than a year.
   **Residual risk, kept rather than rounded away.** The browser proof loads the sign-in screen
   and the three trust documents; no signed-in screen is loaded under the policy on this host,
   because reaching one needs the local Supabase stack and a real account. Those screens are
   covered statically: the scan above finds no `eval`, `Function`, `Worker`, service worker,
   `document.write`, iframe or runtime script in `client/src`, every cross-origin data call is in
   `connect-src`, and no literal external `src=`, `href=` or CSS `url()` origin exists in
   `client/src` (measured at this state). What remains possible is a future screen that loads a
   new origin the policy refuses; the contract test would catch a stylesheet or font host added to
   the entry document or a new cross-origin data call, but an external image added in a signed-in
   screen would be caught only by a browser, and validation on the new deployment is the first
   place one can be seen. If that happens, the rollback above is the response.
   **Gate status: repository-complete, activation-open.** The policy, its contract and its browser
   proof are part of the release; the live origin sends neither header,
   `verify:deployed:current` still answers `NOT CURRENT` (`/build-info.json` is the 1,220-byte SPA
   fallback), and the site must not be described as policied or current until a deployment carries
   both and a live header read plus a browser run on that artifact confirm them.

## CL-7 P3 — server-side security and email readiness, measured 2026-10-20

Items 12–15 of the CL-7 brief are hosted-control items, and the live half of item 16 is a deployment
question. This line holds no usable management credential, so each was audited against what it can
actually reach. None is closed; the table is the state, and the paragraphs under it are the evidence and the
action that would move each one.

| # | Item | State at this head |
| --- | --- | --- |
| 12 | Turnstile / CAPTCHA | not implemented, CAPTCHA disabled |
| 13 | Auth email delivery and capacity | two delivered messages proved; sender, reputation and capacity unmeasured |
| 14 | Site URL, redirect allow-list, password minimum, confirmation | behaviourally proved; configuration unread |
| 15 | Security and performance advisors | prior classification stands; not refreshed after migration 26 |
| 16 | CSP and HSTS on the live origin | repository half green at `698ec96`; the live suite now asserts both and is RED against the current origin |

**12 — Turnstile is a hosted control with no code in this tree, and it stays off.** A repository-wide
search for `turnstile` and `captcha` returns no tracked file, the process holds no
`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` or `VITE_TURNSTILE_SITE_KEY`, and it holds no usable
management credential: the only `SUPABASE_ACCESS_TOKEN` on disk (`~/.supabase/access-token`) is the
machine-global token already measured answering `{"message":"Invalid access token"}`, which the
standing policy forbids reusing, so it was not exercised. `/auth/v1/settings` exposes no CAPTCHA
field. The server-side enforcement the
brief asks for is a GoTrue setting written from the dashboard or the Management API, so it cannot be
completed from this line. **No token-collecting client code was added on purpose.** A widget that
gathers tokens while GoTrue accepts every request unchanged changes no outcome, cannot produce the
negative test the brief asks for — that refusal has to come from the server — and would need
`challenges.cloudflare.com` added to a CSP whose live rollout is still pending, widening production's
policy for a control that cannot run. The closing sequence is concrete: create a Turnstile widget for
`dueweave.pages.dev`; enable CAPTCHA in Supabase Auth with its secret through a scoped PAT; then ship
the widget and token forwarding on the auth calls GoTrue protects, the CSP `script-src`/`frame-src`
allowances, a no-token signup probe that must answer 400, and one real signup-confirmation plus one
recovery delivery against the owner's mailbox. Until every step has executed, CAPTCHA stays disabled
and no customer-facing readiness claim may mention it.

**13 — Email delivery is proved for two messages on 2026-10-14/15, not for the sender or its capacity.**
The credential-free read at `2026-10-20T11:35Z` still answers `disable_signup=false
mailer_autoconfirm=false external.email=true`. The rate behaviour this line can measure is the one
already recorded: a recovery request answered `HTTP 429` inside roughly a minute of a prior one on
2026-10-14, while two requests 63 seconds apart both answered `HTTP 200` on 2026-10-15 — a throttling
window exists, but its configured limits are a dashboard read. Confirmation and reset messages were
read from `dueweave@gmail.com` by the owner and their destinations measured (gates 1–2). This line
holds neither a mailbox nor an SMTP credential: `GMAIL_APP_PASSWORD` and `SMTP_PASSWORD` are absent,
and `~/.config/dueweave` holds only the production database password and two QA identity files. So
the hosted sender identity, SPF/DKIM/DMARC alignment, sender reputation, Gmail SMTP reliability and
hourly capacity are all unmeasured; Google's published free-Gmail ceiling of about 500 recipients per
day is a platform fact that may not even describe this project's sender. Closing needs one of two
reads — a scoped PAT call that returns the hosted SMTP configuration, or owner-forwarded headers from
a delivered message — followed by a paced send/receipt pair. The paced send was not made today because
it would consume the rate window and mail an address this line cannot read.

**14 — The auth URL and password values are proved by consequences, and the configuration read is still
missing.** `GET /auth/v1/settings` exposes neither `site_url`, `additional_redirect_urls` nor
`password_min_length`; today's read confirms only that email auth is enabled and confirmation is
required (`mailer_autoconfirm=false`). The values themselves remain proved by what they produced on
2026-10-14/15: the delivered confirmation link pointed at `https://dueweave.pages.dev/auth` and
completed; a control reset for an unconfigured destination was replaced by the Site URL rather than
honoured, read from the delivered mail; a seven-character password change was refused while the
eight-character replacement was accepted and used; and QA-A's recovery completed on the deployed
`/auth/update-password` route. Those are behavioural proofs, not a configuration read, and the brief
asks for verification — so a scoped PAT read of the three values remains the closing step.

**15 — The advisor classification is intact and stale by one migration.** No PAT is held, so both
advisor endpoints are unreachable today. The last hosted read (2026-10-11) recorded **25
`SECURITY DEFINER` WARN + 3 `rls_enabled_no_policy` INFO**. The 24 that existed before the erasure
migration were classified row by row as intentional and proven against the live authorization
surface, and the 25th, `delete_my_account()`, is pinned by the pgTAP grant assertions. The three INFO
are the designed deny-all founder tables. The performance side was not empty: **9 INFO at 12:42Z on
2026-10-11 — 5 unindexed foreign keys and 4 unused indexes** — each unused-index finding reconciled
one-for-one with `idx_scan`, with no index created or dropped and the five FK columns listed for
review. One security finding is easy to lose in the count and is named here as open: the pre-QA
capture carried `auth_leaked_password_protection`, the advisor's name for leaked-password protection
being **off**; it disappeared after cleanup without any Auth write, and turning it on is an owner
action. Migration 26 landed after these reads, so the counts are **unrefreshed, not current**.
Closing is one scoped-PAT re-read of security and performance, followed by classification of any lint
that is new.

**16 — CSP/HSTS is complete in the repository and absent from production as of this measurement.** At
`2026-10-20T11:36:41Z`, `HEAD https://dueweave.pages.dev/` answered HTTP 200 with **0**
`content-security-policy` and **0** `strict-transport-security` headers, and `/build-info.json` still
answered the 1,220-byte HTML fallback with `content-type: text/html` and no commit. The policy, its
browser proof and its rollback path are committed at `698ec96` (gate 10), so this is a deployment gap,
not an authoring gap. One Pages build from the pushed head closes the live half: a header read on the
served routes plus the browser run on that same artifact. The same stamp closes gate 8's
deployed-SHA row, which is why the post-deployment output is carried by the P2/P4 record rather than
promised here.

**The live suite now asks the origin, not the repository.** `e2e-live/public-release.spec.ts` reads
`client/public/_headers`, requires the `/auth` document to answer with the same CSP directives and
the identical `Strict-Transport-Security` value, and then proves the sign-in screen renders, its
webfont arrived and Chromium reported no CSP refusal. Run at `2026-10-20T11:45Z` it failed exactly
there — `the live origin sends no Content-Security-Policy`, `1 failed` — so a deployment that
predates the policy cannot satisfy it. The spec lints and type-checks at this head; the command a
reviewer can repeat is `pnpm exec playwright test -c playwright.live-public.config.ts
public-release.spec.ts -g "production serves the committed CSP"`.

**What this section does not claim.** None of items 12–15 is closed. Turnstile has no code in the
tree; email reputation, sender identity and capacity are unmeasured; the auth configuration values are
proved only by their consequences; the advisor counts are as of 2026-10-11 and migration 26 has not
been through them; and the live origin still sends neither security header. The fail-closed posture is
unchanged: public signup and recovery flags remain false in the served bundle, and Founder payments
remain disabled. No CAPTCHA was enabled, no flag was flipped and no mail was sent for this audit.

## CL-7 P4 — controlled launch and the evidence composition, measured 2026-10-20

Items 17–21 of the brief are the launch gate. This section records what was repaired so that the
gate can produce evidence, what the gate actually measured, and what is deliberately still closed.
It does not close the gate.

**The repair: one lifecycle for the served live suite, run by the local release and by CI alike.**
`pnpm test:live` includes `tests/arc3c-local-account-erasure.test.ts`, which calls `delete-account`
over HTTP, so the function has to be served — and served *after* `supabase db reset`, because the
reset removes the `supabase_edge_runtime_dueweave` container. `scripts/run-live-suite.mjs` now owns
that lifecycle: it starts `scripts/local-functions-serve.mjs`, runs `pnpm test:live`, stops the
watcher and only this project's runtime container in `finally`, and propagates a stop failure when
the suites passed. `pnpm test:live:served` names it; `pnpm verify:release:local` runs it in place of
the bare suite, and the Database contracts job in `.github/workflows/ci.yml` runs the same command in
place of its hand-managed start/suite/stop steps, so the two lifecycles cannot drift and the Linux
job becomes the wrapper's authoritative proof. The contract tests in
`tests/release-command-contract.test.ts` pin the wrapper's position after `verify:db:local`, the
absence of a bare `pnpm test:live` in the release chain, the wrapper's start/suite/stop/`finally`
content, and CI's use of the wrapper. Each assertion was watched RED before its corresponding
change: the CI assertion failed with `1 failed | 7 passed (8)` — `the database job must run the
served-live wrapper` — and the same file passed 8/8 after the workflow was edited.

**The measurements.** Teardown was proved by running the wrapper: the watcher terminated, only
`supabase_edge_runtime_dueweave` stopped, and the endpoint stopped answering in about 5.1 s. The
erasure battery in isolation, against a freshly reset database and a started serve, passed 22/22 in
25.30 s. A full live run on a fresh reset passed 331 of 332 tests; the single failure was a 503
during a runtime reload. The full `pnpm verify:release:local` on this Windows host exited 1 with
`9 failed | 323 passed (332)` — all nine failures in the erasure battery, all of the host signature
`502`/`fetch failed`, with the serve log recording 9 spurious `File change detected` events, 5
runtime setups and only 3 requests reaching the handler. The battery's own STATUS comment already
documents the same signature (24 events / 8 setups on Windows; 1 setup, 0 change events for 104
requests under WSL), and a controlled probe whose requests answered 401/400 triggered no reloads, so
the churn is a property of this host's watcher, not a product refusal. WSL was tried as the Linux
executor and is not usable here: `/var/run/docker.sock` is absent, the Docker Desktop proxy sockets
are root-only and sudo needs a password. **A green local release suite has therefore not been
obtained on this host**; the Linux CI job above is the defined executor, and its first run is the
proof that is still outstanding.

**Deployment currency.** The deployment the brief cites (`f955cacc-4471-49eb-a796-a6cffc70030a`)
serves SHA `2eed7dd`, the remote tip, which predates this line's four commits (`e5e8090`,
`1d85395`, `698ec96`, `596154c`). Measured at `2026-10-20T11:36:41Z`, that artifact sends neither
`content-security-policy` nor `strict-transport-security`, and `/build-info.json` answers the
1,220-byte SPA fallback with no commit — exactly what an artifact predating `1d85395` and `698ec96`
must do. At `2eed7dd` the repository's check-runs are its four workflows plus CodeQL; none of them
is a Pages deployment check, so GitHub carries no deployment proof for that SHA. The next pushed
head is the first artifact that can carry the stamp; `pnpm verify:deployed:current --sha <head>`
and the live `public-release.spec.ts` are the two instruments that must pass on it. A bundle that
stays stable is not thereby current, and the gate treats the two as different claims.

**What stays closed.** Public signup and recovery flags remain false in the served bundle and
Founder payments remain disabled (items 18–19). QA-A's credential remains off-repo and unprinted;
the production ledger, the database snapshots and the other project stacks were not touched; the
wrapper stops only this checkout's serve watcher and only `supabase_edge_runtime_dueweave`
(item 20). No release manifest has been produced and public activation has not been requested
(item 21): P3's items 12–15, the live CSP/HSTS half of item 16, the email sender and capacity
read, the owner's approval of `dueweave@gmail.com` as the published support address, and the
advisor re-read all remain open. The verdict below is unchanged.

## Release verdict

**NOT CERTIFIED FOR A GENERAL PUBLIC CUSTOMER LAUNCH.**

Keep the Founder payment gate fail-closed, do not advertise a 100%-ready release, and preserve
the passing local and hosted evidence. Convert every row above into a measured green gate before
signoff. This checklist is a release audit, not a guarantee that an untested line contains no bug.
