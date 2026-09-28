# DueWeave

> Repository working name: `PROJECT AR-1`

DueWeave is a mobile-first receivables and promise-to-pay ledger for Indian freelancers and small service businesses. The idea is simple: keep promised payment dates, partial payments and follow-up context in one place, so a founder can see who needs attention today without managing the process in a spreadsheet or chat history.

The product is **pre-deployment**. The repository contains an independently buildable static web client and versioned Supabase migrations, and the client is written against Supabase Auth and Postgres. Nothing in this repository is deployed, no real payment destination is configured, and no live external verification has been performed.

## What the app does

- a guided first-run setup that names you and the workspace, and stores both in the database; an incomplete setup cannot be skipped by typing a URL
- a settings screen that shows the saved workspace identity, where the address, INR and the India business calendar are stated as fixed facts rather than presented as editable controls
- search over receivables and clients, composable with the Open / Paid / Cancelled / All status filters, with a distinct answer when a search simply matches nothing
- a Today-first queue of receivables that need attention, with an explained priority order
- outstanding-cash summary across the whole book
- client and receivable detail views with the complete promise history
- promise-to-pay records that never overwrite earlier promises
- partial-payment tracking that keeps the remaining balance visible
- five built-in follow-up tones you can choose between and edit before acting; the draft exists only while the form is open and DueWeave never stores or sends it
- a manual WhatsApp handoff — opening the conversation is not proof of sending, and DueWeave cannot see whether you pressed Send, so the timeline records a contact only when you confirm one ("I sent it", or "Contacted some other way")
- a full JSON data archive plus Clients, Receivables, Payments, Promises and Activity CSV exports from Settings. These are ordinary files your browser downloads, and they contain your sensitive business information
- snoozing that pauses a follow-up without erasing the timeline
- one stored browser preference — the light/dark theme. Signed-in session storage belongs to Supabase's own client; no ledger amount, client name or promise is written to browser storage
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

`pnpm lint` is real ESLint 10 (flat config, typescript-eslint, react-hooks) run with `--max-warnings=0`; `pnpm check` is `tsc --noEmit`. The unit tests cover INR/paise parsing and formatting, outstanding balances after partial payments, paid-state detection, India business-date handling, deterministic queue ordering, promise sequencing, snooze visibility, follow-up interpolation, and the repository/adapter column contract. They also cover the Stage 2 boundary contracts: no production file may import the demo dataset, and no privileged credential may appear in browser source or in the built bundle. Stage 7 adds pure-helper coverage for the follow-up truth model (which actions may and may not claim), phone-number normalization and the WhatsApp URL, the JSON envelope and CSV rules including formula-injection defence and UTF-8 escaping, and the download filename; plus a contract test that the export path touches no browser storage.

`tests/stage2-local-foundation.test.ts` runs against the local Docker stack and skips itself when `.env.local` does not point at a loopback Supabase URL, so a machine without the stack still gets a green `pnpm test`. With the local stack running it executes 12 real auth, profile, RPC, constraint and row-level-security checks. One further test targets a hosted project and always skips unless hosted credentials are supplied.

The Playwright suite is intentionally not run in CI because it needs a manually started server. Against the local stack, the signed-out auth-gateway specs and the Stage 2 signup/signout/sign-in journey run without any supplied credentials; the remaining authenticated journeys still skip until `E2E_EMAIL` and `E2E_PASSWORD` are provided through a local ignored environment, and are not part of Stage 2.

```bash
pnpm exec playwright install chromium
pnpm build
pnpm preview --port 3000 --strictPort --host 127.0.0.1   # serve dist on the port the suite's default baseURL expects
pnpm test:e2e               # in a second terminal
```

### Stage 6 first-user and product journeys

Stage 6's browser specs drive the real product against the local stack: signup states, the workspace gate, onboarding read-back, settings/profile editing, loading versus background refresh, error and retry, empty states, search and filters, toast/focus/dialog behaviour, the accessibility qualification, and the responsive width matrix. They gate themselves behind `STAGE6_LOCAL_E2E=1` so a machine without the stack skips rather than pretends:

