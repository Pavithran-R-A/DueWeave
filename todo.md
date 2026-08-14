# Stage 1.1 Mobile Product and Conversion Pass

- [x] Read the remaining Stage 1.1 requirements and map them to the current prototype.
- [x] Make the mobile Today hierarchy show money status and the first actionable queue card in the first viewport.
- [x] Reduce the mobile money hero and move secondary financial stats below the first action.
- [x] Remove the redundant mobile add action while preserving safe-area spacing and bottom navigation reachability.
- [x] Make queue cards explain who, how much, why now, and what to do with calmer ledger annotations.
- [x] Verify and harden add receivable, add promise, payment, follow-up, copy, WhatsApp, contacted, snooze, client, detail, upgrade, and theme flows.
- [x] Run tests, typecheck, lint, production build, and responsive visual verification at 360, 390, 430, 768, and 1280 widths.
- [x] Save one final Stage 1.1 checkpoint and deliver the updated prototype.

## Resumed Stage 1.2 GitHub Sync

- [x] Push the complete editable source to `Pavithran-R-A/project-ar1`.
- [x] Confirm the repository remains private and contains no secrets, `.env` files, build output, or Manus-local/private files.
- [x] Verify the default branch, upstream tracking, remote commit, and clean working tree.
- [x] Create the requested checkpoint commit message if it is not already represented by the current approved commit.
- [x] Create the `stage-1-approved` tag if it does not already exist.
- [x] Save the approved Stage 1.2 checkpoint and stop without beginning Stage 2.

## Stage 2 Secure Supabase Foundation

- [x] Confirm the Stage 1.2 commit/tag and clean source-control state before changes.
- [x] Create or connect exactly one zero-cost Supabase project named `project-ar1` or `project-ar1-dev`.
- [x] Create a protected Stage 2 working branch without rewriting `stage-1-approved`.
- [x] Add versioned schema/migrations for profiles, clients, receivables, promises, payments, activities, promise_events, entitlements, purchase_claims, and minimal analytics.
- [x] Add database constraints, owner-safe foreign-key relationships, indexes, timestamps, and immutable promise-event behavior.
- [x] Enable and verify RLS on every user/business-facing table for SELECT, INSERT, UPDATE, and DELETE as appropriate.
- [x] Add browser-safe Supabase client configuration and authenticated repositories without exposing service-role secrets to the frontend.
- [x] Resolve the full-stack template upgrade conflicts while preserving the approved Stage 1.2 frontend.
- [x] Add Supabase email/password sign-up, login, logout, password-reset, and protected application routes.
- [x] Replace local seeded persistence with real authenticated CRUD and empty state without demo-data contamination.
- [x] Add server-independent security, RLS, repository, and interface tests with a reproducible attack matrix.
- [x] Scan source, build output, and Stage 2 history for secrets and audit runtime dependency vulnerabilities.
- [x] Remediate Supabase advisor findings by revoking default public and anonymous execution of security-definer functions.
- [x] Run all tests, typecheck, production build, and responsive UI verification at 360, 390, 768, and 1440 pixels.
- [x] Commit, push, and checkpoint the verified Stage 2 foundation without beginning Stage 3.
- [x] Preserve the approved Stage 1 UI and keep purchase, payment, deployment, and Stage 3 launch work out of scope.
- [x] Verify cross-tenant isolation, invalid-data rejection, auth flows, error/loading states, tests, build, and responsive UI.
- [x] Save the Stage 2 foundation checkpoint and deliver a bounded report.

## Stage 3 Complete Authenticated Product Workflow

