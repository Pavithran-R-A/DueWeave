# DueWeave — Stage 3 Beta-Readiness Final Report

**Report date:** 12 August 2026  
**Project:** PROJECT AR-1 / DueWeave  
**Release branch:** `stage-3-beta-readiness`  
**Scope boundary:** This report closes Stage 3 only. **Stage 4 has not been started.**

## VERDICT

**BETA READY, subject to the documented email-delivery limitation.** The authenticated receivables workflow is implemented against the connected Supabase project, protected by row-level security, validated through database matrices and browser automation, and has passed the final unit, type, production-build, dependency, and credential-scan gates. The release does not claim end-to-end receipt of email-confirmation or password-reset emails because no controlled inbox was available; confirmation policy and provider settings were not weakened to manufacture that evidence. [1] [2]

| Release gate | Result | Evidence |
|---|---:|---|
| Final unit and contract suite | PASS — 27 tests | Money, adapters, public config, logout, and security/workflow contracts [3] |
| Final Chromium suite | PASS — 6 tests | Gateway, full lifecycle, responsive dashboard, and accessibility smoke coverage [2] |
| TypeScript | PASS — 0 errors | `pnpm check` [3] |
| Production build | PASS | Route-split build completed successfully [3] |
| Production dependency audit | PASS — no known vulnerabilities | `pnpm audit --prod` [3] |
| Credential and history scan | PASS | Source, build output, reachable Git history, and current logs clean [3] |

## SUPABASE PROJECT

DueWeave uses the connected Supabase project **`dmteajorqysoenlwcmtb`** in **`ap-south-1`**. The browser receives only the public project URL and anonymous key through build-time environment configuration. No service-role key is present in frontend source, Git history, production output, or current local logs. The app’s real ledger data is accessed through authenticated Supabase requests and narrowly granted database functions rather than a custom privileged backend. [4]

## AUTHENTICATION

The app uses Supabase email/password authentication with protected application routes. Signed-out access to the ledger redirects to `/auth`; sign-in failures are rendered through a non-technical alert; password recovery avoids revealing account membership; and sign-out returns the user to the auth surface. The controlled browser run additionally exercised sign-in, persisted session reload, sign-out, and re-sign-in using a temporary confirmed fixture account. [2] [5]

The controlled account was deliberately created only for validation, supplied through local ignored environment variables, and fully deleted with its identity after the final suite. The test account’s business records were also removed. No E2E credential, temporary account identifier, or fixture data is committed in the repository. [1]

## DATABASE TABLES

The committed migrations reproduce the private ledger and supporting controls listed below. Monetary values are stored as integer paise; client-facing formatting happens only in the application layer. [4] [6]

| Area | Tables |
|---|---|
| Identity and plan controls | `profiles`, `entitlements`, `purchase_claims` |
| Ledger | `clients`, `receivables`, `promises`, `payments`, `activities`, `promise_events` |
| Minimal telemetry | `analytics_events` |

## MIGRATIONS

The schema is reproducible from five committed SQL migrations, applied in order. [4]

| Order | Migration | Purpose |
|---:|---|---|
| 1 | `20260812150500_secure_foundation.sql` | Base private-ledger schema and fundamental relationships |
| 2 | `20260812151500_stage2_schema_alignment.sql` | RLS, validation, transactional workflows, integrity controls, and plan enforcement |
| 3 | `20260812160000_revoke_anon_rpc_exec.sql` | Removes anonymous access to security-definer workflows |
| 4 | `20260812160500_revoke_unused_delete_rpc.sql` | Removes an unused authenticated deletion helper |
| 5 | `20260812170000_stage3_core_workflows.sql` | Standalone receivable creation, client validation, snoozing, and least-privilege grants |

## RLS STATUS

The final read-only database audit confirmed that RLS remains enabled across the private, user-facing tables and that the ownership boundary is enforced through `owner_id = auth.uid()` policies. The same audit confirmed that anonymous callers have no execution access to the relevant workflow functions, while authenticated callers receive only the intended least-privilege surface. [4] [7]

> **Security boundary:** A user must be technically unable to read or modify another user’s ledger rows, not merely hidden from them by the interface.

## ATTACK MATRIX

