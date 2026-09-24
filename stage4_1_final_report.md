# PROJECT AR-1 / DueWeave — Stage 4.1 Hardening Final Report

**Stage:** 4.1 / 4.1.1 — independent release hardening and GitHub CI recovery
**Prepared:** 14 August 2026 (IST)
**Status:** Final, verification-backed, and bounded to Stage 4.1

## Verdict

**PASS — Stage 4.1 release hardening is complete within its approved scope.** DueWeave now runs as an independent static Vite application with a browser-safe Supabase client, retains the approved Quiet Ledger interface, and has completed the requested explicit existing-client, Free-to-Founder, reconsideration, quality-gate, security-scan, and controlled-browser validation work. No Stage 5 work, deployment, public release, payment-gateway integration, real UPI configuration, or force-push was performed.

> **Stop boundary:** This report closes Stage 4.1. The application is **ready for Stage 5 only when explicitly requested**; Stage 5 has not been started.

| Release decision | Result |
|---|---|
| Independent static Vite architecture | **PASS** — Node/Express/tRPC/Manus runtime scaffolding has been removed from the current source tree. |
| Existing-client receivable flow | **PASS** — the user must explicitly choose an existing client; no name-based merging or silent client creation is used. |
| Free-to-Founder conversion journey | **PASS** — a database-authoritative fourth-active-receivable denial is translated into a real `/founder` call to action. |
| Secure rejected-claim reconsideration | **PASS** — review is allowlisted, requires explicit bank-history confirmation, is idempotent, and writes audit evidence. |
| Controlled browser validation | **PASS** — two isolated Stage 4.1 scenarios passed and were removed afterwards. |
| Production quality and security gates | **PASS** — lint, tests, typecheck, build, credential scan, and production dependency audit passed. |
| Real payment collection | **INTENTIONALLY NOT ENABLED** — the live offer remains a no-destination placeholder. |
| Stage 5 | **NOT STARTED** |

## Supabase project and reproducible schema

The verified Supabase project is `dmteajorqysoenlwcmtb` in `ap-south-1`. The release remains within the zero-cost product constraint: Supabase Free, GitHub Free, no paid SMTP, no payment gateway, no paid API, and no runtime AI service. All money remains integer paise, and the owner-scoped RLS model remains the non-negotiable authorization boundary. [1] [2]

The committed migration set contains **11 ordered migrations**. The critical schema correction for browser fixtures is retained: `receivables.label` is the current column name; it replaced the earlier `title` field during Stage 2. [2]

The live Supabase migration ledger now records **all 11 committed migration names**. The three previously unrecorded corrective migrations were safely reconciled through the authorized migration workflow by reapplying their reviewed, idempotent SQL definitions. A post-reconciliation, read-only live-schema fingerprint confirmed the pending-review return function, reconsideration function, removal of the legacy draft-reference constraint, cancelled-draft check constraint, status-aware UTR index, and protected `RECONSIDER` transition guard. Supabase records deployment-time migration versions; the committed filenames remain the stable, reproducible source-of-truth identifiers. [8] [14] [15] [16]

| Migration | Purpose |
|---|---|
| `20260812150500_secure_foundation.sql` | Secure core ledger schema, ownership relationships, integrity checks, RLS baseline, and immutable history controls. |
| `20260812151500_stage2_schema_alignment.sql` | Specification alignment, owner-safe workflows, Free-plan gate, and `receivables.title` → `receivables.label`. |
| `20260812155500_revoke_public_rpc_execution.sql` | Revokes default public execution of privileged RPCs. |
| `20260812160500_revoke_unused_delete_rpc.sql` | Revokes an unused deletion helper. |
| `20260812170000_stage3_core_workflows.sql` | Protected Stage 3 ledger workflows. |
| `20260813030000_stage4_founder_monetization.sql` | Founder offer, claim, entitlement, audit, reviewer, duplicate-reference, and seat-cap controls. |
| `20260813030500_stage4_harden_admin_helpers.sql` | Removes public execution from internal reviewer helpers. |
| `20260813031000_stage4_fix_pending_claim_return_types.sql` | Stabilizes the restricted reviewer-queue return contract. |
| `20260813031500_stage4_drop_legacy_draft_reference_constraint.sql` | Removes an obsolete empty-draft uniqueness constraint without weakening protected duplicate-UTR rejection. |
| `20260813032000_stage4_allow_cancelled_empty_reference.sql` | Allows cancelled, unsubmitted drafts to keep empty payer/reference values. |
| `20260814090000_stage4_1_founder_claim_reconsideration.sql` | Adds the protected reconsideration workflow for rejected Founder claims. |