```bash
pnpm build && pnpm preview --port 3000 --strictPort --host 127.0.0.1   # terminal one
STAGE6_LOCAL_E2E=1 pnpm test:e2e:stage6                               # terminal two
```

`tests/stage6-local-profile.test.ts` (part of `pnpm test`) covers the same profile authority model through the real authenticated PostgREST path: an owner reads and saves only `display_name` and `business_name`, another owner's row is invisible, and writes aimed at `id`, `plan`, `timezone` or `currency` are refused by the database.

### Stage 7 follow-up and portability journeys

Stage 7's browser specs assert what the product is allowed to claim. `e2e/stage7-local-followup.spec.ts` proves that copying a draft or opening a WhatsApp conversation writes no history — the link is intercepted so a test never reaches wa.me — and that a contact appears only after an explicit confirmation, once, even under a double click. `e2e/stage7-local-export.spec.ts` reads the bytes Chromium actually saved, checks the JSON envelope and each CSV against the ledger on screen, and proves a second account's data cannot appear in the first account's file. Both gate behind `STAGE7_LOCAL_E2E=1`.

```bash
pnpm build && pnpm preview --port 3000 --strictPort --host 127.0.0.1   # terminal one
STAGE7_LOCAL_E2E=1 npx playwright test e2e/stage7-local               # terminal two
```

The preview server serves `dist/`, so a browser run only measures the code you just wrote if `pnpm build` ran after it.

### Stage 8 Founder monetization journeys

Stage 8's specs measure the payment boundary instead of describing it. `e2e/stage8-local-founder-customer.spec.ts` proves the delivered build shows no destination, QR, UPI link or copy action at all; with a synthetic ready offer it compares the QR on screen pixel for pixel against a reference rendered independently from the canonical payment URI, and proves that opening that link leaves the claim a draft, the account Free and the history unchanged. `e2e/stage8-local-founder-reviewer.spec.ts` shows the queue is refused until one allowlist row exists, shows the last seat taken once with the next review refused as full and its claim left pending, and shows a card another review already settled refuses as already reviewed. Two reviews arriving at the same instant is proven against two concurrent authenticated clients in `tests/stage8-local-founder-readiness.test.ts`, not in the browser: a backgrounded tab on the qualification machine was measured issuing its approval 37.3s after its twin, so a two-tab race measures the queue's serialisation rather than the lock. Both gate behind `STAGE8_LOCAL_E2E=1`, and because they share the single `FOUNDER_V1` row they run with `--workers=1`.

```bash
pnpm build && pnpm preview --port 3000 --strictPort --host 127.0.0.1   # terminal one
STAGE8_LOCAL_E2E=1 pnpm test:e2e:stage8                               # terminal two
```

`pnpm test:stage8` runs the live contracts against the local database, and `pnpm test:db` runs the pgTAP catalog pins, including the Founder readiness and reviewer-boundary files. The journeys write a payment-ready offer only while running and restore the snapshot taken before the run, in an unconditional teardown, so a finished run leaves the placeholder behind. See [the readiness contract](docs/FOUNDER_PAYMENT_READINESS.md), [the activation checklist](docs/FOUNDER_LIVE_ACTIVATION_CHECKLIST.md) and [the configuration order of work](docs/STAGE_4_2_OPERATOR_CONFIGURATION.md).

The password-recovery journey reads the reset mail from the local Inbucket inbox (`STAGE6_INBOX_URL`, default `http://127.0.0.1:54324`). That proves the app's handling of a real recovery link on a local mail catcher only; `supabase/config.toml` disables signup confirmation, so nothing here verifies hosted SMTP, a hosted Site URL, or a redirect allow-list.

## Founder workflow

