# Stage 8 — Founder monetization readiness, operator safety and payment-claim qualification

Brief: DUEWEAVE roadmap Stage 8, "FOUNDER MONETIZATION READINESS / OPERATOR SAFETY / PAYMENT-CLAIM QUALIFICATION" (PHASES 0–90, D-S8-1/2/3). Every gate below was executed against the local Supabase stack on this machine. No real money was collected, no real payment destination was written, and no real reviewer account was configured.

## STATUS

PASS with disclosed caveats. All 90 phases were executed. Three findings are recorded. D-S8-1 (open-UPI-is-not-payment): the invariant was already honored by the shipped client, so its RED answer is NO — what was missing was any guarantee pinning it, and the one real defect found in that area is the payment URI's float-computed amount, reproduced and fixed. D-S8-2: the delivered database could not store `LIVE` at all — reproduced RED, fixed by one forward migration. D-S8-3: a same-instant two-tab reviewer race is unmeasurable on the qualification machine — resolved by proving the race with two concurrent authenticated clients instead, and disclosed as an observation limit, not a product claim.

The product verdict is that the Founder path is correctly fail-closed and safe to qualify, and it is NOT READY to take money. Six owner-side terms remain unmet in the delivered row, and the two things no column can prove (a real reviewer identity and an independent VPA check against the business bank account) are still outstanding. The full list is in LIVE-ACTIVATION CHECKLIST and OWNER-SIDE BLOCKERS.

Caveats that stop this being a clean PASS are listed under KNOWN LIMITATIONS. None of them is a payment-safety defect; three are observation limits of this machine, and four are product gaps deliberately left open rather than silently patched.

## STARTING SHA

`68a3cbb76c459c1e5eb1986f2ff7b4836a1b4c16` — the accepted, pushed Stage 7 HEAD (`current-stage-7-followup-portability`), which is where Stage 8 began.

## ENDING SHA treatment

A commit cannot contain its own hash, so this report does not print one. The ending SHA is the commit that contains this file (PHASE 89, parent `68a3cbb`). Read it with:

```bash
git rev-parse HEAD                                               # ending SHA
git rev-parse HEAD origin/current-stage-8-founder-readiness      # must be identical (PHASE 90)
```

## BRANCH

`current-stage-8-founder-readiness`. `main` was not modified. No PR was created. Nothing was merged. No tag was created. No deployment was run.

## BASELINE

Re-measured on the starting SHA before any Stage 8 code was written:

| Gate | Baseline on `68a3cbb` |
| --- | --- |
| `pnpm test` | 494 passed / 1 skipped |
| `pnpm test:db` (pgTAP) | 5 files, 229 tests, PASS |
| Migrations applied from zero | 21 |
| Generated types sha256 | `10dd590052d68d997a43a01f5ff3ca17257226beca01bc95af81b3efd185e328` |
| Delivered `FOUNDER_V1` row | PLACEHOLDER / `upi_id` NULL / 49900 / cap 50 / support PENDING / refund PENDING_APPROVAL / disclosures PENDING / enabled true |
| `founder_admins` rows | 0 |
| Local stack | Docker on `127.0.0.1:54321` (Kong), `vite preview` over `dist/` at `127.0.0.1:3000` |

Stage 8 adds 109 unit/live tests and 67 pgTAP assertions over that baseline.

## FOUNDER OFFER EXECUTED STATE

Measured from the running local Postgres after a full Stage 8 browser pair and again after zero replay (`docker exec -i supabase_db_dueweave psql -U postgres -d postgres`), both identical:

| Column | Delivered value |
| --- | --- |
| `offer_key` | `FOUNDER_V1` |
| `enabled` | `true` |
| `payment_destination_status` | `PLACEHOLDER` |
| `upi_id` | NULL |
| `payee_name` | `DueWeave` |
| `amount_paise` | `49900` |
| `founder_cap` | `50` |
| `support_contact_status` | `PENDING` |
| `support_contact` | `Support contact not configured` |
| `refund_policy_status` | `PENDING_APPROVAL` |
| `refund_policy_text` | NULL |
| `disclosures_status` | `PENDING` |

`founder_admins` 0 rows · `purchase_claims` 0 rows · FOUNDER `entitlements` 0 rows · `auth.users` 0 rows after replay.

## DEFAULT PAYMENT DESTINATION

`PLACEHOLDER`, with `upi_id` NULL. The delivered build therefore renders the non-payable state: no QR, no UPI link, no claim creation, no payment submission. The pairing check on the table makes `PLACEHOLDER` with a VPA, and `LIVE`/`TEST` without one, inexpressible in storage.

## PRICE

`49900` paise = ₹499.00, one-time. One authority in code (`client/src/lib/founder-readiness.ts:3` `FOUNDER_PRICE_PAISE`) replaces the two that existed at the start (a `BRAND` literal and a private constant in the payment helper); `client/src/config/brand.ts` no longer carries a price, and `client/src/pages/Home.tsx:334` renders the pinned constant instead of a typed rupee string. The URI amount is computed with integer arithmetic (`client/src/lib/founder-payment.ts:17-22`), because `(paise / 100).toFixed(2)` drifts above `Number.MAX_SAFE_INTEGER` and a payment URI must never guess the amount — pinned by `client/src/lib/founder-payment.test.ts:57`.

## SUPPORT STATUS

`PENDING`, with the sentence `Support contact not configured` sitting in `support_contact`. This is a placeholder state, not a gap-free one: the column is non-empty so a naive check would pass it, which is why the readiness model has a separate `support-contact-unusable` term (`client/src/lib/founder-readiness.ts:41-42`) and the checklist marks the item `placeholder` rather than `gap` (docs/FOUNDER_LIVE_ACTIVATION_CHECKLIST.md, item `support-contact-unusable`).

## REFUND STATUS

`PENDING_APPROVAL` with `refund_policy_text` NULL. The customer surface shows the honest heading and no invented terms. The database refuses an APPROVED status with no text, and text shorter than 40 characters under an approved policy (`supabase/tests/stage8_01_offer_readiness.sql`), so "approved" cannot be recorded as an empty gesture. No legal wording was written on the owner's behalf in this stage.

## DISCLOSURE STATUS

