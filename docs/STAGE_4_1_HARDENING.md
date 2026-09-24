# Stage 4.1 Independent Runtime Hardening

## Purpose

Stage 4.1 turns DueWeave into an independently buildable static Vite client. This is a repository-hardening change, not a deployment. The application continues to use only browser-safe Supabase configuration and database-enforced authorization.

## Exact package removals

The following packages were removed from the Stage 4 release-tag manifest because no retained production or test import requires them. This is the exact package-name inventory; package transitive dependencies disappeared through the regenerated lockfile as a consequence.

| Group | Exact package names removed |
| --- | --- |
| Server, database, storage, and request runtime | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@tanstack/react-query`, `@trpc/client`, `@trpc/react-query`, `@trpc/server`, `axios`, `cookie`, `dotenv`, `drizzle-orm`, `express`, `jose`, `mysql2`, `superjson` |
| Generic form, command, layout, and visual scaffold | `@hookform/resolvers`, `class-variance-authority`, `clsx`, `cmdk`, `embla-carousel-react`, `framer-motion`, `input-otp`, `next-themes`, `react-day-picker`, `react-hook-form`, `react-resizable-panels`, `tailwind-merge`, `tailwindcss-animate`, `tw-animate-css`, `vaul`, `zod` |
| Unused Radix primitives | `@radix-ui/react-accordion`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-aspect-ratio`, `@radix-ui/react-avatar`, `@radix-ui/react-checkbox`, `@radix-ui/react-collapsible`, `@radix-ui/react-context-menu`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-hover-card`, `@radix-ui/react-label`, `@radix-ui/react-menubar`, `@radix-ui/react-navigation-menu`, `@radix-ui/react-popover`, `@radix-ui/react-progress`, `@radix-ui/react-radio-group`, `@radix-ui/react-scroll-area`, `@radix-ui/react-select`, `@radix-ui/react-separator`, `@radix-ui/react-slider`, `@radix-ui/react-slot`, `@radix-ui/react-switch`, `@radix-ui/react-tabs`, `@radix-ui/react-toggle`, `@radix-ui/react-toggle-group`, `@radix-ui/react-tooltip` |
| Unused utilities and development tooling | `@builder.io/vite-plugin-jsx-loc`, `@tailwindcss/typography`, `@types/express`, `@types/google.maps`, `add`, `autoprefixer`, `date-fns`, `drizzle-kit`, `esbuild`, `nanoid`, `pnpm`, `postcss`, `tsx`, `vite-plugin-manus-runtime` |

`@eslint/js`, `eslint`, `eslint-plugin-react-hooks`, and `typescript-eslint` were intentionally added as development-only correctness tooling. `wouter` remains because the product imports it for routing.

## Exact tracked-scaffold removals

The following tracked paths were removed relative to `refs/tags/stage-4-founder-monetization`:

```text
client/public/__manus__/debug-collector.js
client/src/_core/hooks/useAuth.ts
client/src/components/DashboardLayout.tsx
client/src/components/DashboardLayoutSkeleton.tsx
client/src/components/ManusDialog.tsx
client/src/components/Map.tsx
client/src/components/ui/{accordion,alert-dialog,alert,aspect-ratio,avatar,badge,breadcrumb,button-group,button,calendar,card,carousel,checkbox,collapsible,command,context-menu,dialog,drawer,dropdown-menu,empty,field,form,hover-card,input-group,input-otp,input,item,kbd,label,menubar,navigation-menu,pagination,popover,progress,radio-group,resizable,scroll-area,select,separator,sheet,sidebar,skeleton,slider,spinner,switch,table,tabs,textarea,toggle-group,toggle,tooltip}.tsx
client/src/{const.ts,hooks/useComposition.ts,hooks/usePersistFn.ts,lib/trpc.ts,lib/utils.ts}
components.json
drizzle.config.ts
drizzle/{meta/_journal.json,migrations/.gitkeep,relations.ts,schema.ts}
patches/wouter@3.7.1.patch
server/{auth.logout.test.ts,db.ts,index.ts,routers.ts,stage2.security-contract.test.ts,storage.ts,supabase.public-config.test.ts}
server/_core/{context.ts,cookies.ts,dataApi.ts,env.ts,heartbeat.ts,imageGeneration.ts,index.ts,llm.ts,map.ts,notification.ts,oauth.ts,sdk.ts,storageProxy.ts,systemRouter.ts,trpc.ts,vite.ts,voiceTranscription.ts,types/cookie.d.ts,types/manusTypes.ts}
shared/{const.ts,types.ts,_core/errors.ts}
template.json
tsconfig.node.json
```

## Removed runtime and scaffold pieces

| Removed item | Reason | Replacement or retained boundary |
| --- | --- | --- |
| `server/` and `server/_core/` | The browser application does not use an Express, tRPC, OAuth, storage-proxy, or background runtime. | Static Vite serves the React client; Supabase Auth and RPCs remain the backend boundary. |
| `drizzle/`, `drizzle.config.ts`, and MySQL/Drizzle packages | The committed schema authority is Supabase PostgreSQL migrations under `supabase/migrations/`; no Drizzle or MySQL code was active. | Versioned Supabase SQL migrations and security-contract tests. |
| tRPC, React Query, SuperJSON, cookie/Jose, AWS S3 SDKs, and Manus server integrations | The active client did not import or need these server/runtime integration packages. | Direct, typed browser-safe Supabase repositories already used by the product. |
| `vite-plugin-manus-runtime`, debug collector files, and Manus runtime configuration | These were template/runtime artifacts and are not required by an independently hosted static build. | Standard Vite `react` and Tailwind plugins only. |
| Unused generic component scaffold, map/chat components, template showcase, and unused hooks | They were not imported by the application and enlarged maintenance surface. | The retained Quiet Ledger product components under `client/src/components/`. |
| Host allowlists and server build/start scripts | They belonged to the prior managed server template and did not represent a portable static deployment contract. | `pnpm dev` runs `vite --host`; `pnpm build` runs `vite build`. |

## Retained dependencies and responsibilities

The retained runtime dependencies are React, React DOM, Vite, Tailwind, Wouter, `@supabase/supabase-js`, `qrcode`, Sonner, and the small visual/icon utilities actively imported by the client. Vitest, Playwright, TypeScript, ESLint, and related type packages are development-only verification tooling.

## Independent verification

Run the following after a clean dependency install:

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm check
pnpm test
pnpm build
```

The development-server log must show a Vite startup only. Any fresh reference to `server/_core`, `@shared/const`, tRPC, or a Manus runtime module is a hardening regression. Historic managed-preview diagnostics do not constitute a static-runtime dependency; they must be cleared before final verification.

## Unchanged boundaries

This work does not deploy a website, configure payment instructions, create a trusted reviewer, add a service-role key, merge to `main`, or begin Stage 5.
