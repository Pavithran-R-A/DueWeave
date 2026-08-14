# DueWeave

DueWeave is a mobile-first receivables and promise-to-pay ledger for Indian freelancers and small service businesses. It is a **provisional, pre-deployment product**: the repository contains an independently buildable static web client and versioned Supabase migrations, but Stage 4.1 does not deploy the application, merge to `main`, configure a real payment destination, or begin Stage 5.

## Architecture

The application is a browser-only React/Vite single-page application. It uses the browser-safe Supabase URL and anonymous key for authenticated user operations; the security boundary is Supabase Auth plus database-enforced row-level security, constraints, and protected RPCs. There is no Node server, tRPC service, Manus runtime, server-side storage proxy, service-role key, payment gateway, or runtime AI component in this deliverable.

| Layer | Responsibility | Security boundary |
| --- | --- | --- |
| Static Vite client | Ledger UI, local presentation state, browser-safe Supabase calls, and optional QR rendering. | No privileged database or payment credential is bundled. |
| Supabase Auth | Email/password sessions and user identity. | Authenticated UUID is supplied to database policies. |
| Supabase PostgreSQL | Business records, ownership RLS, money/lifecycle constraints, and protected workflow RPCs. | `owner_id = auth.uid()` and security-definer functions perform authorization. |
| Trusted operator process | Manual bank-history review for Founder claims. | A server-controlled UUID allowlist in `founder_admins`; no browser-writable role. |

## Local development

Use Node 22 and pnpm 10. The browser client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from a local ignored environment only. These are publishable browser configuration values, not a service role. Do not commit `.env` files, service-role keys, database passwords, UPI credentials, or manual-test credentials.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The canonical independent checks are:

```bash
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm audit --prod
```

## Founder workflow

Founder Lifetime is a manual-verification flow, not a payment processor. The configured offer currently remains an enabled **PLACEHOLDER** with no UPI destination. A customer can create a protected claim only when payment instructions are configured. A submitted reference is checked manually against business bank history by an allowlisted reviewer, who can approve, reject, revoke, or—after an explicit recheck—reconsider a rejected claim. The database prevents self-activation, duplicate UTR reuse, unapproved changes, and non-atomic seat-cap bypasses. Claim and audit history are preserved.

The Free plan's active-receivable limit remains database-enforced. The application translates an authoritative limit rejection into a direct `/founder` conversion path; it does not pretend that a client-side state change grants entitlement.

## Operator and release runbooks

Read [trusted-operator bootstrap guidance](docs/OPERATOR_BOOTSTRAP.md) before allowlisting any reviewer. Read [repository release-protection guidance](docs/RELEASE_PROTECTION.md) before enabling branch rules. Those documents are instructions only and do not create users, activate payments, or alter GitHub settings.

## Zero-cost intent and current blockers

The design targets Supabase Free, GitHub Free, static hosting, and no paid payment gateway, SMTP service, or runtime AI. Before any public launch, the owner must separately configure and verify a real business payment destination, publish approved privacy/terms/refund/support details, establish a manual-review operating procedure, set repository protections, and independently verify the deployed environment. No such deployment or configuration occurred in Stage 4.1.

## Explicit boundaries

This branch is `stage-4-1-release-hardening`. It is not merged to `main`, is not deployed, and does not contain a real UPI destination. Earlier release tags remain unchanged. Stage 5 is expressly out of scope until requested separately.
