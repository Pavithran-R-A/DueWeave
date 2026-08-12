# DueWeave — PROJECT AR-1 Stage 2

DueWeave is the temporary working name for **PROJECT AR-1**, a mobile-first promise ledger for Indian independent service businesses. It helps a founder record receivables, remember payment commitments, see a deterministic Today queue, prepare a respectful follow-up, and keep payment history visible. It does not claim real adoption, money recovered, or production customer data.

## Current stage

Stage 2 adds email-and-password Supabase authentication, a protected application route, RLS-backed persistence, transactional database workflows, and a secure first-user empty state to the Stage 1.2 approved mobile interface. The visual system remains the approved Quiet Ledger design. Stage 3 work, public deployment, real payment collection, and entitlement purchase flows are deliberately out of scope.

## Architecture

The browser application uses React 19, TypeScript, Vite, Tailwind, Wouter, and `@supabase/supabase-js`. `client/src/config/brand.ts` is the central temporary identity configuration. `client/src/lib/supabase.ts` provides the browser-safe Supabase client, `client/src/hooks/useSupabaseAuth.ts` handles session lifecycle, and `client/src/data/supabase-*-repository.ts` contains the scoped client, receivable, promise, payment, activity, and dashboard adapters. The approved UI calls these repositories rather than querying the database directly.

All money values are stored as integer paise. The priority queue is deterministic and explainable. `client/src/data/demo.ts` remains a static fixture for tests and design reference only; it is neither imported nor inserted by the authenticated application. New accounts receive a private, empty ledger.

The reproducible Supabase schema is committed under `supabase/migrations/`. It defines `profiles`, `clients`, `receivables`, `promises`, `payments`, `activities`, `promise_events`, `entitlements`, `purchase_claims`, and `analytics_events`, as well as audited transactional workflows for creating a receivable, creating a promise, recording a payment, and recording a follow-up.

## Local setup

```bash
pnpm install
pnpm dev
```

The development server runs the Vite client through the project server. Configure these **browser-safe** values in a local, ignored `.env.local` file before starting the frontend:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-anon-key
```

Never add a Supabase service-role key, database password, management token, or `.env` file to the repository. Authentication, authorization, and tenant isolation are enforced by Supabase Auth and PostgreSQL RLS—not by browser-side filtering.

## Verification commands

```bash
pnpm test       # Vitest unit and source-contract suite
pnpm run check  # TypeScript typecheck
pnpm run lint   # TypeScript-based lint gate
pnpm run build  # Vite production build plus server bundle
pnpm audit --prod --audit-level=high
```

The Stage 2 suite covers financial formatting and state helpers, Supabase row normalization, public browser configuration, migration security contracts, transactional-RPC access guarantees, and demo-data isolation. The database attack and integrity matrices are run in rollback-only transactions against the connected project.

## Zero-cost and security boundary

The Stage 2 foundation uses Supabase Free and GitHub Free only. There is no paid SMTP service, payment gateway, messaging API, or runtime AI. Publishable Supabase configuration is supplied from ignored local environment values; no service-role credential is used in the frontend or committed source. The free plan's three active-receivable limit is enforced inside PostgreSQL, and clients cannot self-upgrade their entitlement.

## Roadmap

Stage 1 is the local product prototype and Stage 1.2 is its source-ownership freeze. Stage 2 is the secure Supabase foundation. A later, separately approved stage may address product onboarding, notification delivery, paid plans, external payment, operational analytics, deployment, native builds, WhatsApp API access, email delivery, or runtime AI.

## Rebranding note

DueWeave is temporary. Product name, short name, tagline, support display name, logo assets, and core UI identity are centralized where practical in `client/src/config/brand.ts`. The PWA manifest and static HTML metadata mirror those values for browser installation and search metadata; update them together when the final product name is chosen.
