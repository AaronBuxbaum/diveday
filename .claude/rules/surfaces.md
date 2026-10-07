---
paths:
  - "src/app/**"
  - "src/components/**"
---

# Rules for `src/app/` and `src/components/`

Everything a person looks at. Each rule names what enforces it; the reasoning, incidents and the
longer form of every row are in [docs/agents/repo-checks.md](../../docs/agents/repo-checks.md#the-surfaces-rules).

## Where things are

- **Diver shop pages**: `src/app/s/[shopSlug]/**`, no auth anywhere; paths from
  `src/lib/public-routes.ts` (ADR 20260803-public-shop-namespace). `/shop/**` is staff.
- **Where a diver can go**: `src/components/PublicShopNav.tsx`, assembled in
  `src/app/s/[shopSlug]/layout.tsx`; never a per-page cross-link; the header drops in `?embed=1`.
- **Where staff can go**: add a destination to `src/lib/staff-destinations.ts` with its section,
  never to a consumer (`src/components/ShopSectionNav.tsx`, `src/components/search/CommandPalette.tsx`).
  Anything fixed to the foot stands off `--tabbar-h` (ADR 20261001-logbook).
- **Bearer-token pages** (`src/app/waivers/[token]` and siblings): the URL is the capability; read
  [the capability runbook](../../docs/engineering/capability-telemetry-runbook.md) first; no
  structured data or telemetry that could carry the token.
- **A staff page opens with** `requireShopSurface` (`src/lib/session.ts`); every refusal throws, a
  cross-tenant miss is `notFound()` (`src/lib/session.test.ts`).
- **Server actions**: inline `"use server"` for one page, `src/app/actions/` when shared, a sibling
  `actions.ts` for a large page. Seating a diver goes through `src/app/actions/seat-diver.ts`.
- **Schedule**: the builder (`schedule/board/_components/ScheduleBuilder.tsx`) is the one place a
  trip is created (ADR 20260806-one-trip-create-form). Week and Crew are two views under
  `schedule/_components/ScheduleViews.tsx`; a third reading is a third view there.
- **A departure is four tabs** (Divers, Boat, Gear, Details) drawn by `_components/TripTabs.tsx`;
  add to a tab, never a fifth surface. A cancelled departure keeps Boat and packs nothing.
- **The shop home** is `_components/today/DaySpine.tsx`: the day's departures, then one "Needs you"
  list. There is no act of closing the day.
- **Back-office queues** sit with their object and render nothing when empty, never on Reports;
  the year on Reports shows no money (ADR 20260908-one-hand).
- **A day not on the board**: `src/components/DateRequestForm.tsx` + `src/app/actions/inquiry.ts`,
  never the wait list.
- **A dive-site briefing** is written in `SiteFields.tsx` and read in `TripDayPlan.tsx`, every
  sentence off the site row (ADR 20260813-dive-site-briefings-are-the-shops-own-words).
- **Tokens and wrappers**: `src/app/globals.css`, `src/components/ui/`; readiness words from
  `src/i18n/readiness-labels.ts`; heading levels from `src/components/ui/typography.ts`.
- **Paging**: `src/components/Pager.tsx` + `offsetPage`; a count shares the row query's exact scope
  (ADR 20260803-one-pagination-model).
- **Link previews**: `allowSvgRasterization()` before every `ImageResponse` (ADR
  20260804-og-svg-rasterizer); no root metadata module imports `next/og`
  (`src/app/_og/card.test.tsx`); every `openGraph` block spreads `openGraphSite`
  (`pnpm check:repo`, Open-Graph-site).
- **A surface that does not exist yet**: [docs/design/design-artifacts.md](../../docs/design/design-artifacts.md) first.

## Rules

- **Semantic tokens only**, no raw hex or palette classes: `pnpm check:tokens` (ADR-0004).
- **Fields, buttons, controls and panels go through the wrappers**; never a `text-<colour>` into
  `buttonClass()` (`button.test.ts`); sections space with `space-y-10`.
- **A form's outcome sits beside the form** (`Field`'s `error`, `FormStatus`), routed by
  `noticeForForm`, brought on screen by `StatusInView`; scroll-preservation guard.
- **A new page ships with `loading.tsx` and `export const instant = true`; no `await` above
  `{children}` in a layout**: loading-skeleton guard and `next build` (ADR 20260804-instant-navigation).
- **No literal locale; every rendered date passes `shop.timezone`**: `pnpm check:locale`,
  `pnpm check:timezone`.
- **Copy comes from a message bundle, in every locale at once**: `pnpm check:copy`,
  `pnpm check:locale`; a diver Client Component needs `DiverIntlProvider` above it
  (`src/i18n/provider-coverage.test.ts`). Waiver and medical wording stays English (H-01, H-03).
- **Every sentence earns its place, or it is deleted**: the **copy-restraint** skill; an
  accessibility trade goes in [docs/design/accessibility-tradeoffs.md](../../docs/design/accessibility-tradeoffs.md).
- **Delete says Delete**: soft-delete-vocabulary guard (ADR 20260820-every-delete-is-soft).
- **A trouble state is photographed through `/api/test/seed-trouble-states`**, never seeded into
  the demo shop.
- **Look at what you changed**: `node scripts/screenshot.mjs`, the **design-review** skill, an
  `e2e/` spec and a visual capture (`pnpm check:route-coverage`); safety surfaces get a
  `dive-domain-expert` review.