`PENDING`. `buildFounderUpiPayload` and the payment card both require APPROVED disclosures, so a customer cannot be shown a pay-now affordance while the consumer terms are unapproved (`client/src/lib/founder-readiness.ts:46`, asserted in `tests/stage8-founder-contracts.test.ts:130`).

## REVIEWER STATUS

No real reviewer is configured: `founder_admins` has 0 rows, and the delivered account population is 0. Every reviewer in this stage is a synthetic local account created by the test harness with a run-tagged email (`stage8e2e-*@dueweave.local`), allowlisted by one direct insert into `founder_admins`, and purged in `afterAll`. Reviewer access is proven to be that row and nothing else: the same browser account is refused the queue before the row exists and served the queue after it (`e2e/stage8-local-founder-reviewer.spec.ts:202`).

## MIGRATION COUNT

22 migrations, one added by this stage: `supabase/migrations/20260927090000_current_stage8_offer_destination_readiness.sql`. The brief expected 21 "unless Phase 68 proved a new migration was mandatory"; D-S8-2 is that proof (see the D-S8-2 section). The whole body of the new migration is one statement:

```sql
alter table public.founder_offer_config
    drop constraint founder_offer_config_check;
```

It creates no object, changes no privilege, policy, RLS setting, function, row or default, and turns nothing on.

## GRANT/RLS MAP

Re-measured against the post-replay database:

| Table | RLS | anon S/I | authenticated S/I/U/D |
| --- | --- | --- | --- |
| `founder_offer_config` | on | f / f | f / f / f / f |
| `founder_admins` | on | f / f | f / f / f / f |
| `founder_audit_events` | on | f / f | f / f / f / f |
| `purchase_claims` | on | f / f | t / f / f / f (one policy: `purchase_claims_select_own`) |
| `entitlements` | on | f / f | t / f / f / f |
| `analytics_events` | on | f / f | t / f / f / f |

All 14 `*founder*` functions are `SECURITY DEFINER`, owner `postgres`, with a fixed `search_path`; `anon` holds EXECUTE on none of them, `authenticated` on all, `service_role` on all. No customer table is writable through REST: every Founder state change goes through an RPC that re-checks the caller, the readiness conjunction and the offer match inside the transaction. This is the Stage 3 fail-closed default-privilege model, unchanged.

## CUSTOMER CLAIM STATE MACHINE

`DRAFT → PENDING_REVIEW → APPROVED | REJECTED`, with `DRAFT → CANCELLED` as the only exit a customer controls.

- `create_founder_claim` opens (or returns the already-open) DRAFT carrying the offer's commercial facts; nothing else is reachable (`tests/stage8-local-founder-readiness.test.ts:506`, `:522`).
- `submit_founder_payment` requires the claim to be an unsubmitted DRAFT that still matches the configured offer, plus a valid reference, a payer name, and the full readiness conjunction (`:565`, `:597`, `:742`).
- A submitted claim cannot be resubmitted or cancelled (`:582`), and an approved claim cannot be reopened by the customer (`:894`).
- Direct writes are refused: the customer has no UPDATE/DELETE grant at all, and the trigger layer refuses any attempt to move a claim outside the workflow (`:787`, `:1119`).

## REVIEWER STATE MACHINE

`PENDING_REVIEW → APPROVED` (entitlement + audit + analytics atomically), `PENDING_REVIEW → REJECTED`, `REJECTED → APPROVED` only with the explicit bank-verification flag, `APPROVED entitlement → REVOKED`.

- Approval requires `founder_admins` membership, a pending claim, an offer match, and a free seat, in that order of refusal (`:860`, `:913`).
- Reconsideration refuses without `p_bank_history_verified` and keeps the original UTR, payer and rejection history (`:985`, `:1011`).
- Revocation writes an audit event, keeps the claim and history rows, and re-applies the Free limit (`:1055`, `:1078`).
- A cross-state attempt (approve an already-rejected claim, reject an approved one, reconsider a pending one) raises and is mapped to its own product sentence (`client/src/data/supabase-adapters.ts:117-122`, `client/src/data/supabase-adapters.test.ts:142`).

## PAYMENT INTENT TRUTH

