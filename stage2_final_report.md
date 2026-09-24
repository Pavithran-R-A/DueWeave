# PROJECT AR-1 / DueWeave — Stage 2 Final Report

**Report date:** 12 August 2026  
**Scope:** Secure Supabase foundation only. No Stage 3 work was started.

## STAGE 2 VERDICT

**PASS.** The approved Stage 1.2 interface is now protected by Supabase email/password sessions and uses RLS-backed, transactional persistence. The stage is a secure foundation rather than public-production approval.

## SUPABASE PROJECT

| Item | Status |
|---|---|
| Name | `project-ar1` |
| Region | `ap-south-1` |
| Plan | Supabase Free |
| Cost | $0/month |
| Connection status | Connected and queried through the configured Supabase integration |

No credential, service-role key, database password, or management token is included in this report or source tree.

## AUTHENTICATION

Email/password sign-up, sign-in, sign-out, password reset, and password update are implemented through Supabase Auth. Session state is restored with `getSession`, subscribed via `onAuthStateChange`, and used to gate `/`; stale/anonymous sessions are redirected to `/auth` in an effect rather than during render. The authenticated route cannot render the ledger until the session state resolves.

Public Auth settings confirm that sign-up is enabled and `mailer_autoconfirm` is `false`; email confirmation is therefore required when the Supabase Auth service is configured to send it. No paid SMTP provider has been configured. Reset and confirmation delivery use Supabase's default mail capability and remain subject to its Free-plan limits and deliverability constraints. User-facing errors are mapped to calm messages rather than raw service/database errors.

## DATABASE TABLES

`profiles`, `clients`, `receivables`, `promises`, `payments`, `activities`, `promise_events`, `entitlements`, `purchase_claims`, and `analytics_events` are present in the committed schema. Monetary fields use integer paise (`bigint`).

## MIGRATIONS

| Migration | Purpose |
|---|---|
| `20260812150500_secure_foundation.sql` | Base tables, ownership controls, RLS, triggers, and RPC foundation |
| `20260812151500_stage2_schema_alignment.sql` | Schema alignment, integrity triggers, transactional workflows, promise and payment behavior |
| `20260812155500_revoke_public_rpc_execution.sql` | Revokes default `PUBLIC`/`anon` execution of security-definer RPCs and grants only intended workflows to `authenticated` |
| `20260812160500_revoke_unused_delete_rpc.sql` | Removes authenticated execution of the unused business-deletion helper |

## RLS STATUS

| Private table | RLS | Policy summary |
|---|---:|---|
| `profiles` | YES | User identity is constrained to `auth.uid()`; plan changes are protected by trigger. |
| `clients` | YES | Owner-scoped select/insert/update/delete using `owner_id = auth.uid()`. |
| `receivables` | YES | Owner-scoped select/insert/update/delete; cross-tenant relationship checks and free-plan trigger apply. |
| `promises` | YES | Owner-scoped access through the owner-bound receivable; status history is guarded. |
| `payments` | YES | Owner-scoped through the owner-bound receivable; writes are routed through atomic payment RPC. |
| `activities` | YES | Owner-scoped through the owner-bound receivable; follow-ups are routed through the workflow RPC. |
| `promise_events` | YES | Owner-scoped read access; immutable event history. |
| `entitlements` | YES | User-bound read policy; users cannot self-upgrade to `FOUNDER`. |
| `purchase_claims` | YES | Owner/user-bound access; no client-side entitlement mutation path. |
| `analytics_events` | YES | Owner/user-bound private analytics records. |

The security-contract suite asserts RLS is enabled for every listed table, rejects permissive private `USING (true)` policies, and requires `auth.uid()` ownership checks.

## USER A VS USER B ATTACK MATRIX

| Attempt | Result | Evidence |
|---|---|---|
| Read User B data as User A | PASS | Rollback-only live matrix reported read-IDOR protection; RLS owner predicates are committed and tested. |
| Insert data with a forged owner | PASS | `WITH CHECK` ownership policies and owner-integrity triggers are committed; migration contract test verifies `auth.uid()` ownership. |
| Update User B data as User A | PASS | Rollback-only live matrix reported update-IDOR protection. |
| Delete User B data as User A | PASS | Owner-scoped delete policies are present in migrations and no permissive policy passed the contract test. |
| Cross-tenant foreign-key reference | PASS | Integrity triggers prevent client/receivable/promise/payment cross-owner references; tested in rollback-only integrity matrix. |
| Owner forgery | PASS | Owner checks and server-side owner derivation block forged ownership. |
| Entitlement forgery | PASS | Entitlement/profile trigger prevents client self-upgrade; source contract and integrity matrix cover the boundary. |

The live rollback-only matrix returned: `PASS: anonymous, read IDOR, and update IDOR protections held under simulated roles`.

## ANONYMOUS ACCESS

**PASS.** Anonymous access was denied in the live matrix. Final function-privilege inspection confirmed `anon_can_execute = false` for all four exposed workflow RPCs as well as the internal user-provisioning and unused deletion helpers.

## FREE PLAN SERVER ENFORCEMENT

