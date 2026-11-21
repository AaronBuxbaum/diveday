---
paths:
  - "src/app/**"
  - "src/components/**"
---

# Rules for `src/app/` and `src/components/`

Each rule names what enforces it; the reasoning, the ADRs and the longer form of every row are in
[docs/agents/repo-checks.md](../../docs/agents/repo-checks.md#the-surfaces-rules).

## Where things are

AGENTS.md and [the route map](../../docs/agents/route-map.md) say where (diver and staff pages, the
schedule builder, date requests, site briefings, bearer-token routes). What they do not say:

- **Where a diver can go**: `src/components/PublicShopNav.tsx`, assembled in
  `src/app/s/[shopSlug]/layout.tsx`; never a per-page cross-link.
- **Where staff can go**: a destination goes in `src/lib/staff-destinations.ts`, never in a
  consumer (`src/components/ShopSectionNav.tsx`, `src/components/search/CommandPalette.tsx`).
- **Bearer-token pages**: read [the capability runbook](../../docs/engineering/capability-telemetry-runbook.md)
  first; no structured data or telemetry carrying the token.
- **A staff page opens with** `requireShopSurface` (`src/features/accounts/session.ts`); every refusal throws, a
  cross-tenant miss is `notFound()` (`src/features/accounts/session.test.ts`).
- **A retired staff URL is deleted, not redirected** (H-20260815-no-legacy); the full rule is in
  [repo checks](../../docs/agents/repo-checks.md#there-is-no-legacy-delete-it).
- **Server actions**: a sibling `*-actions.ts` with file-level `"use server"`, `src/app/actions/`
  when shared; inline is the exception and names why (ADR 20260803-invoicing-role-gate). A staff
  mutation is a `defineAction` declaration (`src/features/platform/server-action.ts`) where its area moved;
  an Undo is an undo offer (`src/features/platform/undo.ts`) with a registry inverse. Seating a diver: `src/app/actions/seat-diver.ts`.
- **Adding one usually uses a panel on its object's index**, opened by `?add=`
  (`src/components/AddPanel.tsx`, `src/lib/add-panel.ts`). Long forms that warrant draft protection
  can use a create page; the dive-site editor is one.
- **The builder is the one place a trip is created**; another reading of the schedule is a view in
  `schedule/_components/ScheduleViews.tsx`.
- **A departure is five phases plus Edit trip** (ADR 20261117-trip-page-clock): Filling, Getting
  ready, Check-in, On the water and Wrapped up (`?phase=`, `src/lib/trip-clock.ts`), each a panel in
  `trips/[id]/_components/phases/`, and Edit trip (`?view=edit`). Roll call records one named person
  per action (ADR 20261114-trip-folio-and-individual-deck); add ordinary work to its phase.
- **The shop home** is `_components/today/DaySpine.tsx`: departures, then one "Needs you" list.
- **Back-office queues** sit with their object and render nothing when empty, never on Reports.
- **A date request is never the wait list.**
- **A site briefing** is written in `SiteFields.tsx`, every sentence off the site row.
- **Tokens and wrappers**: `src/app/globals.css`, `src/components/ui/`; readiness words in
  `src/i18n/readiness-labels.ts`; heading levels in `src/components/ui/typography.ts`.
- **Paging**: `src/components/Pager.tsx` + `offsetPage`; a count shares the row query's exact scope.
- **Link previews**: `allowSvgRasterization()` before every `ImageResponse`; no root metadata
  module imports `next/og` (`src/app/_og/card.test.tsx`); every `openGraph` block spreads
  `openGraphSite` (`pnpm check:repo`).
- **A surface that does not exist yet**: [docs/design/design-artifacts.md](../../docs/design/design-artifacts.md) first.

## Rules

- **A surface draws its empty, loading, validation, error and success states**, not only the
  happy path.
- **Semantic tokens only**, no raw hex or palette classes: `pnpm check:tokens` (ADR-0004).
- **Fields, buttons, controls and panels go through the wrappers**; never a `text-<colour>` into
  `buttonClass()` (`button.test.ts`); sections space with `space-y-10`.
- **An error is a toast, never a component left on the page** (Aaron, 2026-11-13): `ErrorToast`
  (`src/components/Toast.tsx`), reached through `FormStatus`, a `danger` `ShopNotice` or directly; a
  `role="alert"` element in `src/app`/`src/components` fails `pnpm check:error-toasts`. Only a
  field's own validation hint stays beside its control (`Field`'s `error`).
- **A text field says which it is**: native `required` (draws `*`) or `hint="(optional)"`, never
  neither (Aaron, 2026-11-17): `form-source.test.ts`; [forms-and-controls.md](../../docs/design/forms-and-controls.md#required-fields).
- **A form's outcome** (`FormStatus`) is routed by
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
- **A trouble state is photographed through a fact on `/api/test/shop`**, never seeded into
  the demo shop.
- **A new feature a shop could run without gets a Features switch (default on), or a `core`
  entry saying why not**, in `src/lib/feature-coverage.ts`; off, its page redirects with no
  error and every door to it is gone: `feature-coverage.test.ts`, typecheck
  ([working-rules.md](../../docs/agents/working-rules.md#hard-rules)).
- **Look at what you changed**: `node scripts/screenshot.mjs`, the **design-review** skill, an
  `e2e/` spec and a visual capture (`pnpm check:route-coverage`); safety surfaces get
  `dive-domain-expert`.