| Attempt | Expected control | Final result |
|---|---|---|
| Read or mutate a second user’s client, receivable, promise, payment, or activity | RLS ownership policy | PASS — isolated in live rollback-only matrices and contract coverage |
| Invoke workflow RPC anonymously | Function privilege revocations | PASS — final audit reports no anonymous execution rights |
| Bypass the Free plan by a direct insert or concurrent creation | Database-level active/open receivable guard | PASS — fourth active receivable rejected |
| Self-upgrade to `FOUNDER` | Protected entitlement write path | PASS — no user-controlled entitlement elevation path |
| Overpay or create non-positive monetary value | Transactional validation and paise checks | PASS — rejected without corrupting totals |
| Alter historical promise evidence through replacement | Immutable event/history model | PASS — replacement creates new history rather than rewriting old history |
| Surface raw database error details after auth or mutation failure | UI error normalization | PASS — browser gateway assertion confirms non-technical alert text |

## WORKFLOW VALIDATION

The authenticated Chromium lifecycle begins from an empty, real ledger and performs the user-facing journey: create a client, create a ₹10,000 receivable, create two promises, record a ₹2,500 partial payment, reload to verify a ₹7,500 persistent balance, record the final payment to ₹0, sign out, sign back in, and view retained paid history. The final suite passed all six Chromium tests after route splitting and accessibility improvements. [2]

| Workflow | Validation outcome |
|---|---|
| Client creation and refresh | Persistent creation and immediate dashboard refresh verified |
| Standalone receivable creation | Validated client, paise conversion, persisted balance, and Free-plan handling verified |
| Promise creation and replacement | New promise records are retained as immutable lifecycle history |
| Payment lifecycle | Partial and final payments update totals atomically; overpayment is rejected |
| Today queue | Authenticated metrics, priority reasons, and follow-up context come from private ledger data |
| Follow-up and snooze | Contacted state and snooze-until date persist without automatic message delivery |

## BROWSER E2E

The final Chromium run completed **6 passed / 0 failed** tests. It combines three credential-free auth-gateway tests, one full controlled lifecycle test, one real authenticated responsive-dashboard test, and one controlled accessibility smoke test. [2]

The responsive authenticated dashboard was exercised at **360, 390, 430, 768, 1024, and 1440 pixels**. Auth and authenticated empty-state views remain readable, actionable, and free of observed horizontal overflow at each required width. The 360px and 1440px screenshots were visually inspected; the dedicated responsive test asserts usability at all six breakpoints. [1]

## FREE PLAN ENFORCEMENT

The Free plan is enforced in the database rather than merely in the interface: a user may not retain more than three active/open receivables. Direct-bypass attempts and the fourth-receivable scenario were included in the Stage 3 validation matrix, and the UI maps the resulting safe error to a clear upgrade-oriented explanation. [3] [4]

## PROMISE INTEGRITY

Promise history is immutable. Renegotiation produces a replacement promise and preserves earlier history; state transitions are recorded rather than destructively overwritten. The dashboard lazily performs an idempotent overdue transition before reading the ledger, and the validation suite covers repeated invocation, broken promises, and history retention. [3] [4]

## DEMO DATA ISOLATION

Prototype seed data remains source-only and is never inserted into real authenticated accounts. The controlled browser fixture began with an empty ledger, and its records were removed after every completed run. The final fixture user and email identity were verified absent after the last browser suite. [1]

## FINANCIAL INTEGRITY

All money storage and domain calculations use integer paise. The Stage 3 tests cover parsing and validation, partial and final payment transitions, rejection of overpayment, exact remaining-balance computation, and transactional history updates. No floating-point money column or client-side balance mutation is used as the source of truth. [3] [6]

## TODAY QUEUE

The Today screen reads authenticated dashboard data, derives priority explanations deterministically, surfaces outstanding balances and promise context, and refreshes after client, receivable, promise, payment, snooze, and contacted-state mutations. Queue behavior includes persisted snooze dates and real empty states; it does not fabricate demo customers or activity. [3] [6]

## FOLLOW-UP / SNOOZE

Follow-up actions persist activity through the guarded database workflow. Snoozing updates the next attention date through the Stage 3 `snooze_follow_up` function and displays that date in the timeline. WhatsApp links are user-initiated deep links only; the product does not send messages automatically. [4] [6]

## TEST RESULTS

| Layer | Final result | Coverage highlights |
|---|---:|---|
| Vitest | 27 passed | Finance helpers, data adapters, public config, logout, RLS/security contracts, workflow invariants |
| Playwright Chromium | 8 passed | Protected route, safe invalid login, recovery entry, lifecycle, safe session loss, safe unavailable-signup handling, responsive views, accessibility smoke |
| TypeScript | 0 errors | Application and tests compile cleanly |
| Database matrices | PASS | Owner isolation, Free-plan enforcement, payment/promise integrity, snooze persistence |

