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
| Monetary dates, receivable/promise/payment history, exports, Founder refusal behavior and customer journeys | Vitest, pgTAP, DB/live, and Playwright local-stack CI gates; consult exact-head run, not earlier counts. **Amended 2026-10-14:** the advertised free-tier journey was then executed signed-in on `https://dueweave.pages.dev` as a real confirmed customer — onboarding, adding a client, promising money, recording a payment, following up and exporting — and each step was read back from `ugzdqcytouwfdlcjujqv` through `scripts/hosted-db-census.mjs --owner <qa-account>`, which answers 5 activities / 1 client / 1 promise / 1 promise event / 1 payment / 1 receivable / 1 entitlement / 1 profile and 0 analytics or Founder rows; Founder stays refused on production, and the eight-character password minimum was proved on the deployed build including a rejected seven-character attempt. **Amended 2026-10-16:** the two hosted gaps this row named are closed — production cross-tenant isolation was executed as 47 declined probes with 0 findings (`scripts/hosted-tenant-isolation.mjs`, `prod-census/isolation-1057.log`, gate 3), and one confirmed signed-in account was erased on production and proved by before/after census (`scripts/hosted-account-erasure.mjs`, gate 4) | Hosted browser acceptance executed for the single-account free-tier journey; production cross-tenant isolation and production account erasure are now measured (2026-10-16); the large-data export is still open |
| User-owned account erasure with history | Production migration 25 and transaction-rollback database acceptance. **Amended 2026-10-12:** CI's `Browser release smoke` executes the destructive path end to end at every head — `e2e/stage9-release-journey.spec.ts:505` opens the sheet, requires the exact phrase, clicks delete through the served `delete-account` function (`.github/workflows/ci.yml:160`), lands on `/auth` and is then refused sign-in with the old credentials (`✓ 80 … (1.6s)` in run `38253358122`) — which is a real cross-origin browser erasure with real Auth removal, against the **local** stack rather than production. **Amended 2026-10-16:** the same removal was executed against `ugzdqcytouwfdlcjujqv` by `scripts/hosted-account-erasure.mjs` — a confirmed, signed-in QA account erased through the served function with its own bearer and the exact phrase, judged by a census read before and after (instrument: `accounts=2 → accounts=1`, `FUNCTION … HTTP 200 status=deleted`, `own-rows none · auth-own none`, `GRANT … HTTP 400 — it no longer signs in`, exit 0; independent frozen census: `DONE 10/10 reads answered`, no `account-state` row, `rows_for_owner` 0 in every auth table, October 5 orphans preserved, QA-A's ledger unmoved). Its **first attempt answered a platform `503` and was reported as `erasure NOT proven — 12 finding(s)` with every count unchanged** rather than retried into a guess (gate 4 records the classification). The deployed sheet's guards were separately walked in headed Chromium on production — 20 checks, 0 failed, `calls=0` reaching the function | Production erasure proven by before/after census for one confirmed signed-in account (2026-10-16); the destructive submit clicked through the deployed UI on production is still open and deferred to the QA-A cleanup run, for the reason stated in gate 4 |
| Real hosted frontend source and Supabase config | Pages project production branch `release/consumer-live`, build `pnpm build`, output `dist`, active Supabase URL/publishable-key envs. **Amended 2026-10-14 at the released tip `505ff51`:** `node scripts/verify-deployed-parity.mjs --dist dist-paused --url https://dueweave.pages.dev` answers exit 0 — a flags-off build of this head reproduces the served entry `assets/index-Bv2LIPpN.js` and the lazily-loaded `assets/Auth-BIHs1b_G.js`, all 20 built files match, and both host configurations hold by effect (`_headers` with 80 live declarations honoured, `_redirects` answering `/parity-probe` with HTTP 200). The served Auth chunk is the closed-flag artifact: the registration affordance is absent from its bytes and "New registrations are temporarily paused" is present in them, so what production holds closed is proved at build time rather than inferred from a runtime conditional. **Re-measured 2026-10-15 with the tree at `51c7689` plus this instrument repair, and the exactness is checkable rather than assumed:** `git diff --name-only 505ff51 HEAD` moves no file under `client/`, `vite.config.ts`, `index.html` or `public/`, so the flags-off artifact in `dist-paused` is still the one this source line produces. The same command against `dist-paused` still answers exit 0 with all 20 files matching, but two ways this gate could lie were found by running it against the wrong directory. (1) Compared against a plain `dist`, eleven chunks now read `MISS … the file is not served by the deployed site` where the instrument used to report "495294 local bytes differ from 1222 served bytes" — Cloudflare Pages answers a path it has no file for with the SPA entry (`_redirects`: `/* /index.html 200`), so an artifact absent from the deployment still returns HTTP 200 with the fallback's 1222 bytes, and the old wording described that as a content change. Production holds the flags-off artifact, so `dist-paused` is the directory that can prove parity, and the eleven "mismatches" were my own wrong input, not a moved deployment: the served entry is still `assets/index-Bv2LIPpN.js` and the served Auth chunk still `assets/Auth-BIHs1b_G.js`. (2) The per-file digests printed are now digests of the bytes the verdict was computed on, so a pass no longer reads `SAME icon.svg local=15c80b908ebf deployed=0f0c1a24583a` — two different numbers under a SAME label, which made a correct verdict look broken — and a checkout-copied static that differs only by carriage returns says so in words. Both repairs were observed RED on the written line before going green; `tests/deployed-artifact-parity.contract.test.ts` carries 15 cases now. **Superseded on the served-entry half at `2026-10-16T14:11Z`, by measurement rather than by assumption:** this row asserted "the served entry is still `assets/index-Bv2LIPpN.js` and the served Auth chunk still `assets/Auth-BIHs1b_G.js`", and that stopped being the canonical artifact the first time a pushed head changed client source. `GET https://dueweave.pages.dev/` now names `assets/index-vEHLqm_5.js`, whose lazy map points at `assets/Auth-CP-OJQ39.js`; the previous pair is still addressable (`index-Bv2LIPpN.js` answers HTTP 200 with 495,042 bytes of `application/javascript` referencing `Auth-BIHs1b_G.js`), so Pages keeps a prior deployment's hashed assets rather than only the SPA fallback — which is exactly the shape that would let an old artifact be mistaken for the live one. The consequence for this gate is that **Pages rebuilds on every push to `release/consumer-live`**, so the deployed bytes track the branch head rather than a pinned release build, and flags-off is held by the project's build environment, not by the deployment being old: the new entry carries the `status===429` predicate shipped at `1a025bd` while the new Auth chunk still carries the pause copy. `node scripts/verify-deployed-parity.mjs --dist dist-paused` has **not** been re-run at this head, because producing `dist-paused` needs a build and this host has 215 M free on `C:`; the exact-head byte-for-byte parity claim therefore stands at the `505ff51`-era artifact and the moved entry is recorded as a measured change, not as a passing re-run. | Deployed flag state and served predicate verified on production; exact-head parity instrument re-run outstanding for want of disk, and the served entry name is now `index-vEHLqm_5.js` |
| Full ledger and downloadable archive past PostgREST 1,000-row default limit | Page-by-page queries with stable order, unit tests for 1,201 rows and errors | Code+unit gated; full live large-data export outstanding |
| Password and Auth network errors do not strand the form | Guarded `try/catch/finally` and friendly error responses. **Amended 2026-10-14:** the adverse browser-network simulation was executed against the deployed build in real Chromium with a confirmed customer session, with every REST read routed through an aborting interceptor. A cold load whose profile reads fail answers honestly after the REST client's own GET backoff (attempts measured at 0.26 s, 1.28 s, 3.31 s and 7.34 s, each `net::ERR_FAILED`) with "Couldn't load this view / Your private ledger remains protected. / We could not refresh this screen. Check your connection and try again…" and a `Try again` button, and no technical detail; retrying against a still-failing read returns that same screen with no blank or detached frame in between; retrying after the connection returns reproduces the online money brief exactly; and a client save attempted with the browser offline refuses in 581 ms with "Could not add client — We could not reach DueWeave. Check your connection and try again.", keeps the typed name on screen, re-enables Save, and leaves the hosted row census byte-identical to the one taken before the run. The wait before the error is the library's documented retry (`@supabase/postgrest-js` 2.112.3: 3 attempts, GET only, 1 s/2 s/4 s), not an application strand — money writes are POST RPCs and are never retried, so a flaky network cannot double-apply one. **Amended 2026-10-16 at `1a025bd`:** the same friendly-mapping path carried a reachable defect of its own — a customer throttled by the auth server was answered "We could not complete that request. Please try again.", which is advice that lengthens the window every time it is followed. `friendlyAuthError` recognised only the substring "rate limit", and gate 7 records that this project's 429 body has never been captured; the client library provably puts the HTTP status on the error, so the reading now keys on `status === 429` first and keeps the wording only for replies that arrive without one. Three call sites in `client/src/hooks/useSupabaseAuth.ts` (`signOut`, `resetPassword`, `updatePassword`) now pass `error.status`, and the two interpreters that already received the whole reply read it. Watched RED as 4 failures reporting the wrong sentence, then 6 cases green (`tests/confirmation-resend.test.ts`); the security contract's `friendlyAuthError(error.message)` grep was widened to tolerate the second argument, not deleted, so it still fails if the hook stops mapping refusals into friendly copy. **Live re-measurement at `2026-10-16T14:11Z` corrected this row's own first claim about the bundle:** the canonical served entry is now `assets/index-vEHLqm_5.js` (495,166 bytes) and its bytes carry the minified predicate — `function iy(i){return i.status===429||i.message.toLowerCase().includes("rate limit")}` — so the repair is deployed, not merely unit-gated; and the chunk that entry lazy-loads, `assets/Auth-CP-OJQ39.js` (10,026 bytes), still contains "New registrations are temporarily paused" and contains no "Create an account", so what shipped is still flags-off. | Network path and refusal copy verified on deployed production, with the `status===429` predicate read out of the served bytes at `14:11Z` |

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
   `node scripts/hosted-auth-status.mjs --identity <qa-identity> --request-recovery` asks the hosted
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
   chose into the file. **The instrument that printed the wrong inference has been repaired:**
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
5. **Founder monetization:** Production readiness deliberately reports `false`; no actual live
   UPI destination, approved support/refund/disclosures or reviewer allowlist. Do not collect or
   represent real Founder payments as enabled. Finish operator decisions and perform refund/manual
   review tests separately, or explicitly release only the free plan without a purchasable offer.
6. **Customer trust, support and compliance:** Publish an accurate privacy policy, terms,
   data-retention and deletion policy, and real reachable support address. Verify jurisdiction and
   payment disclosures with the business operator; do not invent a support mailbox or payment details.
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
   here; the restore rehearsal needs a host with working Docker and free disk. (b) Row data has never been
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
9. **Temporary QA cloud cleanup:** `DueWeave Validation` was paused but is **not confirmed
   permanently deleted**; this administrative cleanup remains open.

## Release verdict

**NOT CERTIFIED FOR A GENERAL PUBLIC CUSTOMER LAUNCH.**

Keep the Founder payment gate fail-closed, do not advertise a 100%-ready release, and preserve
the passing local and hosted evidence. Convert every row above into a measured green gate before
signoff. This checklist is a release audit, not a guarantee that an untested line contains no bug.
