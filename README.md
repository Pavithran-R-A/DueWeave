# PROJECT AR-1 / DueWeave

DueWeave is the temporary working name for **PROJECT AR-1**, a mobile-first promise ledger for independent service businesses. The Stage 1 prototype helps a founder record receivables, remember payment commitments, see a deterministic Today queue, prepare a respectful follow-up, and keep payment history visible. It is a local frontend prototype only: it does not claim real adoption, real money recovered, or production customer data.

## Current stage

Stage 1.1 is the approved mobile product and conversion pass. The interface preserves a Today-first briefing, a compact outstanding-cash summary, an actionable first queue card, promise history, partial-payment clarity, local follow-up templates, client and receivable views, and a Founder upgrade preview that intentionally does not take payment. The current Stage 1.2 checkpoint freezes this approved UI and takes source ownership before any backend work begins.

## Architecture

The app is a React 19, TypeScript, Vite, and Tailwind frontend. `client/src/config/brand.ts` is the central temporary identity configuration. `client/src/data/demo.ts` contains the fictional Indian service-business dataset, while `client/src/lib/finance.ts` contains pure, testable INR, date, promise-state, reliability, and priority helpers. `client/src/data/repository.ts` provides the smallest local repository seam used by the UI; it is intentionally in-memory and has no Supabase implementation yet.

All money values are stored as integer paise. The priority queue is deterministic and explainable. Demo customer and financial records are isolated from UI components so a later repository adapter can replace them without scattering database calls through the view layer.

## Local setup

```bash
pnpm install
pnpm dev
```

The development server runs the Vite client. The project uses the existing lightweight static frontend scaffold and has no production backend, authentication, database, payment processor, messaging API, or runtime AI.

## Verification commands

```bash
pnpm test       # Vitest unit suite
pnpm run check  # TypeScript typecheck
pnpm run lint   # TypeScript-based lint gate
pnpm run build  # Vite production build plus server bundle
pnpm audit --prod
```

The current unit suite covers INR formatting, outstanding balance behavior, paid-state detection, deterministic queue ordering, demo dates, reliability thresholds, and message interpolation. The Stage 1.2 report records the exact runner counts and the package audit result.

## Zero-cost and security boundary

The prototype uses no paid dependencies and adds no hosted vendor runtime dependency. There are no production secrets, Supabase keys, UPI identifiers, service-role credentials, or personal payment credentials in the source. Environment files are ignored. The Founder payment flow is a non-transactional preview only; real payment and access activation remain explicitly out of scope.

## Roadmap

Stage 1 is the local product prototype. Stage 1.2 freezes and exports this source. Stage 2, only after explicit approval, may introduce authentication, a production data model, row-level security, repository-backed persistence, and carefully scoped integrations. Supabase, real user data, real payments, Cloudflare, native builds, WhatsApp API access, email delivery, and runtime AI are not created or connected in this checkpoint.

## Rebranding note

DueWeave is temporary. Product name, short name, tagline, support display name, logo assets, and core UI identity are centralized where practical in `client/src/config/brand.ts`. The PWA manifest and static HTML metadata mirror those values for browser installation and search metadata; update them together when the final product name is chosen.