- [x] Confirm the Stage 2 branch, remote commit, approved tags, and clean working tree; create `stage-3-core-product` without rewriting history.
- [x] Audit the existing Stage 2 client, receivable, promise, payment, follow-up, and queue implementations against the approved Stage 3 journey.
- [x] Establish a controlled, non-secret browser E2E account strategy and validate signup, login, wrong-password, logout, protected-route, reload, expiry, recovery, and confirmation behavior within default-email limits; external email delivery remains explicitly limited in the Stage 3 report.
- [x] Strengthen real client creation, validation, persistence, refresh, and User A/User B isolation behavior.
- [x] Strengthen real receivable creation, paise conversion, money validation, persistence, free-plan limit UX, and direct-bypass defense.
- [x] Complete persistent promise creation, local-business-date handling, lazy/idempotent broken-promise behavior, and immutable promise lifecycle transitions.
- [x] Complete atomic partial-payment, final-payment, overpayment rejection, payment-history, replacement-promise, and recovery-total workflows.
- [x] Connect all Today metrics, deterministic queue explanations, client history, reliability metrics, and refresh behavior to real authenticated data.
- [x] Complete snooze, follow-up composer, safe WhatsApp deep links, copy, and persisted mark-contacted behavior without sending messages automatically.
- [x] Add lightweight browser E2E coverage for the authenticated core journey without committing credentials or weakening confirmation security.
- [x] Add and run unit/integration regression coverage for money, queue priority, lifecycle, atomicity, free-plan bypass, and all Stage 3 RPC/function security boundaries.
- [x] Re-run RLS/anonymous/IDOR/entitlement security tests and scan all source, build, and Git history for secrets.
- [x] Verify accessibility, responsive authenticated data views at 360/390/430/768/1024/1440, meaningful performance improvements, production build, and dependency audit.
- [x] Commit, push, tag `stage-3-beta-readiness` only after PASS, checkpoint, and deliver the exact required Stage 3 report without beginning Stage 4.
- [x] Verify Stage 3 client list refresh and explicit User A/User B client read/write isolation for the standalone client workflow.
- [x] Verify graceful free-plan limit feedback for standalone receivable creation and regression-test the limit handling path.
- [x] Verify that the live FollowUpSheet action calls `recordContacted`, refreshes Today and timeline state, and never sends a WhatsApp message automatically.
- [x] Make the controlled authenticated E2E assertion deterministic when the new client name appears in both the client list and the client detail heading.
- [x] Refresh Stage 3 browser-QA evidence so it accurately distinguishes passing controlled lifecycle coverage from email-delivery limits.
- [x] Audit the production bundle and apply only materially useful route-level code splitting without changing the approved UI.
- [x] Remove every temporary controlled E2E business record, Auth user, and Auth identity after final browser validation.
- [x] Run and document explicit accessibility verification for auth and authenticated views, including keyboard order, visible focus, labels, dialog behavior, alerts, and reduced-motion semantics.
- [x] Verify and document the auth error alert semantics and re-run the final production build after the accessibility changes.
- [x] Commit the verified Stage 3 source and report on `stage-3-beta-readiness`, recording the immutable release hash.
- [x] Push and verify the `stage-3-beta-readiness` GitHub upstream without force-pushing or altering protected tags.
- [x] Create and verify the annotated `stage-3-beta-readiness` tag, save the final project checkpoint, and record release status in the report.

## Stage 4 Founder Lifetime Monetization

