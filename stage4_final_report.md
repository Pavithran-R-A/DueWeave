# DueWeave — Stage 4 Monetization Readiness Final Report

**Project:** PROJECT AR-1 / DueWeave  
**Stage:** 4 — Founder Lifetime monetization  
**Report status:** Final, verification-backed, and bounded to Stage 4  
**Prepared:** 13 August 2026 (IST)

## Verdict

**Stage 4 is complete and monetization-ready at the architecture, database-control, manual-review, and customer-flow levels.** The product deliberately remains **not publicly payment-enabled**: the live offer is an enabled `PLACEHOLDER` with no UPI destination. A real verified business UPI destination, a live support channel, operator-approved refund terms, and applicable accounting/tax confirmation remain prerequisites before broad public sales.

> **Stop boundary:** This report closes Stage 4. No Stage 5 feature work, public deployment, payment gateway integration, public payment collection, GitHub Release, npm publication, or force-push was performed.

| Release decision | Outcome |
|---|---|
| Founder claim, verification, entitlement, and audit architecture | **PASS** |
| Customer payment surface | **PASS**, but intentionally blocked until an operator configures a verified destination |
| RLS and privileged-review boundary | **PASS** |
| Manual payment-confirmation model | **PASS** — no gateway or automated confirmation added |
| Public commercial launch | **NOT YET AUTHORIZED** — operational prerequisites remain |
| Stage 5 | **NOT STARTED** |

## Environment and schema

The verified Supabase project is `dmteajorqysoenlwcmtb` in `ap-south-1`. The release preserves the zero-cost operating constraint: Supabase Free, GitHub Free, no paid SMTP, no payment gateway, no paid API, and no runtime AI service.

| Migration | Purpose and verification result |
|---|---|
| `20260812150500_secure_foundation.sql` | Secure core ledger baseline. |
| `20260812151500_stage2_schema_alignment.sql` | RLS, owner-safe relationships, transactional workflows, and the Free-plan gate. |
| `20260812160000_revoke_anon_rpc_exec.sql` | Anonymous/default privileged-RPC execution revoked. |
| `20260812160500_revoke_unused_delete_rpc.sql` | Unused browser-delete helper revoked. |
| `20260812170000_stage3_core_workflows.sql` | Stage 3 protected ledger workflows. |
| `20260813030000_stage4_founder_monetization.sql` | Founder offer configuration, claims, allowlisted reviewers, immutable audit events, protected review and entitlement RPCs. [1] |
| `20260813030500_stage4_harden_admin_helpers.sql` | Internal reviewer helpers removed from public execution. [2] |
| `20260813031000_stage4_fix_pending_claim_return_types.sql` | Stable restricted reviewer-queue return contract. [3] |
| `20260813031500_stage4_drop_legacy_draft_reference_constraint.sql` | Removed the obsolete global empty-reference uniqueness constraint while retaining status-aware duplicate-UTR prevention. [4] |
| `20260813032000_stage4_allow_cancelled_empty_reference.sql` | Corrected the cancelled-draft constraint discovered during final E2E: a cancelled unsubmitted claim may legitimately keep empty payer/reference fields; submitted/reviewed states remain validated. [5] |

The Founder data model adds `founder_offer_config`, `founder_admins`, and `founder_audit_events`. It extends the existing immutable `purchase_claims` and `entitlements` model rather than introducing any card, gateway, or banking-secret storage. Amounts remain integer paise; the current Founder amount constraint is `49900` paise.

## RLS, authority, and privacy controls

Every private ledger table retains `auth.uid()`-based ownership boundaries. Founder offer configuration, reviewer allowlisting, and audit events are RLS-protected and explicitly revoked from browser table writes. The browser only receives browser-safe Supabase configuration; no service-role key, database password, management token, UPI PIN, OTP, bank password, or card credential is stored in the application. [1] [6]