## ACCESSIBILITY AND PERFORMANCE

The Stage 3 accessibility smoke check verifies input labels, keyboard order, visible focus treatment, reduced-motion timing, dialog semantics, initial dialog focus, Shift+Tab/Tab containment, Escape dismissal, focus return, and the non-technical auth alert region. The shared sheet primitive now implements focus trapping, Escape dismissal, and return-focus handling without visual redesign. [1] [2]

Route-level lazy loading was added for the Auth and Home surfaces. The main JavaScript entry reduced from **913.87 kB** to **745.38 kB** uncompressed in the production build; the authenticated Home route is emitted separately at **154.96 kB** and Auth at **14.93 kB**. Vite still emits a chunk-size advisory for the shared entry, which is recorded below as a non-blocking optimization opportunity. [3]

## DEPENDENCY SECURITY

`pnpm audit --prod` completed with **no known vulnerabilities**. The project continues to use Supabase, React, Vite, TypeScript, Vitest, and Playwright within the locked dependency graph. The informational pnpm configuration warning does not indicate a dependency vulnerability or build failure. [3]

## SECRET SCAN

The final value-sensitive scan covered current source, the current production output, every reachable Git commit, and current local logs. It found no service-role key, secret-key prefix, database connection URL, management token, or disposable E2E credential. Browser replay/console/network artifacts created by test automation were cleared before the final log scan so the temporary fixture identifier does not remain in local project logs. [3]

## PAID SERVICES

Stage 3 introduces **no paid runtime service**. The release remains within the stated zero-cost scope: Supabase Free, private GitHub hosting, no paid SMTP, no payment gateway, no paid API, and no runtime AI dependency. Payment tracking is ledger bookkeeping only; it does not process payments. [1]

## GITHUB

The project remains associated with the private repository `Pavithran-R-A/project-ar1`. The immutable Stage 3 product release commit is **`a36b7fb91a47ad80958b9bfba9a8e81f28f483da`**, pushed to the dedicated `stage-3-beta-readiness` branch and tracked at `github/stage-3-beta-readiness`. The annotated `stage-3-beta-readiness` tag resolves to that same release commit. The final project checkpoint also records version **`a36b7fb9`**. Existing `stage-1-approved` and `stage-2-secure-foundation` tags were not changed, and no force push was used.

## KNOWN LIMITATIONS

| Item | Status | Rationale and next action |
|---|---|---|
| Email confirmation and reset delivery | LIMITED | The UI, normalised unavailable-signup feedback, and non-enumerating recovery entry are verified, but no controlled mailbox was available to prove email receipt or complete an emailed reset. No Auth policy was weakened. Re-verify with an owned test inbox before relying on those emails operationally. |
| Session-expiry browser flow | LIMITED | Protected routes and expired/failed auth responses are handled safely, but an artificially expired live session was not forced in browser automation. |
| Bundle advisory | NON-BLOCKING | Route splitting reduced the initial entry materially, but Vite still reports a shared chunk above its advisory threshold. Further dependency-level splitting is an optimization, not a beta blocker. |
| Payment collection | OUT OF SCOPE | DueWeave records receivables and promises; it does not integrate a payment processor in this stage. |

## BETA READY

The Stage 3 acceptance criteria are met for the authenticated ledger, workflow integrity, RLS boundary, Free-plan enforcement, responsive and accessible core surfaces, regression coverage, secret hygiene, and zero-cost operational scope. Beta use should proceed with the documented email-delivery limitation visible to the project owner. [1] [2] [3] [4]

## READY FOR STAGE 4

**Ready for Stage 4 authorization only.** No Stage 4 design, schema, integration, payment, deployment, or implementation work has been started automatically.

## Evidence References

[1]: [Stage 3 browser QA notes](./stage3_browser_qa_notes.md)
[2]: [Playwright E2E specifications](./e2e/)
[3]: [Stage 3 test and security contract coverage](./server/stage2.security-contract.test.ts)
[4]: [Committed Supabase migrations](./supabase/migrations/)
[5]: [Authentication screen implementation](./client/src/pages/Auth.tsx)
[6]: [Authenticated dashboard workflow implementation](./client/src/pages/Home.tsx)
[7]: [Final read-only Supabase RLS and function-privilege audit record](../stage3_final_security_recheck.json)