The `receivables_free_limit` database trigger/function enforces a maximum of three `OPEN`/active receivables for Free entitlement users. It executes within the transaction that creates the client and receivable, so browser state cannot bypass it. The rollback-only integrity matrix reported that the free limit held.

## PROMISE INTEGRITY

Promises are created through `create_promise`; payment recording uses `record_payment`; follow-up recording uses `record_contacted`. These security-definer workflows derive identity from `auth.uid()`, validate ownership and amounts, update the affected ledger state, and write associated activity/history records in one database transaction. `promise_events` provides an immutable audit trail; renegotiation preserves the old promise event trail rather than overwriting history. The live integrity matrix reported that promise audit trail and atomic partial-payment controls held.

## DEMO DATA ISOLATION

**PASS.** `client/src/data/demo.ts` remains a fixture only. The authenticated `Home.tsx` imports `SupabaseDashboardRepository`, never imports demo data, and never invokes `createDemoState`. A regression test asserts this boundary. New authenticated accounts load an empty private-ledger state with the prompt: “Start with the money you're waiting for. Add first receivable.”

## FRONTEND DATA LAYER

`SupabaseClientRepository`, `SupabaseReceivableRepository`, `SupabasePromiseRepository`, `SupabasePaymentRepository`, and `SupabaseActivityRepository` encapsulate RLS-backed reads and transactional RPC writes. `SupabaseDashboardRepository` aggregates the live dashboard state. `supabase-adapters.ts` converts database rows to the approved domain model and maps network/database failures to user-safe copy. `Home.tsx` provides explicit loading, retryable failure, and first-user empty states while preserving the existing Quiet Ledger components and sheets.

## UI REGRESSION CHECK

| Viewport | Result | Evidence |
|---:|---|---|
| 360px | PASS | Protected authentication layout captured and legible. |
| 390px | PASS | Mobile authentication layout captured after final server repair. |
| 768px | PASS | Tablet protected-auth layout captured. |
| 1440px | PASS | Desktop protected-auth layout captured; checkpoint preview confirms the same responsive system. |

The approved main shell remains assembled from the existing `AppRail`, `PageHeader`, queue, sheet, and timeline components; source-contract tests cover its live loading, error, and empty-state branches. A full authenticated business-data browser walkthrough is intentionally not claimed because no persistent QA customer account or data was created.

## TEST RESULTS

| Check | Result |
|---|---|
| Typecheck (`pnpm check`) | PASS |
| Lint (`pnpm lint`, TypeScript gate) | PASS |
| Unit/source-contract tests | PASS — 5 files, 19 tests |
| Integration tests | PASS — rollback-only live database attack and integrity matrices |
| Security/RLS tests | PASS — anonymous/read/update IDOR matrix, policy/RPC contract suite, live RPC privilege check |
| Production build | PASS — Vite client and Express server bundle built successfully |

The production build emits an advisory that the JavaScript bundle exceeds 500 kB after minification; this is a performance follow-up, not a failed build or security finding.

## DEPENDENCY SECURITY

`pnpm audit --prod --audit-level=high` returned **no known vulnerabilities**: critical 0, high 0, moderate 0, low 0. Direct dependencies were updated for the Axios, form-data, NanoID, Express, and Drizzle findings; unused vulnerable template dependencies were removed. No known production vulnerability remains from the audit at verification time.

## SECRET SCAN

**PASS.** Current source, production build output, and reachable Git history were scanned for service-role keys, `sb_secret` keys, database connection strings with credentials, and database environment assignments. No prohibited matches were found. The frontend uses only an ignored browser-safe Supabase URL and anonymous/publishable key.

## PAID SERVICES

**NONE.** The stage uses Supabase Free and GitHub Free; it uses no paid SMTP, payment gateway, messaging API, runtime AI, or deployment provider.

## GITHUB

| Item | Status |
|---|---|
| Repository | `Pavithran-R-A/project-ar1` |
| Privacy | Private |
| Default branch | `main` |
| Stage 2 branch | `stage-2-backend` tracking `github/stage-2-backend` |
| Secure-foundation commit | `e617058ad35e79389e8ad4b5faddf25a6269c009` |
| Tag | `stage-2-secure-foundation` |
| Working tree at verification | Clean |
| Remote sync | Branch remote SHA matched local SHA |

## KNOWN LIMITATIONS

1. No paid SMTP is configured. Supabase's Free/default email delivery and confirmation flows must be validated with a real controlled inbox before public use.
2. No persistent QA account or customer-like data was created; therefore the final UI evidence covers protected/authenticated gateway layouts, source-level state branches, and rollback-only database tests rather than a persistent end-to-end user data walkthrough.
3. No payment processor, notification delivery, WhatsApp integration, runtime AI, or public deployment was added.
4. The production bundle has a size advisory above 500 kB and should be code-split in a later optimization stage.
5. This project is intentionally not publicly deployed and no production traffic, deliverability, performance, or backup/restore exercise has been performed.

## PRODUCTION READY

**NO.** This is a verified secure foundation; it is not final public production approval.

## READY FOR STAGE 3

**YES.** The secure data and auth foundation is complete, subject to the known limitations above. **Stage 3 was not started automatically.**