| Boundary | Verified control |
|---|---|
| Customer data isolation | Owner-scoped RLS prevents one authenticated user from reading another owner’s claims or ledger records. |
| Founder approval | `approve_founder_claim` invokes the server-controlled `founder_admins` allowlist; an ordinary user cannot self-activate. |
| Admin configuration | `founder_admins` and `founder_offer_config` have no browser-write path. |
| Claim/audit history | Direct changes are blocked; protected workflows write immutable claim/audit history. |
| UTR handling | A partial unique index rejects duplicate non-draft UTRs across accounts. |
| Seat cap | An advisory transaction lock serializes approvals before checking the configured Founder capacity. |
| Privacy copy | The purchase screen explicitly states that UPI PINs, OTPs, banking logins, card details, and bank credentials are never requested or stored. [7] |

## Founder workflow matrix

The workflow matrix was run against controlled, disposable accounts through authenticated RPC contexts and then fully removed. The final post-fix browser run also verified the customer-visible cancellation/retry path.

| Scenario | Evidence and outcome |
|---|---|
| Create private claim | Owner A created a `DRAFT` Founder claim. |
| Submit manual payment reference | Owner A’s unique controlled UTR changed the claim to `PENDING_REVIEW`. |
| Tenant isolation | Owner B could not read Owner A’s claim directly under RLS. |
| Non-admin review probe | Ordinary authenticated access to `list_pending_founder_claims()` was rejected. |
| Admin approval | Allowlisted reviewer C approved Owner A; claim became `APPROVED` and an `ACTIVE` `FOUNDER` entitlement was created with source `PURCHASE`. |
| Founder gate lift | Owner A created four active receivables after approval. |
| Free gate | Owner B’s fourth active receivable was rejected with `Free plan allows up to 3 active receivables`. |
| Revocation | Reviewer C revoked Owner A’s entitlement; existing four receivables remained, a revocation audit event was written, and future active receivables were again blocked. |
| Duplicate UTR | Owner B’s duplicate controlled reference was rejected at the database boundary. |
| Reviewer rejection | Reviewer C rejected Owner B’s pending claim with a recorded controlled reason; the audit record persisted. |
| Retry after rejection | Owner B subsequently created a fresh `DRAFT` claim. |
| Self-upgrade probe | Owner B’s direct `approve_founder_claim` attempt was rejected. |
| Atomic seat cap | With a controlled one-seat configuration, Owner A’s approval occupied the only seat and Owner B’s next approval failed without changing its pending claim. |
| Customer cancellation and retry | Final Playwright run: create draft → cancel draft → start a new private claim → submit UTR → `PENDING_REVIEW`. The discovered state-constraint defect was fixed by migration `20260813032000`. |

## Entitlement and revocation semantics

The Free plan remains limited to three active receivables at the database trigger boundary. Only an `ACTIVE` `FOUNDER` entitlement lifts that limit. Revocation does not delete or mutate historical receivables; it only restores the Free-plan gate for future transitions into active states. This preserves customer records while providing an immediate enforcement boundary for future usage. [1]

## Browser, responsiveness, and accessibility

The controlled Founder customer flow passed in Chromium at **360, 390, 430, 768, and 1440 pixels**. It covered authentication, More navigation, server-controlled offer rendering, QR presence and accessible name, cancellation, fresh-claim retry, labelled UTR/payer input focus order, payment-reference submission, semantic pending-review status, return to ledger, and sign-out. The final run passed in **8.4 seconds**. [8]

| Verification | Result |
|---|---|
| Responsive screenshots | Preserved externally at the five required widths; the mobile 360px and desktop 1440px evidence was visually reviewed. |
| QR semantics | Image renders with an amount/payee-specific accessible name; QR payload unit tests decode and verify the exact payee, amount, currency, and destination semantics. |
| Form accessibility | Explicit visible labels; E2E verifies keyboard focus on UTR then payer name. |
| Status messaging | Pending/rejected claim messages use `role="status"`; active Founder state is polite live content. |
| Auth gateway smoke | Three credential-free tests passed: protected-route redirect, non-technical invalid-sign-in failure, and recovery non-enumeration. |
| Admin UI | The protected reviewer surface is implemented and authorization-tested through static contracts and live SQL authorization probes; customer browser E2E is intentionally scoped to the required purchase journey. |

## Quality, bundle, security, and dependency verification