## Static architecture conversion

The current release candidate is a static Vite frontend. The previous template’s application server, database runtime, deployment runtime, and Manus-specific bridge are absent from the working tree. Browser data access is confined to the existing browser-safe Supabase client configuration; there is no service-role secret or server runtime in the deliverable. [3] [4]

| Removed category | Removed examples |
|---|---|
| Server and template scaffolding | `server/`, `shared/`, `drizzle/`, Manus debug collector, `components.json`, and obsolete template metadata. |
| Runtime packages | tRPC, React Query, Drizzle, MySQL, AWS S3 SDKs, `jose`, cookie/session runtime packages, `vite-plugin-manus-runtime`, and the removed server toolchain. |
| Unused frontend scaffolding | Form/resolver dependencies, unused Radix component inventory, template-only hooks, and corresponding lockfile entries. |
| Configuration | Independent Vite build/dev/test configuration and a correctness-focused ESLint configuration. |

The final production build completed successfully. Vite reports one non-blocking shared-chunk advisory: the main bundle is **665.33 kB minified / 190.90 kB gzip**. Founder routes remain separately loaded, and further shared-chunk tuning is intentionally deferred because it is not required to satisfy this hardening scope.

## Existing-client and Free-to-Founder product paths

The Add Receivable sheet now presents an explicit choice between **Existing client** and **New client**. Existing-client mode has a searchable picker and routes through the client-specific creation path. The user sees an explicit statement that DueWeave does not merge people by name, which prevents accidental name-based reuse or silent creation. [5] [6]

When the database rejects a fourth active Free-plan receivable, the dashboard renders persistent conversion guidance instead of a raw error. The user can choose **View Founder access**, which routes to the real protected `/founder` page. The database trigger remains authoritative; the UI does not substitute for or bypass it. [2] [7]

| Scenario | Expected control | Verified result |
|---|---|---|
| Existing client | Deliberate search and selection only | Browser test selected the pre-existing controlled client, saved a receivable, and displayed the success state. |
| Client identity | No implicit matching by name | Static contract test and browser copy/assertion confirm explicit selection. |
| Fourth Free active receivable | Database rejects the operation | Controlled three-active fixture received the Free-plan limit state. |
| Conversion | Offer an honest route, not an entitlement change | Browser test opened `/founder`; Founder entitlement was not self-activated. |

## Reconsideration workflow and attack matrix

The Stage 4.1 migration introduces `reconsider_founder_claim(claim_id, bank_verified, note)`. It is restricted to allowlisted Founder reviewers, rejects absent or false bank-history confirmation, preserves the original UTR/reference, writes an immutable audit record, and is idempotent after approval. It does not create a browser-write path to reviewer allowlisting, entitlement activation, or audit history. [8] [9]

| Probe | Expected outcome | Verification result |
|---|---|---|
| Ordinary authenticated user invokes reconsideration | Authorization denial | **PASS** — no review, entitlement, or audit mutation was allowed. |
| Allowlisted reviewer without `bank_verified = true` | Explicit verification-gate denial | **PASS** — a reviewer cannot approve based on presence alone. |
| Allowlisted reviewer with explicit confirmation | Protected approval | **PASS** — the claim was approved through the controlled workflow. |
| Repeat the same reconsideration request | Idempotent response | **PASS** — no duplicate entitlement or duplicate approval transition occurred. |
| Original payment reference / UTR | Preserve historical value | **PASS** — no reference rewrite was permitted. |
| Audit history | Append immutable review evidence | **PASS** — the protected audit record remained available. |
| Duplicate UTR protection | Remain active after reconsideration support | **PASS** — status-aware database uniqueness remains in force. |
| Founder capacity | Remain atomic | **PASS** — the existing advisory-lock seat-cap control is retained. |

## Controlled browser evidence and cleanup

The new `e2e/stage41-client-conversion.spec.ts` executed in Chromium against two temporary, authenticated Supabase accounts. It passed **2/2** scenarios in **11.4 seconds**: explicit reuse of an existing client, and the Free-plan database denial followed by the genuine Founder route with a temporary TEST offer. [10]

The test-only UPI destination was clearly marked `TEST`, used only during the browser run, and was removed afterwards. Because browser interaction generated immutable ledger history, cleanup used a single transaction scoped to the two fixed disposable owner IDs, temporarily disabled only the relevant immutability triggers, removed only the controlled records, re-enabled every trigger before commit, and deleted the temporary Auth users. Post-cleanup verification returned **zero remaining fixture users**, `payment_destination_status = PLACEHOLDER`, and `upi_id IS NULL`.