- [x] Validate the Stage 3 baseline, current entitlements and claims schema, repository state, and secure admin authorization approach without exposing an admin secret to the browser.
- [x] Add reproducible Stage 4 schema, RLS, constraints, indexes, and secure RPCs for immutable Founder purchase claims, protected entitlements, audit events, plan configuration, duplicate UTR prevention, and 50-seat cap enforcement.
- [x] Implement atomic, server-authorized Founder claim creation, cancellation/retry, approval, rejection, revocation, entitlement activation, audit logging, and privacy-conscious analytics events.
- [x] Extend the Free-plan receivable limit to permit additional active receivables only for an active Founder entitlement and retain existing records after revocation.
- [x] Build the mobile-first Founder purchase, UPI instructions, QR, copy/open-intent, UTR submission, payment-status, support, and Founder badge experiences without fabricating a real payment destination.
- [x] Build the minimum separate admin claim-review view with protected pending-claim listing, manual bank-history reminder, approve/reject/revoke controls, and no unnecessary customer receivable access.
- [x] Update privacy and terms copy for manual payment verification, zero payment-credential storage, Founder limitations, manual refund policy decision, and business-compliance notice.
- [x] Re-run the final Stage 4 regression suite after adding the customer-visible cancel-and-retry browser path; record automated coverage separately from the live Supabase authorization and capacity matrix.
- [x] Finalise Stage 4 responsive and accessibility evidence at 360/390/430/768/1440, including labelled input focus, semantic QR/status messaging, bundle impact, production build, dependency audit, and secret scan.
- [x] Correct the Founder claim reference-state constraint so a cancelled unsubmitted draft remains valid and an owner can retry through the protected workflow.
- [x] Commit, push, tag `stage-4-founder-monetization`, checkpoint, and deliver the exact Stage 4 readiness report without beginning Stage 5.
- [x] Remove the legacy global `(payer_name, utr_reference)` uniqueness constraint so multiple protected Founder drafts can coexist while retaining status-aware duplicate UTR prevention.
- [x] Run a controlled authenticated browser E2E for Founder navigation, live offer display, QR rendering, manual payment-reference submission, pending-review state, and sign-out using an isolated fixture.
- [x] Create `stage-4-1-release-hardening` from the verified Stage 4 branch without merging to main or changing prior tags.
- [x] Audit product imports, tests, scripts, and build requirements; remove unused Manus, Node-server, tRPC, storage, database, and deployment scaffolding while retaining only static Vite and browser-safe Supabase dependencies.
- [x] Convert canonical development and production scripts to independent static Vite behavior, remove Manus runtime/debug artifacts and host allowlists, and document every removed dependency.
- [x] Add searchable existing-client selection plus an explicit new-client option to Add Receivable, routing existing selections through `createForClient` without automatic name-based client merging.
- [x] Add the authoritative Free-plan fourth-receivable Founder limit state, including stale database-rejection translation and a real `/founder` CTA while preserving the database limit.
- [x] Implement and secure an idempotent, audited, capacity-protected admin-only reconsideration workflow for rejected Founder claims without weakening duplicate-UTR prevention.
- [x] Document recommended GitHub main-branch protections without configuring a real operator account or changing repository settings.
- [x] Add a correctness-focused ESLint gate and free GitHub Actions CI that runs safe checks without live Supabase credentials on untrusted pull requests.
- [x] Update README and Stage 4.1 documentation for the provisional product, static Supabase architecture, Founder workflow, security model, zero-cost intent, release blockers, and no-deployment boundary.
- [x] Document the exact Stage 4.1 dependency and scaffold removals, then re-verify the independent static preview has no live `server/_core` or Manus-runtime module errors.
- [x] Add and run static, unit, and controlled browser coverage for existing-client reuse, Free-to-Founder conversion, Founder entitlement bypass, reconsideration authorization, and all security regressions.
- [x] Run the Stage 4.1 dependency, bundle, build, lint, test, migration, browser, audit, and credential-source verification suite; report before/after evidence.
- [x] Commit, push, tag `stage-4-1-release-hardening`, and report PASS without merging, deploying, configuring real UPI, or beginning Stage 5.
- [x] Save the final Stage 4.1 project checkpoint, then stop before Stage 5.
- [x] Reconcile and verify the final live Supabase migration ledger contains all 11 committed Stage 4.1 migration names, then record the post-reconciliation schema fingerprint evidence in the final report.

## Stage 4.1.1 GitHub CI Recovery

- [x] Inspect the three failed GitHub Actions runs on `stage-4-1-release-hardening`, preserve their failure evidence, and confirm the duplicate pnpm-version root cause.
- [x] Remove only the redundant `pnpm/action-setup` version input while preserving `package.json` as the canonical pnpm declaration and retaining all CI gates.
- [x] Run frozen install, lint, typecheck, tests, build, production audit, and standard Vite startup locally without suppressing failures.
- [x] Push the CI repair normally, wait for a fully green GitHub Actions workflow, and inspect every required remote step.
- [x] Correct the Stage 4.1 report with initial failures, root cause, corrective commit, green run ID, and remote-step evidence.
- [x] Create and push `stage-4-1-ci-green` only at the exact green commit without moving an existing tag.
- [x] Save the final Stage 4.1.1 checkpoint, then stop before Stage 5.