Nothing that a browser can observe is treated as payment. `window.location` assignment, a deep-link open, a QR scan, a UPI app return, a visibility change, a focus return and a timer are all excluded as status sources: the claim stays DRAFT until the customer types a reference, and stays PENDING_REVIEW until a reviewer acts (`tests/stage8-founder-contracts.test.ts:72` asserts no `visibilitychange`, `pageshow`, focus or interval handler exists in the customer page; `:85` asserts approval stays on the reviewer's screen). `tests/stage8-local-founder-readiness.test.ts:541` proves the stronger property: an opening claim is state-neutral through every read and view-recording call.

## D-S8-1 OPEN UPI != PAYMENT — RED / FIX / GREEN

Answer to the brief's `D-S8-1 … RED: YES / NO` line: NO for intent inference, and that is a measured answer, not an assumption. `git show 68a3cbb:client/src/pages/FounderPurchase.tsx` carries no `visibilitychange`, `pageshow`, `focus`, `blur` or `setInterval` handler and no write beside the three claim RPCs, so the shipped client never treated a launched intent as a payment. The defect that mattered was the missing guarantee, not a present lie: the property was true by construction and nothing pinned it, so any later change could break it silently. Stage 8 converts it into enforced truth at three layers, and found one real payment-URI defect in the process.

- RED (payment URI): the baseline built the amount with `(configuration.amountPaise / 100).toFixed(2)` (`git show 68a3cbb:client/src/lib/founder-payment.ts:23`). Measured in Node: `45035996273704960` paise yields `450359962737049.63` where the exact rupee value is `450359962737049.60` — a 3-paise drift, because the float cannot carry the integer. A payment URI that guesses the amount is a payment lie waiting for an unusual input, and the price authority is the same column for every customer.
- FIX: integer-only paise arithmetic (`client/src/lib/founder-payment.ts:17-22`), a `Number.isSafeInteger` guard that returns an empty URI rather than a rounded one (`:24-27`), and one readiness gate in front of the builder (`:39`).
- GREEN: `client/src/lib/founder-payment.test.ts:57` (unsafe integers refused, not silently re-priced) and `:66-76` (every safe paise sample, including `Number.MAX_SAFE_INTEGER` and values just below it, encodes the exact rupee text). The invariant itself is pinned by `e2e/stage8-local-founder-customer.spec.ts:288`, which clicks Open UPI and then dispatches `visibilitychange`, `focus`, `pageshow` and `focusin` at the tab: no money write reaches the network, the claim stays DRAFT, the plan stays `FREE:ACTIVE`, the audit set stays `["CLAIM_CREATED"]`, and a reload still shows the reference form and never "Payment submitted for review" or "Founder Lifetime is active". `tests/stage8-local-founder-readiness.test.ts:541` proves the server half — every read and view-recording call leaves the claim byte-identical. `tests/stage8-founder-contracts.test.ts:72` fails the build if any return-path listener is ever added to the client, and `submit_founder_payment` is asserted reachable from exactly one repository file. pgTAP `supabase/tests/stage8_02_payment_evidence.sql` (22 assertions) closes the loop: no path from an intent can set a claim to APPROVED.

## PLACEHOLDER FAIL-CLOSED

With the delivered row, `get_founder_offer` reports the destination as not configured, `create_founder_claim` raises `Founder payment instructions are not ready yet`, and `submit_founder_payment` raises `Payment instructions are not ready for submission` (`tests/stage8-local-founder-readiness.test.ts:407`). The customer page shows `Do not send money yet` with no QR and no link (`tests/stage8-founder-contracts.test.ts:112`, browser `:133`). The gate is evaluated at call time inside the RPC, so a stale client cannot pre-open it.

## PARTIAL READINESS MATRIX

13 configurations were each written to the live local row and probed through both RPCs; each one either blocks with the named refusal or cannot be stored at all (`tests/stage8-local-founder-readiness.test.ts:455-497`): offer disabled; destination back to PLACEHOLDER; destination in TEST; support status PENDING; support address 2 characters; refund withdrawn; disclosures withdrawn; LIVE with no VPA; LIVE with a whitespace VPA; LIVE with no payee; price 49901; cap 0; refund text approved at 20 characters. The last five are refused by table checks — a stronger guarantee than an RPC test, because the incomplete state is inexpressible in storage. All 13 pass; one missing precondition blocks the QR, the link, claim creation and submission.

## TEST MODE

`TEST` is storable and pairs with a VPA, but is not payment-ready: `isFounderPaymentReady` requires `LIVE` (`client/src/lib/founder-readiness.ts:36`), so a TEST destination shows the customer the non-payable state exactly like PLACEHOLDER does, while letting an operator exercise the reviewer workflow end to end. Every Stage 8 fixture uses TEST + the synthetic `dueweave-test@upi`; none uses LIVE. Matrix case "destination in synthetic TEST mode" is asserted live (`tests/stage8-local-founder-readiness.test.ts:460`).

## CLAIM IDEMPOTENCY

Calling `create_founder_claim` twice returns the same open claim id, and two further calls from two separate client instances fired together still leave exactly one claim in an open state — DRAFT or PENDING_REVIEW (`tests/stage8-local-founder-readiness.test.ts:522`). Re-submitting a submitted claim is refused without changing it (`:582`). Browser: reload, sign out and sign in again leave the same claim pending with the same reference (`e2e/stage8-local-founder-customer.spec.ts:377`).

## CUSTOMER CROSS-TENANT ATTACK

One account cannot read, submit, cancel or approve another's claim; each attempt is refused and leaks nothing (`tests/stage8-local-founder-readiness.test.ts:757`, direct-write attempts `:787`). A second customer sees no claim, no reference and no payer name in the browser (`e2e/stage8-local-founder-customer.spec.ts:401`), and the reviewer's own account is an ordinary customer for everyone else's ledger (`:1174`).

## UTR NORMALIZATION

Stored as trim → remove interior spaces → uppercase, with the payer name trimmed. Boundary cases proved live: padded lowercase input, `AB 12 34` → `AB1234`, a 6-character reference, a 64-character reference, and a payer name with mixed Unicode (`tests/stage8-local-founder-readiness.test.ts:634`). Character sets outside letters/digits/hyphens are refused and leave the draft untouched (`:597`).

## DUPLICATE UTR

A reference already submitted is refused across accounts and after a rejection, so a rejected customer cannot re-submit the same proof (`tests/stage8-local-founder-readiness.test.ts:685`). Browser refusal is in product language: `That payment reference has already been submitted.`

## CONCURRENT DUPLICATE UTR

Two accounts racing on one reference produce exactly one accepted submission and one refusal (`tests/stage8-local-founder-readiness.test.ts:662`), enforced by the partial unique index plus the transaction, not by a read-then-write check in the client.

## PENDING REVIEW

A submitted reference lands as `PENDING_REVIEW` with no entitlement, no seat consumed, and no Founder access (`tests/stage8-local-founder-readiness.test.ts:565`). The queue shows the reviewer exactly the fields needed for a bank check and nothing else (`:841`), and the customer page says the reference is queued for manual verification without implying success (`e2e/stage8-local-founder-customer.spec.ts:345`).

## NON-REVIEWER DENIAL

Every reviewer RPC is refused for an ordinary authenticated account, in product language, with no internal vocabulary in the message (`tests/stage8-local-founder-readiness.test.ts:816`). In the browser the same account is shown `Founder review is restricted.` before its allowlist row exists and the queue after it (`e2e/stage8-local-founder-reviewer.spec.ts:202`); the denial text is asserted not to contain `PGRST`, `SQLSTATE`, `constraint`, `policy`, `founder_admins`, a role name or a UUID.

## APPROVAL ATOMICITY

One approval writes the claim transition, the FOUNDER entitlement, the reviewer identity, the audit event and the activation analytics event in the same transaction, or none of them (`tests/stage8-local-founder-readiness.test.ts:860`). The browser journey reads all five back from the database after the click rather than trusting the page (`e2e/stage8-local-founder-reviewer.spec.ts:329`).

## APPROVAL IDEMPOTENCY

A repeat approval creates no second entitlement, consumes no second seat and writes no second activation event (`tests/stage8-local-founder-readiness.test.ts:877`). Disclosed as product gap 3: the repeat call returns the claim unchanged, which is correct on the database side, but the toast then says the entitlement and audit entry "were written atomically" for what was a no-op. The wording is misleading; the state is not.

## FOUNDER CAP

`available_spots = greatest(0, founder_cap − active FOUNDER entitlements)` inside `get_founder_offer` (`supabase/migrations/20260813030000_stage4_founder_monetization.sql:139`). Proved live: with the delivered cap of 50 and at least one active Founder, `get_founder_offer.available_spots` equals `cap − active` exactly (`tests/stage8-local-founder-readiness.test.ts:902`), and in the browser: the last seat is taken once and the next review is refused `The verified Founder offer is currently full.` with its claim left PENDING (`e2e/stage8-local-founder-reviewer.spec.ts:411`).

## CAP CONCURRENCY

Two customers submit references, the cap is set to leave exactly one remaining seat, and two different reviewer accounts fire `approve_founder_claim` concurrently: one is accepted, one is refused with `The verified Founder offer is currently full`, the active Founder count lands at cap, exactly one claim is APPROVED, and the loser is still approvable once capacity is restored — so losing a race is not losing a claim (`tests/stage8-local-founder-readiness.test.ts:913`). The mechanism is `pg_advisory_xact_lock(hashtext('dueweave-founder-seat-cap'))` plus `select … for update` on both the offer row and the claim, so the two writers cannot both read a free seat. Ordering is deterministic: the status check precedes the cap check, so a stale card gets "already reviewed", not "full" (`supabase/migrations/20260813030000_stage4_founder_monetization.sql:261-265`).

Browser same-instant simultaneity is not claimed — see D-S8-3.

## REJECTION

Rejecting a pending claim records the reviewer, timestamp, note and audit event, grants no entitlement, leaves the account FREE, keeps the stored reference, and tells the customer in product language (`tests/stage8-local-founder-readiness.test.ts:945`; browser `e2e/stage8-local-founder-reviewer.spec.ts:260`). Reviewer detail stays out of the customer's read (`:967`).

## RECONSIDERATION

A rejected claim can be approved only by a reviewer who explicitly asserts independent bank-history verification; without the flag the write is refused, and the original UTR, payer and rejection history are preserved alongside the new events (`tests/stage8-local-founder-readiness.test.ts:985`). Non-rejected states refuse reconsideration (`:1011`). The browser proves the flag is machine-enforced, not decorative: `Approve after recheck` is disabled until `I independently verified this payment in business bank history.` is ticked (`e2e/stage8-local-founder-reviewer.spec.ts:296`).

## RECONSIDERATION AUDIT

Reconsideration appends: the original `CLAIM_CREATED` / `CLAIM_SUBMITTED` / `CLAIM_REJECTED` events remain, and `CLAIM_RECONSIDERED` plus `CLAIM_APPROVED_AFTER_REVIEW` are added, with the reviewer identity and the verification flag recorded (`tests/stage8-local-founder-readiness.test.ts:985`, `:1119`; browser `:486` reads the exact event set back from `founder_audit_events`).

## REVOCATION

`revoke_founder_entitlement` requires a trusted reviewer, requires the explicit bank-verification argument, writes `ENTITLEMENT_REVOKED` with a reason, and deletes nothing: the claim, the audit trail and the historical entitlement row all remain (`tests/stage8-local-founder-readiness.test.ts:1055`; browser `e2e/stage8-local-founder-reviewer.spec.ts:356`, which performs the revocation through the reviewer's own authenticated session — the browser's anon key plus that account's bearer token captured from a request the app already made, never a service role — and asserts the gap that no control on the screen does it).

## POST-REVOCATION FREE LIMIT

After revocation the Free plan limit applies again (3 active receivables), the 4th is refused, and both the pending and rejected queues are re-checked (`tests/stage8-local-founder-readiness.test.ts:1078`; browser `:356`). No ledger row is deleted by the revocation.

## AUDIT IMMUTABILITY

`founder_audit_events` is not writable by `anon` or `authenticated` at all, and an attempt to rewrite or delete an existing event from a protected path raises `Founder claim history is immutable` (`tests/stage8-local-founder-readiness.test.ts:1119`; pgTAP `supabase/tests/stage8_03_reviewer_boundaries.sql`).

## CLAIM IMMUTABILITY

Commercial facts on a claim (owner, offer key, amount, currency) are frozen by both grants and a trigger: `Founder claim identity and offer terms are immutable` (`tests/stage8-local-founder-readiness.test.ts:787`, `:742`). A claim taken while the offer said 49900 still says 49900 after the offer is changed.

## ANALYTICS PRIVACY

Founder analytics carry event names and bounded, non-commercial detail only: no UTR, no payer name, no VPA, no claim id (`tests/stage8-local-founder-readiness.test.ts:1134`; `tests/stage8-founder-contracts.test.ts:142`; pgTAP `supabase/tests/stage8_02_payment_evidence.sql`). The funnel counts by real event names and calls none of them revenue (`:1153`), and the review screen renders each counter as the number stored for it, read back from the database (`e2e/stage8-local-founder-reviewer.spec.ts:224`).

## EXPORT REGRESSION

Stage 7's export and privacy suites were re-run against the Stage 8 tree: `e2e/stage7-local-export.spec.ts` 13 passed (`../stage8-artifacts/e2e-stage7-export.log`, `--workers=1`, 4.0m) including the five-width fit of the "Your data" section, and `tests/stage7-*` unit/live files pass inside `pnpm test`. No Stage 7 assertion was weakened, skipped or re-scoped for Stage 8.

## BROWSER STORAGE

The whole customer journey leaves no payment facts in browser storage: `localStorage`, `sessionStorage` and `indexedDB` are enumerated after the run and contain no UTR, payer name, VPA or claim id (`e2e/stage8-local-founder-customer.spec.ts:526`). The reference lives in component state only (`tests/stage8-founder-contracts.test.ts:173`), and no Founder value is written to a log.

## REVIEWER LOGOUT/BACK

Signing out, pressing Back, and a signed-out customer hitting `/admin/founder-claims` all leave no queue, no claim text and no reviewer chrome on screen (`e2e/stage8-local-founder-reviewer.spec.ts:556`).

## REVIEWER PRIVILEGE BOUNDARY

A reviewer account has no generalized cross-tenant ledger power: it reads only the claim fields the review RPCs return, cannot select another account's receivables, and is an ordinary customer for everyone else's data (`tests/stage8-local-founder-readiness.test.ts:816`, `:1174`; pgTAP `supabase/tests/stage8_03_reviewer_boundaries.sql`, 13 assertions). In the browser, an unauthorized read attempt is refused at the network layer and the refusal is excused by RPC path, never by status code, so an unexpected failure elsewhere still fails the journey.

## UPI PAYLOAD

`upi://pay?pa=…&pn=…&am=499.00&cu=INR&tn=…`, built only from a ready offer, with the amount produced by integer paise arithmetic and every field URL-encoded by `URLSearchParams` (`client/src/lib/founder-payment.ts:24-36`). Empty output — not a partial URI — when any input is unusable (`client/src/lib/founder-payment.test.ts:113`). The synthetic value tested is `dueweave-test@upi` with `₹499.00`; no real address was ever encoded.

## QR PAYLOAD

The QR image and the UPI link are generated from the same string, and the browser compares them pixel for pixel after decoding (`e2e/stage8-local-founder-customer.spec.ts:203`, 6.2s in the final pair run). A QR that decodes to something other than the link the customer could copy is therefore a visible failure, not an assumption. Note that decoding proves the two artifacts agree with each other; it does not prove the address belongs to the business — that is an owner-side independent check.

## PRICE DISCLOSURE

₹499.00 is rendered from the offer amount at every surface that mentions price: the payment card header, the QR block, the disclosures strip ("Founder Lifetime · ₹499.00 once"), and the settings row that routes to Founder (`client/src/pages/Home.tsx:334`). The browser asserts the displayed price against the stored paise value, not against a literal (`e2e/stage8-local-founder-customer.spec.ts:178`).

## SUPPORT GATE

`support_contact_status = CONFIGURED` plus an address of at least 3 usable characters is a term of the conjunction; with the delivered PENDING state the payment surface stays closed and the customer sees `Support contact will be available before payments open.` (`client/src/pages/FounderPurchase.tsx:82`, matrix cases `support status back to PENDING` and `support address shorter than the gate allows`).

## REFUND GATE

`refund_policy_status = APPROVED` plus ≥40 characters of approved text, enforced both in the readiness model and by table checks, so an approval without wording cannot be stored (`tests/stage8-local-founder-readiness.test.ts:461`, `:473`; `supabase/tests/stage8_01_offer_readiness.sql`).

## DISCLOSURE GATE

`disclosures_status = APPROVED` is required before any payment affordance (`client/src/lib/founder-readiness.ts:46`; matrix case `disclosures withdrawn`; `tests/stage8-founder-contracts.test.ts:130`).

## OPERATOR RUNBOOK

`docs/OPERATOR_BOOTSTRAP.md` was corrected to the executed state: the readiness conjunction as the code writes it, the one-query gap check, the allowlist insert that alone opens review access, and the standing statement that neither the query nor an approval click establishes bank-account ownership. `docs/STAGE_4_2_OPERATOR_CONFIGURATION.md` was rewritten where it described the retired `CONFIGURED` destination value and the stale pairing rule.

## LIVE-ACTIVATION CHECKLIST

`docs/FOUNDER_LIVE_ACTIVATION_CHECKLIST.md` carries 12 items pinned to the gap kinds `client/src/lib/founder-readiness.ts` actually reports — `tests/stage8-founder-contracts.test.ts:198` fails if the document and the evaluator drift apart. Executed result: the documented gap query returns 6 outstanding terms, item ids 2, 4, 7, 9, 10, 12 (destination not LIVE; VPA missing; support status PENDING; refund status not APPROVED; refund text missing; disclosures not APPROVED). The repository ships NOT READY, and `enabled` alone is not what makes it ready.

## CUSTOMER BROWSER

`e2e/stage8-local-founder-customer.spec.ts`, 11 tests, real browser against the built bundle at `127.0.0.1:3000`, serial, `STAGE8_LOCAL_E2E=1`: delivered placeholder; Free-limit routing without opening a payment; fixture-revealed price/payee/seats; idempotent claim plus QR-vs-link pixel compare; D-S8-1 open-UPI case; a database-rejected reference refused in product language; submission lands in manual review without claiming success; reload/sign-out/sign-in keeps it pending; another customer sees nothing; keyboard operation and all five widths; no payment facts in storage.

## REVIEWER BROWSER

`e2e/stage8-local-founder-reviewer.spec.ts`, 10 tests: allowlist opens the queue; a submitted reference reaches the queue as bank-check fields with stored funnel counts; rejection keeps the reference and leaves the account Free; reconsideration unlocks only behind the tick; an approval lifts the ledger limit and clears both queues; revocation through the reviewer's own session leaves every record and restores the limit (and asserts the missing on-screen control as a gap); the last seat taken once with the next review refused as full; a card another review already settled refused with its own state; sign-out/Back/customer denial; keyboard and five widths. Official pair run: 21 passed in 8.3m at `--workers=1` (`../stage8-artifacts/e2e-stage8-pair-final.log`).

## ACCESSIBILITY

Both Founder surfaces are keyboard-operable end to end: focus reaches every reviewer action, the reconsideration checkbox is reachable and its state is exposed, the payment card's controls are real buttons, and the toast region is a labelled live region that the tests read (`e2e/stage8-local-founder-customer.spec.ts:427`, `e2e/stage8-local-founder-reviewer.spec.ts:580`). Stage 6's own accessibility suite was re-run against the Stage 8 tree: 30 passed including `stage6-local-accessibility.spec.ts` (`../stage8-artifacts/e2e-stage6-a.log`).

## RESPONSIVE

Qualified at 360×800, 390×844, 768×1024, 1280×800 and 1440×900 for both new surfaces, asserting no horizontal overflow and that the payment card and review queue stay legible at each width. Stage 6's responsive suite re-ran green in the same chunk set (34 passed, `../stage8-artifacts/e2e-stage6-b.log`).

## CONSOLE/PAGE ERRORS

Every browser test registers a problem watch on its own page and asserts the collected set is empty, with refusals excused only by named RPC path (never by status code) where the refusal is the point of the case. One environmental exception is disclosed rather than suppressed: the built page's first paint requests a third-party Google Fonts stylesheet, and offline that request logs `ERR_NAME_NOT_RESOLVED`. It is a product dependency on a third-party CDN, listed under KNOWN LIMITATIONS.

## STAGE 2 REGRESSION

`e2e/stage2-local-auth.spec.ts` 1 passed; `tests/stage2-local-foundation.test.ts` 12 passed inside `pnpm test`. 8 skipped tests in the battery are the credential-gated legacy specs (`e2e/founder-purchase.spec.ts`, `e2e/auth-lifecycle-limits.spec.ts`, `e2e/core-workflow.spec.ts`, `e2e/accessibility-smoke.spec.ts`, `e2e/responsive-authenticated.spec.ts`, `e2e/stage41-client-conversion.spec.ts`) that require `E2E_EMAIL`/`E2E_PASSWORD`/`E2E_EXISTING_*`/`E2E_LIMIT_*`/`E2E_SIGNUP_*` from an ignored local env file; they are skipped by design, not by Stage 8 change.

## STAGE 3 REGRESSION

`e2e/stage3-local-isolation.spec.ts` 5 passed; `tests/stage3-*` live suites pass; pgTAP `stage3_01_rls_structure.sql` (20 assertions) and `stage3_02_privileges.sql` (67) pass unchanged. No Stage 3 policy or grant was modified to make Founder work possible.

## STAGE 4 REGRESSION

`e2e/stage4-local-persistence.spec.ts`: 8 of 10 passed at `--workers=2`, 2 failed with `Test timeout of 30000ms exceeded` on the two-tab cases (`:262`, `:293`); the identical file at `--workers=1` with the stock 30s timeout and no assertion or config change gave 10 passed in 60.0s (`:262` in 2.5s, `:293` in 4.4s). First-failure evidence is preserved at `../stage8-artifacts/first-failure-evidence-stage4/` (trace, screenshots, error context). Classified as D-S8-3-class machine contention, not a Stage 4 regression — but recorded as a caveat, because the conclusion rests on a worker-count experiment rather than a product fix. `tests/stage4-*` suites pass in `pnpm test`; pgTAP `stage4_01_edit_routines.sql` (10) passes.

## STAGE 5 REGRESSION

`e2e/stage5-local-lifecycle.spec.ts` 14 passed at `--workers=2`; `tests/stage5-local-lifecycle.test.ts` 69 passed in `pnpm test`; pgTAP `stage5_01_lifecycle.sql` (32) and `stage5_02_promise_chronology.sql` (45) pass.

## STAGE 6 REGRESSION

64 passed / 0 failed at `--workers=1` across two chunks: accessibility, auth-ux, first-user, forms (30 passed, 3.7m) and interaction, ledger-states, mutations, responsive, workspace-gate (34 passed, 6.6m). `stage6-local-forms.spec.ts:89` failed in the earlier 4-worker battery and passes serially, the same contention signature as Stage 4.

## STAGE 7 REGRESSION

32 passed / 0 failed at `--workers=1`: export 13 passed (4.0m), follow-up 19 passed (3.5m). The full 22-spec Stage 2–7 battery at 4 workers reported 116 passed / 5 failed / 8 skipped, and the failing 41-test subset re-ran 41 passed at 1 worker (`../stage8-artifacts/e2e-battery.log`, `../stage8-artifacts/e2e-battery-serial-recheck.log`).

## PGTAP

8 files, 296 tests, `Result: PASS`, run before and after zero replay with identical counts (`../stage8-artifacts/pgtap-final.log`, `../stage8-artifacts/pgtap-postzero.log`). Stage 8 adds three files: `stage8_01_offer_readiness.sql` (31 top-level assertions), `stage8_02_payment_evidence.sql` (22), `stage8_03_reviewer_boundaries.sql` (13). The baseline on the starting SHA was 5 files / 229 tests, so pg_prove's reported count rose by 67 — none of the 229 existing assertions was deleted or relaxed.

## ZERO REPLAY

Executed as `pnpm supabase:stop` → `pnpm supabase:start` → `pnpm db:reset:local`. All 22 migrations applied from zero with no errors and no seed file (`WARN: no files matched pattern: supabase/seed.sql`, which is the expected delivered state — the repository ships data-free). After replay, measured directly: destination `PLACEHOLDER`, `upi_id` NULL, 49900, cap 50, support PENDING, refund PENDING_APPROVAL, disclosures PENDING, `enabled` true, 0 reviewers, 0 claims, 0 entitlements, 0 auth users, readiness gap count 6. `pnpm test:db` then passes 296 assertions and `pnpm test` passes 603 tests against the rebuilt database.

## D-S8-2 — THE DELIVERED DATABASE COULD NOT STORE `LIVE` — RED / FIX / GREEN

- RED: two check constraints coexist on `founder_offer_config`. Stage 4.2A (`20260814110000`) widened the destination vocabulary to PLACEHOLDER/TEST/LIVE and added a pairing check, but replaced only the enum-style check it named; the original table-level `founder_offer_config_check`, written when the third state was spelled `CONFIGURED`, was left in place. Executed against the local stack inside rolled-back transactions: setting `TEST` with a VPA returned `UPDATE 1`; setting `LIVE` with the same VPA raised `new row … violates check constraint "founder_offer_config_check"`. So the documented activation step was impossible, `CONFIGURED` was equally refused, and the fail-closed posture everyone relied on came from a leftover constraint rather than from the readiness gate.
- Consequence: Stage 8's readiness conjunction includes `destination = LIVE`, so with `LIVE` inexpressible every one-missing-precondition case in the matrix would have been vacuously "missing" and the activation step would have failed with a raw constraint error.
- FIX: one forward-only migration dropping that single stale constraint. The remaining pair — `founder_offer_config_payment_destination_status_check` (vocabulary: exactly PLACEHOLDER/TEST/LIVE) and `founder_offer_config_payment_destination_ready_check` (PLACEHOLDER ⇒ `upi_id IS NULL`; TEST/LIVE ⇒ trimmed VPA of 3–160) — states everything the dropped constraint asserted about the states that were legal for it, and nothing more. Dropping it weakens nothing and enables nothing: the delivered row is unchanged.
- GREEN: `supabase/tests/stage8_01_offer_readiness.sql` pins both halves — the four destination/VPA refusals now name the readiness check as their author, so if a later change removed that guard the assertions fail loudly instead of passing on an unrelated constraint.

## D-S8-3 — A SAME-INSTANT TWO-TAB RACE IS UNMEASURABLE ON THIS MACHINE

- Observation: in the stale-card journey, a reviewer click in a backgrounded tab completed 43 900.3 ms after dispatch while its twin answered in 171.1 ms; the two `approve_founder_claim` POSTs left the browser 37.3 s apart (18:26:28.500Z and 18:27:05.810Z); later `page.evaluate` calls on that tab timed out at ≥10 s.
- Not Chromium throttling: Playwright already passes `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding`, and Stage 8 runs at `--workers=1`. The signature is machine starvation, and it also produced the two Stage 4 and one Stage 6 failures above at higher worker counts.
- Resolution: the same-instant seat race is proved with two concurrent authenticated clients in `tests/stage8-local-founder-readiness.test.ts:913`, not in the browser. The browser journey is sequential and asserts what a sequential journey can: the seat is taken once, the next review is refused as full, and a card another review already settled refuses with its own state. `README.md:135` and the reviewer spec's header comment say so in the same words.
- Correction of record: the first stale-card failure in `e2e-stage8-pair-4.log` was not a tab stall. `approve_founder_claim` returns an already-APPROVED claim unchanged (`20260813030000…sql:261`), so the second approval was a correct idempotent 200 and the UI reported success. The test was asserting a refusal where the design gives a no-op. It was rewritten to settle the shared card with a rejection, which is the state that genuinely has to say no. That was a test-design error on my side, initially misdiagnosed as machine behavior.

## FULL TEST RUN #1

Executed on the exact tree committed by PHASE 89, after the last fixture edit. `pnpm test` · exit 0 · `Test Files 28 passed | 1 skipped (29)` · `Tests 603 passed | 1 skipped (604)` · 182.96s · PGRST303 occurrences: 0 (`../stage8-artifacts/test-run-final-A.log`).

## FULL TEST RUN #2

Run immediately after #1 with no code or configuration change between · `pnpm test` · exit 0 · `Test Files 28 passed | 1 skipped (29)` · `Tests 603 passed | 1 skipped (604)` · 162.61s · PGRST303 occurrences: 0 (`../stage8-artifacts/test-run-final-B.log`). Identical counts to #1.

Earlier on the same branch, before the one test-fixture string was changed, the same pair had already produced these identical counts (`../stage8-artifacts/test-run-final-1.log`, 170.56s, and `../stage8-artifacts/test-run-final-2.log`, 162.03s), and a run straight after zero replay produced them again (`../stage8-artifacts/test-run-postzero.log`, 135.72s). Five runs, same numbers, zero PGRST303 throughout.

The one skip is `tests/supabase.public-config.live.test.ts`, which is gated on a hosted project by design and must stay skipped locally. No sleeps, no retry-until-green, no JWT leeway were added; nothing was masked to reach these numbers.

## GENERATED TYPES

`pnpm db:types` run twice after zero replay produced byte-identical output: sha256 `10dd590052d68d997a43a01f5ff3ca17257226beca01bc95af81b3efd185e328`, 1371 lines, and `git status` shows the tracked file unchanged. The hash is identical to Stage 7's although a migration was added, because that migration drops a check constraint, and check constraints are not part of the generated TypeScript surface. Deterministic: YES.

## PGRST303

2 runs · 0 occurrences · 0 other failures · 0 production masking added. The Stage 4 investigation stands; nothing in Stage 8 adds a retry or a widened window.

## LINT

`pnpm lint` (`eslint client/src tests e2e vite.config.ts --max-warnings=0`) · exit 0 · no output. No warning debt. Re-run on the committed tree after the last fixture edit (`../stage8-artifacts/gate-lint-final.log`): exit 0, still no output.

## TYPECHECK

`pnpm check` (`tsc --noEmit`) · exit 0. Re-run on the committed tree (`../stage8-artifacts/gate-check-final.log`): exit 0.

## BUILD

`pnpm build` · exit 0. Re-run on the committed tree: `✓ built in 12.09s`, no warnings (`../stage8-artifacts/gate-build-final.log`). Chunk sizes: `index` 498.18 kB (144.28 kB gzip), `FounderPurchase` 40.69 kB, `FounderAdmin` 10.87 kB, `Home` 85.88 kB, `founder-readiness` 0.90 kB — the readiness gate ships as its own chunk and nothing in the payment path is tree-shaken away.

## PRODUCTION AUDIT

`pnpm audit --prod --audit-level=high` · `No known vulnerabilities found`. `pnpm install --frozen-lockfile` · exit 0, lockfile untouched. `git diff --check` · exit 0 (CRLF-conversion notices only, no whitespace errors).

## SECRET SCAN

27 paths staged, 4 599 insertions / 72 deletions. Every UPI-shaped string in the delta is `dueweave-test@upi` (the Stage 4.2A synthetic) or an obviously broken negative case (`@upi`, `a@b`, `two @ signs@upi`, `spaced handle@upi`, `leak-me@upi`); one assertion previously used a bank-PSP-style handle suffix and was replaced with `synthetic-merchant@dueweave.invalid` so the fixture is unmistakably synthetic. `merchant@…`-shaped real addresses: none. No 15–16 digit card-like value. No `service_role`, `sb_secret_`, JWT or API-key literal in any staged file; the only `service_role` matches are assertions that production code does not contain it (`tests/security-contract.test.ts:183`, `:304`). No `supabase.co` URL, project ref, `supabase link` or `db push` in code. `.env.local` is gitignored (`.gitignore:12`) and `.env.example` carries only loopback config plus a written prohibition on putting a service-role or payment credential in a `VITE_*` variable. Account fixtures are `stage8e2e-*@dueweave.local` and `stage8-*@dueweave.local`.

## REMOTE SUPABASE MUTATIONS: NONE

No `supabase link`, no `db push`, no `db reset --linked`, no `supabase db pull`. Every command in this stage addressed the loopback stack only.

## HOSTED PROJECT CREATED: NO

No Supabase account was used. The local stack printed its own default development keys at `supabase:start`; they are CLI defaults, are not in the repository, and are not used by production code.

## DEPLOYMENT: NONE

No deploy, no tag, no hosting command, no CDN action.

## PAYMENT ACTIVATION: NONE

`payment_destination_status` was never set to `LIVE` in the delivered or local default state, and no migration, script or seed writes it. LIVE appears only as a compared value and as a rolled-back RED probe. No payment provider, gateway, PSP, WhatsApp/Twilio or bank API integration was added, and none is referenced.

## KNOWN LIMITATIONS

1. No revoke control exists in `client/src/pages/FounderAdmin.tsx`, although `revoke_founder_entitlement()` is implemented and authorized. Revocation was therefore exercised through the reviewer's own authenticated REST session, and the journey asserts the missing control as a gap rather than pretending a button does it.
2. Approval from the pending queue has no machine-enforced bank-verification flag; only reconsideration does (`p_bank_history_verified`). A reviewer can approve a pending claim without ticking anything, so the "verified in business bank history" guarantee is procedural discipline plus the audit trail, not a database precondition. I did not add the flag, because changing the reviewer's contract is an owner decision, not a qualification step.
3. A repeat approval of an already-APPROVED claim answers 200 (correctly, as a no-op — no second entitlement, seat or event) but shows a success toast saying the entitlement and audit entry were written. Misleading wording; correct state.
4. `create_founder_claim` does not check the seat cap, so a customer can open a DRAFT when zero spots remain. The customer UI disables the action at 0 spots and approval is where the cap is enforced, so no seat can be over-issued — but the draft is a dead end rather than a refusal.
5. The delivered `support_contact` holds the sentence `Support contact not configured`. It reads as configured to a length-only check, which is why the checklist marks it `placeholder`: it must be replaced, not confirmed.
6. Stage 8 fixtures temporarily write `TEST` + `dueweave-test@upi` to the single offer row during a run. Teardown restores the delivered snapshot in an unconditional `afterAll`, and the delivered row was re-measured after every battery; a hard interruption can still leave a synthetic TEST destination on that machine. It cannot affect the repository, and `LIVE` is never written. Related: the live suites sign up synthetic auth accounts, so a post-test local database is not empty (after the final pair it measured 0 reviewers / 0 claims / 0 audit events / 0 analytics events but 6 leftover auth users and their 6 FREE entitlements). Zero replay is the control that returns it to the shipped state — the repository itself ships no rows.
7. The built app's first paint depends on a third-party Google Fonts stylesheet. Offline it logs `ERR_NAME_NOT_RESOLVED`. Self-hosting the font is a separate product decision.
8. Same-instant two-tab browser races are not measurable on this machine (D-S8-3), and the Stage 4 two-tab and Stage 6 forms cases are consequently qualified at `--workers=1`. A faster qualification machine should re-run the full battery at a higher worker count; a failure there would be a real signal rather than starvation.
9. No refund or disclosure wording was authored. The brief forbids inventing legal terms, so those two columns stay empty and unapproved by design, and the checklist says who must fill them.
10. Readiness is a client-side conjunction over a server read; the database independently re-checks every term inside the RPCs at call time, so the client copy is not the gate. The two are pinned to agree by `tests/stage8-founder-contracts.test.ts:198` and the pgTAP files, not by assumption.

## OWNER-SIDE BLOCKERS BEFORE LIVE MONEY

1. Replace the placeholder support contact with a monitored address and mark it `CONFIGURED`.
2. Publish the refund terms the owner has approved (≥40 characters) and mark them `APPROVED`.
3. Approve the consumer disclosures, with the owner's own advice.
4. Configure the business's real UPI VPA and payee name, then mark the destination `LIVE` last, after the two independent checks below — never from the repository.
5. Add at least one real reviewer UUID to `founder_admins`, confirmed by signing in as that account and reading the queue.
6. Decode the generated QR and UPI link and compare them, field for field, against the payment instructions the business publishes outside DueWeave.
7. Confirm the payee name against the bank statement name, and the VPA against the business bank account.

None of these can be cleared from a browser, an admin screen or a one-click control, and none is cleared by this stage. The readiness conjunction is a conjunction: one missing term blocks the QR, the link, claim creation and payment submission.

## FINAL STAGE 8 VERDICT

PASS WITH DISCLOSED CAVEATS, and NOT READY FOR LIVE MONEY — which is the correct delivered state. The Founder path is qualified as designed: a claim is only a claim until a human with an allowlist row compares a typed reference against business bank history; nothing the browser can observe is treated as payment; the QR and the link are the same string; the seat cap cannot be exceeded by two concurrent writers; every refusal is stated in product language without leaking the database; and revocation, rejection and reconsideration all preserve the history they are judged on. The gate is closed for the right reason now — the readiness conjunction, not a leftover constraint.

The caveats are two observation limits (browser simultaneity, the font CDN), one product gap that is an owner's decision (the missing approval-time verification flag), and three UI honesty gaps (no revoke control, the no-op success toast, cap-unaware draft) recorded rather than patched. Nothing here weakens authorization, invents payment success, or places a real payment destination in the repository.

## NEXT RECOMMENDED STAGE

Stage 9 is recommended only on the strength of this PASS: whatever the roadmap has after monetization readiness. It was not started, and this stage stops at its boundary. If the owner wants the Founder offer actually turned on, the human step comes first — the seven owner-side blockers above — and the correct next engineering stage is the one that closes the disclosed product gaps (approval-time bank-verification flag, revoke control on the review screen, and honest no-op wording), not a new feature surface.

## WORKING TREE CLEAN

`git status --short` after the PHASE 89 commit shows no modified and no untracked paths. Scratch evidence, traces and first-failure artifacts live outside the repository in `../stage8-artifacts/` and are not committed.

## PUSHED TO GITHUB / REMOTE SHA / PR

`current-stage-8-founder-readiness` is pushed; `git rev-parse HEAD` and `git rev-parse origin/current-stage-8-founder-readiness` are identical. No PR was created. Nothing was merged. `main` was not modified.

```
git rev-parse HEAD
git rev-parse origin/current-stage-8-founder-readiness
```