| Browser scenario | Result |
|---|---|
| Existing-client picker → save receivable | **PASS** |
| Three-active Free account → attempted fourth receivable → Founder CTA | **PASS** |
| Founder route with temporary TEST destination | **PASS** |
| Fixture deletion and offer reset | **PASS** — no temporary account remains; no payment destination remains. |

## Quality, CI, documentation, and security evidence

The release introduces a secret-free GitHub Actions workflow that runs linting, typechecking, tests, and the production build without live Supabase credentials. It also adds a release-protection runbook, trusted-operator bootstrap guide, static-architecture inventory, and current README. [3] [11] [12] [13]

| Check | Final result |
|---|---|
| Vitest | **37 tests passed** across **6 test files**. |
| TypeScript | `pnpm check` passed with zero errors. |
| ESLint | `pnpm lint` passed with `--max-warnings=0`. |
| Production build | `pnpm build` passed. |
| Controlled Stage 4.1 Chromium E2E | **2 tests passed**. |
| Live migration verification | **PASS** — all 11 committed migration names are recorded in the Supabase ledger, and the post-reconciliation schema fingerprint passed. |
| Credential scan | **PASS** — scoped source, production build, and reachable Git history contained no credential-shaped value or Stage 4.1 fixture password. |
| Static architecture scan | **PASS** — current working tree has no `server/`, `shared/`, or `drizzle/` scaffold. |
| Production dependency audit | `pnpm audit --prod`: **No known vulnerabilities found**. |
| GitHub CI | **PASS** — corrective commit `0971f8bc694bd6d14117e0e6677e74d1661c4910` completed remote run `31812353314` successfully, with every required step green. |

The production bundle contains the standard Supabase JWT-header literal in dependency code, which is not a credential. The focused scan separately checked actual database URLs, management-token shapes, service-secret shapes, Stripe-key shapes, GitHub-token shapes, and the disposable fixture password; no such value was found in source, build output, or reachable history.

## Stage 4.1.1 — GitHub CI recovery

### Verdict

**PASS.** The CI repair was deliberately limited to removing the duplicate version input from `pnpm/action-setup`. The `packageManager` declaration in `package.json` remains the canonical pinned pnpm version, and every original CI gate remains mandatory.

### Original GitHub failures

GitHub Actions recorded **three initial failed CI runs** on this branch: `31783675109` for `c6afe9e`, `31783743196` for `a6726da`, and `31783796664` for `950a67b`. Each failure occurred in **Set up pnpm**, before locked dependency installation. The remote log identified two pnpm declarations: `version: 10.4.1` in `.github/workflows/ci.yml` and the integrity-pinned `packageManager` declaration in `package.json`.

### Fix and local verification

| Item | Result |
|---|---|
| Corrected file | `.github/workflows/ci.yml` |
| Exact change | Removed only `with: version: 10.4.1` from `pnpm/action-setup@v4`; preserved the action, Node setup, frozen install, lint, typecheck, tests, build, and audit steps. |
| Corrective commit | `0971f8bc694bd6d14117e0e6677e74d1661c4910` — `fix: repair GitHub CI pnpm setup` |
| `pnpm install --frozen-lockfile` | **PASS** — lockfile remained current; pnpm `10.4.1` used. |
| `pnpm lint` | **PASS** — zero warnings allowed. |
| `pnpm check` | **PASS** — zero TypeScript errors. |
| `pnpm test` | **PASS** — 37 tests across 6 files. |
| `pnpm build` | **PASS** — independent Vite production build. |
| `pnpm audit --prod --audit-level=high` | **PASS** — no known production vulnerabilities. |
| `pnpm dev` | **PASS** — standard Vite started successfully on port `5174` because the managed development server already occupied `5173`. |

> **MANUS INTEGRATED PREVIEW NOT REQUIRED.** The recovery validates the normal static Vite command and does not restore any Manus-specific runtime package or server infrastructure to address preview behavior.

### Remote GitHub Actions evidence

GitHub Actions run **`31812353314`** for corrective commit `0971f8bc694bd6d14117e0e6677e74d1661c4910` completed with conclusion **success**. The remote workflow confirmed the following required steps were all green.

| Remote step | Result |
|---|---|
| Checkout | **PASS** |
| Set up pnpm | **PASS** |
| Set up Node | **PASS** |
| Install locked dependencies | **PASS** |
| Lint | **PASS** |
| Type-check | **PASS** |
| Unit and static contracts | **PASS** |
| Independent production build | **PASS** |
| Production dependency audit | **PASS** |

The recovery creates annotated tag `stage-4-1-ci-green` at the exact green corrective commit. The three initial failures remain visible in GitHub Actions history and are not hidden or rewritten.

