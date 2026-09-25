# DueWeave

> Repository working name: `PROJECT AR-1`

DueWeave is a mobile-first receivables and promise-to-pay ledger for Indian freelancers and small service businesses. The idea is simple: keep promised payment dates, partial payments and follow-up context in one place, so a founder can see who needs attention today without managing the process in a spreadsheet or chat history.

The product is **pre-deployment**. The repository contains an independently buildable static web client and versioned Supabase migrations, and the client is written against Supabase Auth and Postgres. Nothing in this repository is deployed, no real payment destination is configured, and no live external verification has been performed.

## What the app does

- a Today-first queue of receivables that need attention, with an explained priority order
- outstanding-cash summary across the whole book
- client and receivable detail views with the complete promise history
- promise-to-pay records that never overwrite earlier promises
- partial-payment tracking that keeps the remaining balance visible
- editable, respectful follow-up message drafts opened manually in WhatsApp
- snoozing that pauses a follow-up without erasing the timeline
- a manual-verification Founder Lifetime claim flow

All money values are integer paise end to end, and dates are handled on the India business calendar. Financial and date rules live in small pure helpers (`client/src/lib/finance.ts`) rather than inside UI components.

## Architecture

The application is a browser-only React/Vite single-page application. It uses the browser-safe Supabase URL and anonymous key for authenticated user operations; the security boundary is Supabase Auth plus database-enforced row-level security, constraints, and protected RPCs. There is no Node server, tRPC service, Manus runtime, server-side storage proxy, service-role key, payment gateway, or runtime AI component in this deliverable.

| Layer | Responsibility | Security boundary |
| --- | --- | --- |
| Static Vite client | Ledger UI, local presentation state, browser-safe Supabase calls, and optional QR rendering. | No privileged database or payment credential is bundled. |
| Supabase Auth | Email/password sessions and user identity. | Authenticated UUID is supplied to database policies. |
| Supabase PostgreSQL | Business records, ownership RLS, money/lifecycle constraints, and protected workflow RPCs. | `owner_id = auth.uid()` and security-definer functions perform authorization. |
| Trusted operator process | Manual bank-history review for Founder claims. | A server-controlled UUID allowlist in `founder_admins`; no browser-writable role. |

## Stack

- React 19 · TypeScript · Vite 7 · Tailwind CSS 4
- wouter routing, sonner toasts, lucide icons
- Supabase JS (browser-safe client only)
- Vitest for unit and contract tests, Playwright for the gated browser suite
- pnpm 10 with a committed lockfile and `packageManager` pin

## Run locally

Use Node 22 (the version CI is pinned to), or Node 24 as used for the Stage 2 local qualification, together with pnpm 10. The browser client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from a local ignored environment only. These are publishable browser configuration values, not a service role. Do not commit `.env` files, service-role keys, database passwords, UPI credentials, or manual-test credentials.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## Local Supabase development

These commands run Supabase entirely inside Docker on your machine. They provision **no hosted project**, never call `supabase link`, `supabase db push`, or any remote database, and require no Supabase account login.

Requirements: Docker-compatible runtime (Docker Desktop / Colima / OrbStack), Node 22 or newer, pnpm 10. The Supabase CLI is a pinned devDependency, so no global install is needed.

```bash
pnpm install --frozen-lockfile
pnpm supabase:start                      # first run pulls the images
node scripts/local-supabase-env.mjs      # writes browser-safe values into .env.local
pnpm db:reset:local                      # replay every committed migration from zero
pnpm db:types                            # regenerate client/src/types/database.generated.ts
pnpm test:stage2                         # executed auth/profile/data contract tests
pnpm dev                                 # DueWeave on the Vite dev server
pnpm supabase:stop
```

