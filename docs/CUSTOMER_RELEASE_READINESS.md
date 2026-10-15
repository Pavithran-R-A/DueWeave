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
| Monetary dates, receivable/promise/payment history, exports, Founder refusal behavior and customer journeys | Vitest, pgTAP, DB/live, and Playwright local-stack CI gates; consult exact-head run, not earlier counts. **Amended 2026-10-14:** the advertised free-tier journey was then executed signed-in on `https://dueweave.pages.dev` as a real confirmed customer — onboarding, adding a client, promising money, recording a payment, following up and exporting — and each step was read back from `ugzdqcytouwfdlcjujqv` through `scripts/hosted-db-census.mjs --owner <qa-account>`, which answers 5 activities / 1 client / 1 promise / 1 promise event / 1 payment / 1 receivable / 1 entitlement / 1 profile and 0 analytics or Founder rows; Founder stays refused on production, and the eight-character password minimum was proved on the deployed build including a rejected seven-character attempt | Hosted browser acceptance executed for the single-account free-tier journey; cross-tenant isolation and account erasure **on production**, and the large-data export, are still open |
| User-owned account erasure with history | Production migration 25 and transaction-rollback database acceptance. **Amended 2026-10-12:** CI's `Browser release smoke` executes the destructive path end to end at every head — `e2e/stage9-release-journey.spec.ts:505` opens the sheet, requires the exact phrase, clicks delete through the served `delete-account` function (`.github/workflows/ci.yml:160`), lands on `/auth` and is then refused sign-in with the old credentials (`✓ 80 … (1.6s)` in run `38253358122`) — which is a real cross-origin browser erasure with real Auth removal, against the **local** stack rather than production | Browser side executed on the local stack; the same run against `ugzdqcytouwfdlcjujqv` with a before/after row census is still open |
| Real hosted frontend source and Supabase config | Pages project production branch `release/consumer-live`, build `pnpm build`, output `dist`, active Supabase URL/publishable-key envs. **Amended 2026-10-14 at the released tip `505ff51`:** `node scripts/verify-deployed-parity.mjs --dist dist-paused --url https://dueweave.pages.dev` answers exit 0 — a flags-off build of this head reproduces the served entry `assets/index-Bv2LIPpN.js` and the lazily-loaded `assets/Auth-BIHs1b_G.js`, all 20 built files match, and both host configurations hold by effect (`_headers` with 80 live declarations honoured, `_redirects` answering `/parity-probe` with HTTP 200). The served Auth chunk is the closed-flag artifact: the registration affordance is absent from its bytes and "New registrations are temporarily paused" is present in them, so what production holds closed is proved at build time rather than inferred from a runtime conditional | Exact-head deployed parity and served flag state verified on production |
| Full ledger and downloadable archive past PostgREST 1,000-row default limit | Page-by-page queries with stable order, unit tests for 1,201 rows and errors | Code+unit gated; full live large-data export outstanding |
| Password and Auth network errors do not strand the form | Guarded `try/catch/finally` and friendly error responses. **Amended 2026-10-14:** the adverse browser-network simulation was executed against the deployed build in real Chromium with a confirmed customer session, with every REST read routed through an aborting interceptor. A cold load whose profile reads fail answers honestly after the REST client's own GET backoff (attempts measured at 0.26 s, 1.28 s, 3.31 s and 7.34 s, each `net::ERR_FAILED`) with "Couldn't load this view / Your private ledger remains protected. / We could not refresh this screen. Check your connection and try again…" and a `Try again` button, and no technical detail; retrying against a still-failing read returns that same screen with no blank or detached frame in between; retrying after the connection returns reproduces the online money brief exactly; and a client save attempted with the browser offline refuses in 581 ms with "Could not add client — We could not reach DueWeave. Check your connection and try again.", keeps the typed name on screen, re-enables Save, and leaves the hosted row census byte-identical to the one taken before the run. The wait before the error is the library's documented retry (`@supabase/postgrest-js` 2.112.3: 3 attempts, GET only, 1 s/2 s/4 s), not an application strand — money writes are POST RPCs and are never retried, so a flaky network cannot double-apply one | Verified on deployed production |

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
   refused, because its one-time token had already been spent. What this gate still lacks is
   **password-recovery** delivery to a real mailbox — untestable through the product while the
   deployed bundle holds the recovery entry closed — and the SPF/DKIM/DMARC properties, which are
   provider-console facts no probe from this repository can read. The request side is now an
   executable, repeatable step rather than a hand command:
   `node scripts/hosted-auth-status.mjs --identity <qa-identity> --request-recovery` asks the hosted
   sender for a reset mail at `https://dueweave.pages.dev/auth/update-password`, which is the
   destination `client/src/hooks/useSupabaseAuth.ts:83` asks GoTrue for and the only route that
   renders the password form; the run answered `RECOVER redirect_to=… HTTP 200` twice, and a repeat
   inside roughly a minute answers `HTTP 429` instead. **That 200 is not evidence the link lands on
   DueWeave** — see gate 2's measured control.
   **Second identity created through the public API, and its confirmation is still owed 2026-10-14:**
   `dueweave+releaseqa-b-20261014@gmail.com` (`81a37c9e-9103-4e4c-b89c-3991965da1cd`) was created by
   `POST /auth/v1/signup` — the same call a customer's browser makes, not an admin insert — and the
   answer carried a user object with **no session**, which is what a confirmation-required project
   returns. The census on `ugzdqcytouwfdlcjujqv` read it back rather than trusting that response:
   `auth.users` 1 → 2 and `unconfirmed` 0 → 1, with `profiles` and `entitlements` each 1 → 2. The
   credential-bearing probe then refused it: `GRANT … HTTP 400 — sign-in refused ("Invalid login
   credentials"), so confirmation is still required`, while the same probe for QA-A answers HTTP 200.
   So this identity is real, is not confirmed, and cannot be signed in with — the second half of gate
   1 is genuinely open for it, not merely undocumented.
   **How it gets closed, measured from the GoTrue source rather than assumed:** this project runs
   GoTrue v2.197.0 (`supabase/.temp/gotrue-version`), whose `internal/api/verify.go` `recoverVerify`
   runs `user.Recover(tx)` and then, `if !user.IsConfirmed()`, logs `UserSignedUpAction` and calls
   `user.Confirm(tx)`. Completing a password recovery therefore **confirms an unconfirmed address**, so
   one mailbox action on the reset link already requested for it at `2026-10-14T15:07:03Z`
   (`RECOVER … HTTP 200`) both sets a usable password and closes the confirmation — no management
   credential is needed. That corrects an earlier claim on this very gate, which held that this
   identity required an admin `deleteUser` because a first signup attempt was misread: the script looked
   for `json.user` while GoTrue returns the user at the top level when confirmation is required, and the
   account existed all along, as the census above shows. It also corrects gate 3's flag reasoning,
   because the recovery **completion** route is not flag-gated at all (see gate 3).
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
   **Closed 2026-10-14 by the mailbox read, not by a status code:** the operator read the delivered
   messages in the connected DueWeave mailbox (`dueweave@gmail.com`, which also receives the QA
   identities' plus-addressed mail) — this is the operator's report of the mailbox contents, not a
   reading this repository can make itself. The request carrying the approved destination produced a
   reset link pointing at `https://dueweave.pages.dev/auth/update-password`; the control request
   carrying `redirect_to=https://redirect-control-not-configured.example/…` produced a link pointing
   instead at the configured Site URL, `https://dueweave.pages.dev`. The
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
     replaces its retry button with a note, and `client/src/pages/Home.tsx:271,381` refuses the
     settings-screen action. The **completion** route reads its mode from the address
     (`client/src/pages/Auth.tsx:38`, `location.includes("update-password")`) and shows the password
     form to any browser holding a recovery session, with no flag consulted. So a reset link requested
     by the operator instrument (`scripts/hosted-auth-status.mjs --request-recovery`) can be opened and
     used on the bundle production serves today, and the new-works/old-fails pair is measurable.
   - What the flag genuinely still gates is self-service: a locked-out customer asking for their own
     reset link from the deployed UI, and a new customer creating an account from that UI. Those two
     journeys cannot be walked before the owner opens the flags, and the flag-flip row below stays the
     place where they get proved on the released SHA.
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
   census, is still open. That removal is **not** missing a mechanism: CI already runs it on the local
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
8. **Release governance:** Reconcile the long-lived `main` branch, branch/PR protection, final
   changelog and operations rollback; verify head==GitHub CI SHA==Pages deployed SHA, all intended
   gates pass, and no secret is in Git or client assets. The repository is temporarily public for
   hosted Actions and must not silently be called private.
9. **Temporary QA cloud cleanup:** `DueWeave Validation` was paused but is **not confirmed
   permanently deleted**; this administrative cleanup remains open.

## Release verdict

**NOT CERTIFIED FOR A GENERAL PUBLIC CUSTOMER LAUNCH.**

Keep the Founder payment gate fail-closed, do not advertise a 100%-ready release, and preserve
the passing local and hosted evidence. Convert every row above into a measured green gate before
signoff. This checklist is a release audit, not a guarantee that an untested line contains no bug.
