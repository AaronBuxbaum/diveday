---
paths:
  - "src/app/**"
  - "src/components/**"
---

# Rules for `src/app/` and `src/components/`

Each rule names what enforces it; the reasoning, the ADRs and the longer form of every row are in
[docs/agents/repo-checks.md](../../docs/agents/repo-checks.md#the-surfaces-rules).

## Where things are

- **Diver shop pages**: `src/app/s/[shopSlug]/**`, no auth anywhere; paths from
  `src/lib/public-routes.ts`. `/shop/**` is staff.
- **Where a diver can go**: `src/components/PublicShopNav.tsx`, assembled in
  `src/app/s/[shopSlug]/layout.tsx`; never a per-page cross-link.
- **Where staff can go**: a destination goes in `src/lib/staff-destinations.ts`, never in a
  consumer (`src/components/ShopSectionNav.tsx`, `src/components/search/CommandPalette.tsx`).
- **Bearer-token pages** (`src/app/waivers/[token]` and siblings): the URL is the capability; read
  [the capability runbook](../../docs/engineering/capability-telemetry-runbook.md) first; no
  structured data or telemetry carrying the token.
- **A staff page opens with** `requireShopSurface` (`src/lib/session.ts`); every refusal throws, a
  cross-tenant miss is `notFound()` (`src/lib/session.test.ts`).
- **A retired staff URL is deleted, not redirected** (H-20260815-no-legacy); the full rule is in
  [repo checks](../../docs/agents/repo-checks.md#there-is-no-legacy-delete-it).
- **Server actions**: inline `"use server"` for one page, `src/app/actions/` when shared, a sibling
  `actions.ts` for a large page; seating a diver through `src/app/actions/seat-diver.ts`.
- **Schedule**: the builder (`schedule/board/_components/ScheduleBuilder.tsx`) is the one place a
  trip is created; another reading of the schedule is a view in `schedule/_components/ScheduleViews.tsx`.
- **A departure is four tabs** drawn by `_components/TripTabs.tsx`; add to a tab, never a fifth surface.
- **The shop home** is `_components/today/DaySpine.tsx`: departures, then one "Needs you" list.
- **Back-office queues** sit with their object and render nothing when empty, never on Reports.
- **A day not on the board**: `src/components/DateRequestForm.tsx` + `src/app/actions/inquiry.ts`,
  never the wait list.
- **A dive-site briefing** is written in `SiteFields.tsx` and rendered by
  `src/components/SiteBriefing.tsx` on site and trip pages, every sentence off the site row.
- **Tokens and wrappers**: `src/app/globals.css`, `src/components/ui/`; readiness words in
  `src/i18n/readiness-labels.ts`; heading levels in `src/components/ui/typography.ts`.
- **Paging**: `src/components/Pager.tsx` + `offsetPage`; a count shares the row query's exact scope.
- **Link previews**: `allowSvgRasterization()` before every `ImageResponse`; no root metadata
  module imports `next/og` (`src/app/_og/card.test.tsx`); every `openGraph` block spreads
  `openGraphSite` (`pnpm check:repo`).
- **A surface that does not exist yet**: [docs/design/design-artifacts.md](../../docs/design/design-artifacts.md) first.

## Rules

- **Semantic tokens only**, no raw hex or palette classes: `pnpm check:tokens` (ADR-0004).
- **Fields, buttons, controls and panels go through the wrappers**; never a `text-<colour>` into
  `buttonClass()` (`button.test.ts`); sections space with `space-y-10`.
- **A form's outcome sits beside the form** (`Field`'s `error`, `FormStatus`), routed by
  `noticeForForm`, brought on screen by `StatusInView`; scroll-preservation guard.
- **A new page ships with `loading.tsx` and `export const instant = true`; no `await` above
  `{children}` in a layout**: loading-skeleton guard and `next build`.
- **No literal locale; every rendered date passes `shop.timezone`**: `pnpm check:locale`,
  Biome rule `timezone`.
- **Copy comes from a message bundle, in every locale at once**: `pnpm check:copy`,
  `pnpm check:locale`; a diver Client Component needs `DiverIntlProvider` above it
  (`scripts/check-intl-providers.mjs`). Waiver and medical wording stays English (H-20260730-jurisdiction-waiver-text-medical, H-20260724-current-typed-name-explicit).
- **Every sentence earns its place, or it is deleted**: the **copy-restraint** skill; an
  accessibility trade goes in [docs/design/accessibility-tradeoffs.md](../../docs/design/accessibility-tradeoffs.md).
- **Delete says Delete**: the `softDelete` lint rule (ADR 20260820-every-delete-is-soft).
- **A trouble state is photographed through `/api/test/seed-trouble-states`**, never seeded into
  the demo shop.
- **A new feature a shop could run without gets a Features switch (default on), or a `core`
  entry saying why not**, in `src/lib/feature-coverage.ts`; off, its page redirects with no
  error and every door to it is gone: `feature-coverage.test.ts`, typecheck
  ([working-rules.md](../../docs/agents/working-rules.md#hard-rules)).
- **Look at what you changed**: `node scripts/screenshot.mjs`, the **design-review** skill, an
  `e2e/` spec and a visual capture (`pnpm check:route-coverage`); safety surfaces get
  `dive-domain-expert`.