`supabase:status` prints the local URLs and keys. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` belong in `.env.local` or any `VITE_*` variable — the helper refuses a non-loopback URL and never writes a service-role/secret key, because `VITE_*` values ship inside the public bundle.

The browser journey needs the built app served on the port the suite expects, so run it in two terminals:

```bash
pnpm build && pnpm preview --port 3000 --strictPort --host 127.0.0.1   # terminal one
STAGE2_LOCAL_E2E=1 pnpm test:e2e:stage2                                # terminal two
```

`pnpm verify:stage2` chains the database half of that qualification (reset, type generation, executed contract tests) and does not start a server.

Local versus hosted: `supabase/config.toml` is local development configuration. It disables email signup confirmation so automated local tests receive a session without SMTP; a hosted project keeps its own Auth settings, and production email confirmation remains a later deployment decision.

## Verification

The canonical independent checks are:

```bash
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm audit --prod --audit-level=high
```

`pnpm lint` is real ESLint 10 (flat config, typescript-eslint, react-hooks) run with `--max-warnings=0`; `pnpm check` is `tsc --noEmit`. The unit tests cover INR/paise parsing and formatting, outstanding balances after partial payments, paid-state detection, India business-date handling, deterministic queue ordering, promise sequencing, snooze visibility, follow-up interpolation, and the repository/adapter column contract. They also cover the Stage 2 boundary contracts: no production file may import the demo dataset, and no privileged credential may appear in browser source or in the built bundle.

`tests/stage2-local-foundation.test.ts` runs against the local Docker stack and skips itself when `.env.local` does not point at a loopback Supabase URL, so a machine without the stack still gets a green `pnpm test`. With the local stack running it executes 12 real auth, profile, RPC, constraint and row-level-security checks. One further test targets a hosted project and always skips unless hosted credentials are supplied.

The Playwright suite is intentionally not run in CI because it needs a manually started server. Against the local stack, the signed-out auth-gateway specs and the Stage 2 signup/signout/sign-in journey run without any supplied credentials; the remaining authenticated journeys still skip until `E2E_EMAIL` and `E2E_PASSWORD` are provided through a local ignored environment, and are not part of Stage 2.

```bash
pnpm exec playwright install chromium
pnpm build
pnpm preview --port 3000 --strictPort --host 127.0.0.1   # serve dist on the port the suite's default baseURL expects
pnpm test:e2e               # in a second terminal
```

## Founder workflow

Founder Lifetime is a manual-verification flow, not a payment processor. The configured offer currently remains an enabled **PLACEHOLDER** with no UPI destination. A customer can create a protected claim only when payment instructions are configured. A submitted reference is checked manually against business bank history by an allowlisted reviewer, who can approve, reject, revoke, or—after an explicit recheck—reconsider a rejected claim. The database prevents self-activation, duplicate UTR reuse, unapproved changes, and non-atomic seat-cap bypasses. Claim and audit history are preserved.

The Free plan's active-receivable limit remains database-enforced. The application translates an authoritative limit rejection into a direct `/founder` conversion path; it does not pretend that a client-side state change grants entitlement.

## Operator and release runbooks

Read [trusted-operator bootstrap guidance](docs/OPERATOR_BOOTSTRAP.md) before allowlisting any reviewer. Read [repository release-protection guidance](docs/RELEASE_PROTECTION.md) before enabling branch rules. Those documents are instructions only and do not create users, activate payments, or alter GitHub settings.

## Zero-cost intent and current blockers

The design targets Supabase Free, GitHub Free, static hosting, and no paid payment gateway, SMTP service, or runtime AI. Before any public launch, the owner must separately configure and verify a real business payment destination, publish approved privacy/terms/refund/support details, establish a manual-review operating procedure, set repository protections, and independently verify the deployed environment. None of that configuration or deployment has occurred.

## Code notes

- `client/src/config/brand.ts` keeps the product identity and its local brand assets in one place.
- `client/src/lib/finance.ts` contains the reusable money/date/priority logic.
- `client/src/data/supabase-*.ts` are the per-table persistence adapters; `supabase-adapters.ts` maps rows to domain types.
- `client/src/data/demo.ts` contains fictional example data used only by tests.
- `client/src/types/database.generated.ts` is committed and regenerated from the live local schema with `pnpm db:types`; it is prettier-ignored so formatting runs cannot churn it.
- `scripts/local-supabase-env.mjs` reads `supabase status` and writes only the two browser-safe `VITE_*` values.
- `supabase/migrations/` holds the versioned schema, RLS policies, and protected RPCs.

## Status and boundaries

This is intentionally not presented as a production billing system. It is a source-only, undeployed repository: no environment is live, no payments are processed, and no email delivery is configured. Introducing any of those is separate, explicitly requested work.
