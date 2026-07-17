# Scuba — agent guide

Delight-first dive shop operations: **bookings, waivers, cert checks, gear, boat manifests**.
Competitors have the features; we win on experience. You (an AI agent) are the only developer —
the docs are the project's memory, so read them before coding and update them as you change
things.

## Read first

1. This file.
2. [docs/README.md](docs/README.md) — the docs map; open what's relevant to your task
   (glossary for domain work, design principles for UI, overview + ADRs for structure).
3. The Next.js warning at the bottom of this file — it applies to *all* framework-touching work.

## Commands

| Command | What |
| --- | --- |
| `pnpm dev` | dev server at localhost:3000 |
| `pnpm check` | lint + typecheck + unit tests — **the pre-commit bar** |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix |
| `pnpm typecheck` | tsc |
| `pnpm test` / `pnpm test:watch` | Vitest |
| `pnpm e2e` | Playwright (auto-detects sandbox Chromium; no install needed) |
| `pnpm build` | production build |
| `node scripts/screenshot.mjs [routes]` | light/dark × desktop/phone PNGs → `.screenshots/` |

## Route map (don't re-derive this)

| You need | Go to |
| --- | --- |
| Public pages (landing, schedule, sign-in) | `src/app/` — `/trips` is the public schedule |
| Staff surfaces (all `/shop/**`, auth-gated) | `src/app/shop/` |
| DB schema (source of truth — never read `drizzle/`) | `src/db/schema.ts` |
| DB client / test db factory | `src/db/client.ts` (`getDb()`, `createTestDb()`) |
| Queries and seed data | `src/db/queries.ts`, `src/db/seed.ts` |
| The booking transaction (capacity enforcement) | `src/db/bookings.ts` — read its tests first |
| Domain logic (framework-free) | `src/lib/` — capacity in `trips.ts`, dates in `format.ts` |
| Auth: edge config / providers / gates | `src/lib/auth.config.ts` / `auth.ts` / `authz.ts` + `session.ts`; edge layer in `src/proxy.ts` |
| Dev/e2e staff logins | `src/db/dev-credentials.ts` |
| Design tokens | `src/app/globals.css` (semantic only, ADR-0004) |
| "What should this code do?" | Read `foo.test.ts` before `foo.ts` — tests are the contract |

## Skills

Prefer these over ad-hoc process — index with triggers in
[.claude/skills/README.md](.claude/skills/README.md): **new-feature** (the full build loop),
**verify** (before every commit), **design-review** (after UI work), **schema-change** (any
`src/db/schema.ts` edit), **debug** (before attempting fixes), **adr** (hard-to-reverse
decisions). Reviewer agents: **design-critic**, **dive-domain-expert** (required for
safety-critical work).

## Hard rules

- **Verify before commit** — `pnpm check` green minimum; e2e when flows changed; *look at* UI
  you changed (screenshots, light + dark). Never report unverified work as done.
- **Semantic tokens only** in components — no raw hex, no palette-scale classes (ADR-0004).
- **New runtime dependency → ADR.** New domain concept → glossary. Invalidated doc → fix in
  the same PR.
- **Safety-critical surfaces** (manifests, roll call, cert gating, medical flags) get boring
  code, failure-path tests, and a `dive-domain-expert` review.
- **Layout**: domain logic in `src/lib/` (framework-free, unit-tested); routes in `src/app/`
  stay thin; e2e specs in `e2e/`; `src/lib/` never imports from `src/app/`.
- **Secrets never enter the repo** — `.env*` is gitignored.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
