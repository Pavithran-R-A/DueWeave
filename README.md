# DueWeave

> Repository working name: `PROJECT AR-1`

DueWeave is a mobile-first receivables tracker for independent service businesses. The idea is simple: keep promised payment dates, partial payments and follow-up context in one place so a founder can see who needs attention today without managing the process in a spreadsheet or chat history.

The current repository is a frontend prototype. It uses fictional demo data and does not process real payments or customer messages.

## Current prototype

The app includes:

- a Today-first queue of receivables that need attention
- outstanding-cash summary
- client and receivable detail views
- promise history
- partial-payment tracking
- follow-up message templates
- deterministic queue ordering
- a preview of the planned Founder upgrade flow

All money values are represented as integer paise in the application logic.

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Vitest

The frontend keeps financial/date rules in small pure helpers rather than embedding them in UI components. Demo records are isolated behind a repository seam so a real persistence adapter can replace them later.

## Run locally

```bash
pnpm install
pnpm dev
```

## Verification

```bash
pnpm test
pnpm run check
pnpm run lint
pnpm run build
pnpm audit --prod
```

The unit tests cover the core deterministic pieces such as INR formatting, outstanding balances, paid-state detection, priority ordering, demo dates and follow-up interpolation.

## Code notes

- `client/src/config/brand.ts` keeps the temporary product identity in one place.
- `client/src/data/demo.ts` contains fictional example data.
- `client/src/lib/finance.ts` contains the reusable money/date/priority logic.
- `client/src/data/repository.ts` is the current in-memory data boundary.

## Status

This is intentionally not presented as a production billing system yet. Authentication, persistent storage, row-level security, real messaging/payment integrations and a production backend belong to later work and should be introduced only when the product model is ready for them.
