---
paths:
  - "src/app/**"
  - "src/components/**"
---

# Rules for `src/app/` and `src/components/`

Everything a person looks at. Loaded when a file under these paths is read; the universal rules
stay in `AGENTS.md`.

## Where things are

- **Public pages** (landing, sign-in): `src/app/`. **Diver-facing shop pages**:
  `src/app/s/[shopSlug]/**` — its own namespace, no auth anywhere in it; path strings come from
  `src/lib/public-routes.ts`, which also holds the 308s from the old `/shop/**` URLs (ADR
  20260803-public-shop-namespace). `/shop/**` is staff, without exception.
- **Where a diver can go**: the header nav in `src/components/PublicShopNav.tsx`, assembled once in
  `src/app/s/[shopSlug]/layout.tsx` and rendered by `src/components/PublicShopChrome.tsx`. Add a
  public destination there, never as a per-page cross-link; the whole header is dropped in
  `?embed=1`.
- **Where staff can go** (nav tabs, the "More" menu/sheet, ⌘K "Go to"): derive from
  `src/lib/staff-destinations.ts`. `src/components/ShopNavLinks.tsx`,
  `src/components/StaffTabBar.tsx` and `src/components/search/CommandPalette.tsx` all read it;
  `src/components/ShopNav.tsx` resolves the one label record they share, and
  `currentStaffNavDestinationId` is the one answer to "which row is current". Add a destination to
  the registry, never to a consumer. `src/components/ShopIdentityMenu.tsx` holds only the reader's
  own session (language, sign out) — never a place in the shop.
- **Bearer-token pages** (`src/app/waivers/[token]`, `ready/[token]`, `recap/[token]`,
  `verify/[token]`, `reset-password/[token]`, `calendar/[token]`): the URL *is* the capability;
  read [docs/engineering/capability-telemetry-runbook.md](../../docs/engineering/capability-telemetry-runbook.md)
  before touching. Never structured data or telemetry that could carry the token.
- **The four lines every staff page opens with**: one helper, `requireShopSurface` in
  `src/lib/session.ts`: `requireStaffSession()` → the shop row read by `session.user.shopId` (never
  the URL slug) → `notFound()` when it is missing **or** disagrees with the slug → an optional live
  `src/db/authz.ts` gate → a `?notice=` refusal redirect. Every refusal *throws*; there is no path
  that returns after deciding against the caller, and `src/lib/session.test.ts` pins that. Never
  `return null`, `redirect("/")`, or a bounce to the shop home for a cross-tenant miss — all of those
  are now `notFound()`.
- **Server actions**: inline `"use server"` closures for single-page mutations; `src/app/actions/`
  only for actions shared across pages; a large page colocates its actions/zod schemas in a sibling
  `actions.ts`. **Seating a diver** from any surface goes through `src/app/actions/seat-diver.ts`
  and the per-surface table in `seat-diver-surfaces.ts`; the global door is
  `src/app/shop/[shopSlug]/bookings/new` then `bookings/new/[tripId]` — the trip is a path segment,
  not a `?tripId=`, so a refusal can land back on it.
- **The schedule builder**: `src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx`
  + `schedule/board/actions.ts`; mutations in `src/db/trips-schedule.ts`. The add panel is the
  **one place a trip is created**; `/shop/[shopSlug]/trips/new` is a 308 to
  `schedule/board?add=full` (ADR 20260806-one-trip-create-form).
- **The shop home** is one chronological spine (`_components/today/DaySpine.tsx`,
  `DayStation.tsx`); the close-out is its evening state (`ClosingBlock.tsx`) and `/close-out` is a
  308 to it. `?view=` and `/blockers` 308 home (ADR 20260827-clearwater-surface-language). A
  departure's **log** is generated from there (`trips/[id]/log`, owner-only).