### Preservation confirmation

| Boundary | Result |
|---|---|
| Static independence | **PASS** — static Vite frontend and browser-safe Supabase client retained; no Express server, tRPC runtime, Manus runtime package, AWS SDK, MySQL, or Drizzle restored. |
| Product flows | **PASS** — explicit existing-client creation, database-authoritative Free-to-Founder conversion, and rejected-claim reconsideration remain present. |
| Payment destination | **PLACEHOLDER** — a final read-only live query returned `payment_destination_status = PLACEHOLDER` and no UPI destination. |
| Real money collected | **₹0** — no payment collection was enabled or performed. |
| Secrets | **PASS** — no service-role secret was introduced to frontend or repository sources. |

## GitHub and release status

The release candidate is prepared on the private branch `stage-4-1-release-hardening` in [`Pavithran-R-A/project-ar1`](https://github.com/Pavithran-R-A/project-ar1). The original hardening tag remains untouched, and `stage-4-1-ci-green` is an additional annotated tag at the exact remote-green corrective commit. Existing tags — `stage-1-approved`, `stage-2-secure-foundation`, `stage-3-beta-readiness`, and `stage-4-founder-monetization` — are preserved and are not rewritten.

## Known limitations and operator prerequisites

> These are intentional product boundaries, not silent release defects.

| Item | Current state and required action before broader commercial use |
|---|---|
| Real UPI destination | Not configured. The offer is enabled but remains `PLACEHOLDER` with `upi_id = null`; configure and independently validate a verified business destination before accepting real payments. |
| Payment confirmation | There is no automated payment confirmation; manual bank-history review remains required. |
| Support and refunds | A real support channel and operator-approved refund terms must be established before broad public sales. |
| Banking privacy | The product must continue never to request, store, or transmit UPI PINs, OTPs, bank passwords, banking logins, or card credentials. |
| Transactional history | Production history remains immutable. The narrowly scoped fixture cleanup procedure must not be used for customer data. |
| Migration identifiers | Supabase stores deployment-time migration versions; use the committed 11 migration filenames as the stable schema-source identifiers when comparing environments. |
| Email delivery | Supabase default-email quotas and deliverability limits remain; no paid SMTP service was added. |
| Performance | The Vite shared-chunk advisory is non-blocking; optimize further only if measured field performance justifies it. |

## Final status

**STAGE 4.1 / 4.1.1 COMPLETE — READY FOR CONTROLLED OPERATOR CONFIGURATION; READY FOR STAGE 5 ONLY ON EXPLICIT REQUEST.** The release preserves the approved product interface while adding explicit existing-client reuse, truthful Free-to-Founder conversion, secure reconsideration, static-runtime independence, and a remotely verified GitHub CI repair. The product remains deliberately non-deployed and non-payment-enabled. **No Stage 5 work has been started.**

## References

[1]: ./supabase/migrations/20260812150500_secure_foundation.sql "Secure Supabase foundation"
[2]: ./supabase/migrations/20260812151500_stage2_schema_alignment.sql "Stage 2 schema alignment and Free-plan gate"
[3]: ./docs/STAGE_4_1_HARDENING.md "Stage 4.1 static architecture inventory"
[4]: ./package.json "Static Vite package manifest and quality scripts"
[5]: ./client/src/components/sheets.tsx "Explicit existing-client receivable sheet"
[6]: ./tests/client-flow.contract.test.ts "Existing-client and conversion static contracts"
[7]: ./client/src/pages/Home.tsx "Free-plan conversion guidance"
[8]: ./supabase/migrations/20260814090000_stage4_1_founder_claim_reconsideration.sql "Founder rejected-claim reconsideration migration"
[9]: ./tests/security-contract.test.ts "Security and reconsideration regression contracts"
[10]: ./e2e/stage41-client-conversion.spec.ts "Controlled existing-client and Founder conversion browser test"
[11]: ./.github/workflows/ci.yml "Secret-free continuous integration workflow"
[12]: ./docs/RELEASE_PROTECTION.md "GitHub release-protection runbook"
[13]: ./docs/OPERATOR_BOOTSTRAP.md "Trusted Founder-review operator bootstrap guide"
[14]: ./supabase/migrations/20260813031000_stage4_fix_pending_claim_return_types.sql "Pending-review queue return-type correction"
[15]: ./supabase/migrations/20260813031500_stage4_drop_legacy_draft_reference_constraint.sql "Legacy draft-reference constraint correction"
[16]: ./supabase/migrations/20260813032000_stage4_allow_cancelled_empty_reference.sql "Cancelled-draft reference-state correction"