## Stage 4.2 Real Operator Configuration and Payment Readiness

- [x] Create `stage-4-2-operator-readiness` from verified Stage 4.1.1 head `9e449e7e7749ea99e97abd5931e6d526ee239b62` without modifying existing tags or forcing history.
- [x] Establish and record the payment-readiness baseline: live offer remains `PLACEHOLDER`, no UPI destination, no real payment, and existing static/Supabase security boundaries preserved.
- [x] Verify and record that Stage 4.2 has made no real payment and created no approval or completed-payment artifacts beyond the existing placeholder offer state.
- [x] Verify bounded Founder claim, entitlement, and audit-event counts to substantiate the Stage 4.2 no-real-payment and no-activation baseline.
- [x] Verify and record that Stage 4.2 retains the independent static Vite architecture and browser-safe Supabase boundary without restoring Manus runtime, server code, or privileged frontend credentials.
- [x] Prepare configurable, truthful Founder payment disclosures, a centralized public support contact surface, and the proposed unapproved seven-day beta refund policy without fabricating support details or legal claims.
- [x] Prepare the operator-bootstrap and controlled-customer procedure without adding client-editable admin flags, frontend UUIDs, browser self-enrollment, secrets, payment gateways, or paid services.
- [x] Apply and verify the Stage 4.2 server-controlled support and founder-approved refund readiness migration while preserving the non-actionable offer state and passing local lint, tests, typecheck, and build.
- [x] Superseded by the approved Stage 4.2A non-live scope: do not request, obtain, or store a real operator identity, UPI VPA, payee name, or support address.
- [x] Superseded by the approved Stage 4.2A non-live scope: do not configure a real trusted operator or controlled live Founder offer.
- [x] Complete the reusable UPI URI, QR, and generic mobile-intent layer with an isolated TEST-only fixture, independent decoding, exact ₹499 INR assertions, and no production fallback.
- [x] Align the single server-controlled and client-side readiness evaluator to fail closed unless a future `LIVE` offer has a valid VPA, payee, ₹499 price, support contact, approved refund terms, and required disclosures.
- [x] Complete and verify truthful desktop and 360px, 390px, and 430px mobile Founder purchase UX for `PLACEHOLDER`, including disabled QR, copy, intent, claim, and payment-submission actions.
- [x] Complete and verify claim-state, admin-review, duplicate-UTR, seat-cap, entitlement, Free-to-Founder, analytics, privacy, and terms coverage with disposable fixtures only; remove all temporary reviewer and entitlement fixtures.
- [x] Re-run all specified security, browser, responsive, QR, and controlled workflow validation while preserving ordinary-user denial and no live operator configuration.
- [x] Re-run and record a clear PASS for the controlled Founder placeholder browser suite at desktop plus 360px, 390px, and 430px, including absence of QR, intent, claim, copy, and submission actions.
- [x] Execute and record disposable-fixture validation for duplicate UTR rejection, seat-cap protection, claim/admin-review lifecycle, entitlement behavior, Free-to-Founder conversion, analytics, privacy, and terms; then clean up every fixture.
- [x] Record exact passing results for the full Stage 4.2A security, browser, responsive, QR, and controlled workflow validation set, plus the final live `PLACEHOLDER` and zero-operator proof.
- [x] Remove the unused Stage 4.2A browser-test fixture variable that blocks the mandatory ESLint release gate, then rerun the full release suite.
- [x] Extend the existing secret-free CI workflow’s push trigger to the Stage 4.2A branch so the required remote verification can run without weakening any CI gate.
- [ ] Run lint, typecheck, tests, build, production audit, push the Stage 4.2A branch, verify fully green GitHub Actions, and record the Stage 4.2A pre-payment verdict.
- [x] Produce `stage4_2a_final_report.md` with the required PASS/FAIL evidence, remaining private inputs, live placeholder state, ₹0 real money, and explicit Stage 4.2B/Stage 5 stop boundary.
- [ ] Stop before a real payment, deployment, customer acquisition, Stage 4.2B live configuration, Stage 5, paid services, or public release.