| Check | Final result |
|---|---|
| Unit and contract suite | **35 tests passed** across 6 Vitest files. |
| TypeScript | `pnpm check` passed with zero errors. |
| Production build | `pnpm build` passed. |
| Browser tests | Founder purchase E2E passed; auth-gateway suite passed 3/3. |
| Secret/credential scan | No tracked `.env` file; no service-role token, secret token, database URL, or disposable E2E literal in source, `dist`, reachable Git history, or cleared diagnostics. |
| Production dependency audit | `pnpm audit --prod` reported **No known vulnerabilities found**. |
| Bundle advisory | Vite reports a non-blocking >500 kB shared-chunk warning: `index` is 746.99 kB minified / 218.54 kB gzip. Founder pages remain lazy loaded (`FounderPurchase` 59.89 kB, `FounderAdmin` 19.18 kB); further shared-chunk optimization is deferred because it is outside the Stage 4 change boundary. |

## Final fixture and payment-destination state

All temporary Stage 4 users, identities, reviewers, claims, entitlements, clients, receivables, audit events, analytics events, and test-only configuration have been removed. The final scoped cleanup returned zero remaining fixture records in every affected category. The live Founder offer remains **enabled** with `founder_cap = 50`, `payment_destination_status = PLACEHOLDER`, and `upi_id = null`.

This means the Founder page remains honest and safe: it displays that payment instructions are being set up and tells users **not to send money yet**. No fabricated destination remains in the live configuration.

## GitHub and release status

The source is prepared on the private `stage-4-founder-monetization` branch of [`Pavithran-R-A/project-ar1`](https://github.com/Pavithran-R-A/project-ar1). The existing `stage-1-approved`, `stage-2-secure-foundation`, and `stage-3-beta-readiness` tags were not rewritten. The final implementation commit, push verification, immutable Stage 4 tag, and project checkpoint are completed immediately after this report is committed; the release hash is reported in the delivery message.

## Known limitations and operator prerequisites

> These are deliberate Stage 4 boundaries, not silent defects.

| Item | Required action before broader commercial use |
|---|---|
| Real payment destination | Configure a verified business UPI ID and payee name in the server-controlled offer configuration; revalidate QR output before enabling public payment. |
| Payment confirmation | Continue manual bank-history review; no automated payment-confirmation system exists. |
| Refund policy | Publish operator-approved refund terms before broad sales; the app does not invent refund promises. |
| Support | Configure a real support contact before accepting claims from non-test customers. |
| Business compliance | Obtain independent accounting, tax, and business-compliance advice appropriate to the operator and jurisdiction. |
| Email delivery | Supabase default-email quotas and deliverability constraints remain; no paid SMTP was added. |
| Performance | Consider later shared-chunk optimization if field performance indicates it is necessary. |

## Final status

**MONETIZATION READY — bounded to manual verification and a deliberately disabled public payment destination.** The secure entitlement architecture, Reviewer-only approval model, audit trail, UTR duplicate protection, atomic capacity guard, revocation behavior, browser journey, responsive design, accessibility semantics, and quality gates have been verified. **READY FOR STAGE 5 only when explicitly requested.**

## References

[1]: ./supabase/migrations/20260813030000_stage4_founder_monetization.sql "Stage 4 Founder monetization migration"
[2]: ./supabase/migrations/20260813030500_stage4_harden_admin_helpers.sql "Founder internal helper hardening"
[3]: ./supabase/migrations/20260813031000_stage4_fix_pending_claim_return_types.sql "Founder reviewer queue return-type normalization"
[4]: ./supabase/migrations/20260813031500_stage4_drop_legacy_draft_reference_constraint.sql "Legacy empty-draft constraint correction"
[5]: ./supabase/migrations/20260813032000_stage4_allow_cancelled_empty_reference.sql "Cancelled-draft reference-state correction"
[6]: ./server/stage2.security-contract.test.ts "Security contract regression tests"
[7]: ./client/src/pages/FounderPurchase.tsx "Founder customer surface and disclosures"
[8]: ./stage4_browser_qa_notes.md "Founder browser QA evidence"