- **The back-office queues** are **not on Reports** — each sits with the object it is about and
  renders *nothing* when empty: stuck payment operations on the Orders index behind
  `canPersonManagePaymentSettings`; stuck media deletions and owed processor erasures lead Settings'
  "Data & integrations" group in `settings/SettingsPage.tsx`. `/shop/[shopSlug]/reports` is the
  shop's own reading of itself and nothing else: the month by default, the year at `?range=year`,
  one segmented control between them, and **no money at all on the year** (ADR 20260908-one-hand,
  decision 6, lever T). The year prints as a 3:2 card at `reports/card`, and with the shop's yes
  (`shops.show_year_on_diveday`, one row on Settings' Lobby display page) the same card is public
  at `/s/<slug>/year-card` and stands under DiveDay's own homepage hero.
- **A diver asking for a day not on the board**: one composer, `src/components/DateRequestForm.tsx`,
  behind one action `src/app/actions/inquiry.ts`; staff read them at `shop/[shopSlug]/requests`.
  Never the wait list or the last-minute deal list — those answer "tell me when a seat frees".
- **A dive site's briefing**: written on `dive-sites/_components/SiteFields.tsx`; read on the
  departure page as four beats in `_components/TripDayPlan.tsx` — `TripLookFor`, `TripRoutes`,
  `TripMoments`, `TripSiteNotes`. Every sentence comes off the site row, uncaptioned; the fit tone
  is one word and there is no canned filler (ADR 20260813-dive-site-briefings-are-the-shops-own-words).
  The field guide is the one exception — a *selection* of catalog species whose words are DiveDay's
  (`src/i18n/marine-life-labels.ts`).
- **Design tokens**: `src/app/globals.css` (semantic only, ADR-0004). **Wrappers**:
  `src/components/ui/` — `form.tsx` (`Field`, `FieldGrid`, `controlClass`, `FormStatus`,
  `FieldErrorFocus`), `button.ts` (`buttonClass`), `card.tsx` (`SectionCard`, `sectionCardClass`),
  `tone.ts` (`toneMark`). Readiness words: `src/i18n/readiness-labels.ts` — never spell a status
  inline. Heading levels come from `src/components/ui/typography.ts` (`pnpm check:type-ramp`).
- **Paging a staff list**: `src/components/Pager.tsx` + `offsetPage` in `src/db/paging.ts`. Every
  paged staff list wears it (ADR 20260803-one-pagination-model); keyset cursors (`src/db/cursor.ts`)
  are the one earned exception. A list's **count must share the row query's exact scope** (joins,
  `where`, `having`, `now`), or the pager promises pages that render nothing.
- **Link previews and icons** (`ImageResponse`): every surface that rasterizes at request time — the
  four `opengraph-image.tsx` cards, `pwa-icon-maskable/route.tsx`, `/s/[shopSlug]/year-card` and
  `/shop/[shopSlug]/reports/card` — calls `allowSvgRasterization()` (`src/lib/og-rasterizer.ts`)
  first, and so does any new one: `next/image` disables libvips' SVG loader process-wide on first
  use and satori's output is SVG, so without it the card severs the socket mid-stream (ADR
  20260804-og-svg-rasterizer). **A metadata module that imports `next/og` reaches every page
  entry**: Next attaches one to every one of them, which is how the favicon put 3.07 MiB of renderer
  into every closure in the app. The favicon and touch icon are committed PNGs now, re-rendered by
  `pnpm brand:icons` (issue #1361); the root card still does it (issue #1709). **Every page that
  exports an `openGraph` block spreads `openGraphSite`** (`src/lib/site-metadata.ts`): Next merges
  `metadata` shallowly, so a page-level block *replaces* the root layout's. `sharedLinkCard`
  (`src/lib/marketing.ts`) is this plus the card image. Structured data (`JsonLd`) never renders in
  `?embed=1` mode or on a bearer-token page.
- **Design for a surface that does not exist yet**: read
  [docs/design/design-artifacts.md](../../docs/design/design-artifacts.md) first — the canvas
  argues in pictures, the ADR decides, code obeys the ADR. Reach for a canvas only when a surface is
  significant enough for an ADR; for a component, a form or a copy change, the screenshot script and
  the **design-review** skill answer faster against the real app.

## Semantic tokens only

No raw hex, no palette-scale classes in components (ADR-0004; `pnpm check:tokens`). Next
metadata-file conventions (OG images, icons, manifest) are exempt by design — tokens cannot reach a
Satori bitmap.

## Forms, buttons and panels go through the wrappers

Stacked fields via `<Field>`/`<FieldGrid>`, button-shaped things via `buttonClass()`, controls via
`controlClass`, the bordered panel a page is made of via `<SectionCard>` (and its `loading.tsx`
twin via `sectionCardClass()`). Hand-rolled class strings are how fields fall out of alignment,
button labels drift off-center, and sibling routes one tap apart end up at two different corner
radii. Never pass a `text-<colour>` through `className` to `buttonClass()` — Tailwind emits colour
utilities **alphabetically by token name**, so the override silently loses to the variant's own
colour; that read as an instruction and did nothing at 31 call sites until 2026-08-15, and
`button.test.ts` now fails on it. If you find yourself cancelling a variant's own styles, the
variant is wrong. `SectionCard` has **deliberately no `radius` prop** — one that let each call site
keep its current corner would preserve the drift behind an abstraction. Pages space their sections
with `space-y-10` rather than per-section `mt-*`. See
[docs/design/forms-and-controls.md](../../docs/design/forms-and-controls.md).

## Where a form says what happened

**Beside the form, never in a banner at the top of the page.** Field-level refusals go on the field
(`Field`'s `error` prop, which wires `aria-invalid`/`aria-describedby`); form-level ones go in the
action row (`FormStatus`), with `FieldErrorFocus` to move the cursor to the offending box. A page's
`?notice=` is routed to the form that produced it by `noticeForForm` (`src/lib/staff-notices.ts`);
the page banner is left for what is genuinely about the page.

## A new page ships with a `loading.tsx` and `export const instant = true`

That file is the route's `<Suspense>` boundary — what a client navigation into the segment paints,
and what stands in the static shell while the page's request-scoped reads stream in. Shape it like
the body it replaces (an `animate-pulse` wrapper, `bg-surface-sunken` bars, `border-border
bg-surface` cards), never a spinner. **Never put an `await` above `{children}` in a `layout.tsx`**:
a layout wraps the page, so no boundary can be placed between them, and one request-scoped read
there costs every route beneath it its static shell — put the read in an async child inside its
own `<Suspense>`, with a fallback that holds its height. `next build` fails on a route that breaks
this (`blocking-prerender-dynamic` / `blocking-prerender-client-hook`), naming the component.
`instant = false` survives on exactly one layout, `src/app/shop/[shopSlug]/trips/[id]/layout.tsx`.
The staff shell is no longer the second: its six reads — session, shop row, locale, demo roles, nav
badge, boat link — moved into `_components/ShopChrome.tsx` behind a `<Suspense>` that holds the
bar's height, and its cross-tenant `notFound()` went with them, which is safe because every staff
page gates itself as well (ADR 20260804-instant-navigation; the **instant-navigation** skill).

## Never hard-code a locale, and every rendered date names its zone

Every date, time and money figure formats for the negotiated request locale (`requestLocale`) —
never a literal `"en-US"` (`pnpm check:locale`). Timestamps are stored as UTC instants and
displayed in the shop's own zone, so every date/time render passes `shop.timezone` alongside the
locale. This is not a style preference: `Intl` falls back to the *host* zone when no zone is given,
and every DiveDay server and CI box is UTC, so an omission renders a 7:30 AM departure as 11:30 AM —
plausible, green, and four hours wrong on the screen a diver uses to decide when to leave. A value
with no instant in it says `timeZone: "UTC"` explicitly (`src/lib/calendar-date.ts`).
`pnpm check:timezone` enforces the rest.

## Copy comes from a message bundle, never a component

Diver copy in `src/i18n/locales/<locale>/diver.json`, staff copy in
`locales/<locale>/staff/<namespace>.json` (one file per area). `pnpm check:copy` is a full gate over
`src/app`, `src/components` and `src/features`: any hard-coded copy fails it. **Never add English
(or any language) as a string the user will read outside `src/i18n/locales/`** — every new sentence
lands in *every* locale's bundle in the same change, and a key missing from one locale fails
`pnpm check:locale`. Waiver/medical wording stays English pending H-01/H-03. **Any diver Client
Component that reads copy needs `DiverIntlProvider` above it** — without one it throws during the
server render and the page silently degrades to a blank client-only 200;
`src/i18n/provider-coverage.test.ts` fails on a consumer with no provider in an ancestor segment.
Staff Client Components take words as props (`staffTranslator` is server-side only). See the
**i18n-copy** skill and the i18n rules.

## Every sentence earns its place, or it is deleted

Before writing a string — and every time you read past an existing one — ask whether the reader
would get something wrong without it. Only two kinds survive: one carrying a state or consequence
the surface cannot show on its own, and one that is genuine delight. A caption restating its own
heading, a clause explaining which rule won, a second manual path to what a nearby button already
does, and an apology for a refusal all go — deleted, not shortened, along with the element that held
them. Deleting a key means all three edits in one change: the call site, `en-US`, and `es-ES`. See
the **copy-restraint** skill. Where restraint and accessibility genuinely conflict, build for the
standard user and record the trade in
[docs/design/accessibility-tradeoffs.md](../../docs/design/accessibility-tradeoffs.md) — never a
follow-up, never silence. That licence stops at safety surfaces (manifests, roll call, cert gating,
medical flags), at keyboard reach, and at anything that costs the sighted user nothing.

## Delete says Delete

Every delete is soft (`deleted_at`) and the word on screen is still "Delete" — never Archive,
Deactivate, Retire, Hide or "soft delete", and never a caption explaining which history survived.
A publish toggle is "Hidden", not deleted. The full rule and its exceptions are in the db rules
(`.claude/rules/db.md`) and ADR 20260820-every-delete-is-soft.

## A panel that only renders when something has gone wrong

is photographed through `/api/test/seed-trouble-states`
(`src/app/api/test/seed-trouble-states/route.ts`), never by seeding the failure into the demo shop:
add the new state to that route and a capture beside the surface's calm one. A demo permanently
shouting that four payments are broken is a worse demo. Mutating is safe because each Playwright
worker owns its own database and resets it before every test (`e2e/servers.ts`).

## Every surface gets looked at

A user-facing change is verified by looking at it — `node scripts/screenshot.mjs <path…>` against a
running `pnpm dev`, light and dark, phone and desktop — and by the **design-review** skill for a
significant surface. Every important flow gets an `e2e/` spec and every important surface a capture
in `e2e/visual.spec.ts` (the **e2e-and-visual** skill). Safety-critical surfaces get a
`dive-domain-expert` review.
