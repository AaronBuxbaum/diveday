# Architecture overview

## Shape

A single full-stack **Next.js 16** app (App Router, React 19, TypeScript strict). Server
components by default; client components only where interactivity demands it. No separate API
service until something other than the web app needs one ([ADR-0001](decisions/0001-nextjs-fullstack.md)).

## Stack

| Layer | Choice | Why (ADR) |
| --- | --- | --- |
| Framework | Next.js 16 (App Router) | [0001](decisions/0001-nextjs-fullstack.md) |
| Language | TypeScript, `strict` | [0001](decisions/0001-nextjs-fullstack.md) |
| Styling | Tailwind 4 + semantic CSS tokens | [0004](decisions/0004-design-tokens.md) |
| Database | Postgres via Drizzle ORM; PGlite in dev/test, Neon in production | [0005](decisions/0005-database.md), [20260718 Neon](decisions/20260718-vercel-neon-hosting.md), [20260718 Drizzle beta](decisions/20260718-drizzle-v1-beta.md) |
| Hosting | Vercel (Git integration, preview deploys) | [20260718 hosting](decisions/20260718-vercel-hosting.md) |
| Analytics | Vercel Analytics via `@vercel/analytics` | [20260718 analytics](decisions/20260718-vercel-analytics.md) |
| Auth | Auth.js v5 credentials, JWT sessions, proxy gating | [0006](decisions/0006-auth.md) |
| Transactional email | Resend REST API behind `src/lib/notifications/` | [20260718 email](decisions/20260718-resend-transactional-email.md) |
| Offline manifests | Encrypted IndexedDB snapshot + data-free service-worker shell | [20260718 offline manifests](decisions/20260718-offline-manifest-snapshots.md) |
| Payments | Stripe Connect (Standard) behind `src/lib/payments/`; each shop brings its own account | [20260719 Stripe Connect](decisions/20260719-stripe-connect-orders.md) |
| Marine outlook | Open-Meteo Marine API behind `src/lib/marine-forecast.ts` | [20260718 marine outlook](decisions/20260718-automated-marine-outlook.md) |
| Lint/format | Biome | [0002](decisions/0002-toolchain.md) |
| Unit tests | Vitest + Testing Library, MSW for real fetch boundaries | [0002](decisions/0002-toolchain.md), [20260719 MSW scope](decisions/20260719-msw-offline-sync-only.md) |
| E2E tests | Playwright | [0002](decisions/0002-toolchain.md), [20260719 MSW scope](decisions/20260719-msw-offline-sync-only.md) |
| Package manager | pnpm | [0002](decisions/0002-toolchain.md) |

⚠️ Next.js 16 differs from most training data — read the guides in `node_modules/next/dist/docs/`
before writing framework-touching code (see AGENTS.md).

## Layout

```
src/
  app/          # routes, layouts — App Router. Keep route files thin.
  lib/          # framework-free domain logic and helpers. Most unit tests live here.
  db/           # schema.ts (source of truth), client.ts (getDb seam), queries, seed
  components/   # (when it exists) shared UI components, token-styled
  test/         # test setup
drizzle/        # generated SQL migrations — committed, never hand-edited
e2e/            # Playwright specs
docs/           # the knowledge base (see docs/README.md)
.claude/        # skills, agents, settings for AI-driven development
scripts/        # dev utilities (screenshots, etc.)
```

Single app at repo root — no monorepo until a second deployable exists
([ADR-0003](decisions/0003-repo-structure.md)).

**Dependency direction:** `app/` may import `lib/` and `components/`; `lib/` imports neither.
Domain logic goes in `lib/` where Vitest can reach it without a browser.

## Deferred decisions

Write the ADR when the milestone forces the choice — not before. Leading candidates recorded so
future agents start from context, not from scratch:

| Decision | Needed by | Leading candidates |
| --- | --- | --- |
| E-signature approach | M3 | In-house typed consent now; vendor adapter later ([20260718](decisions/20260718-waiver-signature-retention.md)) |
| Payments | M7 | Stripe Connect (Standard), settled: [20260719](decisions/20260719-stripe-connect-orders.md) |

## Cross-cutting rules

- **Multi-tenant from M1**: every domain table carries the shop's id.
- **Time is zoned**: trips happen at physical places; store UTC + IANA timezone, format via
  `src/lib/format.ts` only.
- **Safety-critical surfaces** (manifests, medical flags) prefer boring, explicit code and
  exhaustive tests over cleverness.