Founder Lifetime is manual-verification infrastructure, not a payment processor, and payments are not live. The delivered offer is an enabled `PLACEHOLDER` with no UPI destination, no configured support address, no approved refund text and no approved disclosures, so the customer page shows a setup notice and nothing payable. Support, refund and disclosure states are fail-closed prerequisites: the database re-checks each of them inside the claim RPCs, so an unconfigured or unapproved term closes the workflow whether or not the page agrees.

The current contract is ₹499.00 one time, stored as the integer `49900` paise, and the readiness conjunction refuses to open the workflow on any other amount. The price, the payee name and the VPA each have to be configured and independently verified before anything is payable.

A customer who starts a claim submits their own payment reference. Nothing about opening UPI proves anything: an intent, a scanned QR, a returned app, a focus change or a reload leaves the claim a draft, because payment success is only ever a reviewer's conclusion. A submitted reference reaches `/admin/founder-claims`, where an allowlisted reviewer compares it against business bank history held outside DueWeave and approves, rejects, or after an explicit recheck reconsiders a rejected claim. Taking access back is a separate server-side action, `revoke_founder_entitlement()`, and the review screen offers no control for it. The database prevents self-activation, duplicate UTR reuse, unapproved changes and non-atomic seat-cap bypasses, and preserves claim and audit history.

The application stores the payer name and reference a customer supplies, the configured offer amount, the verification status and review timestamps. It never stores and never asks for a UPI PIN, OTP, banking password, internet-banking login, card number, CVV or gateway key, and no field for any of them exists in the flow.

The Free plan's active-receivable limit remains database-enforced. The application translates an authoritative limit rejection into a direct `/founder` conversion path; it does not pretend that a client-side state change grants entitlement. No money is being collected here, and nothing in this repository accepts a payment.

## Operator and release runbooks

Read [trusted-operator bootstrap guidance](docs/OPERATOR_BOOTSTRAP.md) before allowlisting any reviewer. Read [repository release-protection guidance](docs/RELEASE_PROTECTION.md) before enabling branch rules. Those documents are instructions only and do not create users, activate payments, or alter GitHub settings.

## Zero-cost intent and current blockers

The design targets Supabase Free, GitHub Free, static hosting, and no paid payment gateway, SMTP service, or runtime AI. Before any public launch, the owner must separately configure and verify a real business payment destination, publish approved privacy/terms/refund/support details, establish a manual-review operating procedure, set repository protections, and independently verify the deployed environment. None of that configuration or deployment has occurred.

## Code notes

- `client/src/config/brand.ts` keeps the product identity and its local brand assets in one place.
- `client/src/lib/finance.ts` contains the reusable money/date/priority logic.
- `client/src/data/supabase-*.ts` are the per-table persistence adapters; `supabase-adapters.ts` maps rows to domain types.
- `client/src/data/supabase-profile-repository.ts` is the only path the app uses to read or save the signed-in owner's `profiles` row; views never query that table directly.
- `client/src/lib/profile.ts` holds the single onboarding rule (`business_name` blank means the workspace is not set up yet) — there is no separate completion flag in the database or the browser.
- `client/src/lib/ledger-search.ts` holds the case- and whitespace-tolerant matching used by receivable and client search.
- `client/src/data/demo.ts` contains fictional example data used only by tests.
- `client/src/types/database.generated.ts` is committed and regenerated from the live local schema with `pnpm db:types`; it is prettier-ignored so formatting runs cannot churn it.
- `scripts/local-supabase-env.mjs` reads `supabase status` and writes only the two browser-safe `VITE_*` values.
- `supabase/migrations/` holds the versioned schema, RLS policies, and protected RPCs.

## Status and boundaries

This is intentionally not presented as a production billing system. It is a source-only, undeployed repository: no environment is live, no payments are processed, and no email delivery is configured. Introducing any of those is separate, explicitly requested work.

Data portability is one-way. Exports are generated in your browser from your own rows and saved by the browser's download mechanism; nothing is uploaded, kept or queued anywhere, and there is no import path and no automatic or scheduled messaging.
