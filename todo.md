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
