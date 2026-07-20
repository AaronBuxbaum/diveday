# Cleanup & unification plan

A prioritized, self-contained work plan to simplify the product and the codebase. Written from a
full audit on 2026-07-19; file paths and line references were verified at commit `3d470f4`. Each
work package (WP) below is scoped to be executed independently by an agent **without re-auditing
the repo** — the "why" is here, the "what" is explicit, and the acceptance criteria are the
contract.

## How to execute this plan

- **One WP (or one lettered sub-item) per branch/PR.** Do not combine tracks.
- Every WP ends with `pnpm check` green. WPs that touch user flows also require the listed
  focused e2e run. WPs that touch UI require screenshots (`node scripts/screenshot.mjs`) reviewed
  in light and dark.
- **No behavior changes unless the WP says so.** Refactor WPs must leave every e2e spec passing
  unmodified (except where a WP explicitly says to update a spec).
- Decisions in this plan are **already made** — do not re-litigate them. If a WP's instructions
  turn out to conflict with the code you find, stop and report rather than improvising.
- Guardrails that always apply (from AGENTS.md): semantic tokens only; tests travel with
  behavior; safety-critical surfaces (manifest, roll call, cert gating, medical) get a
  `dive-domain-expert` review; docs invalidated by a change are fixed in the same PR.

Recommended order: Track 0 first (small, unblocks everything), then Track 1 and Track 2 in any
order, then Track 3 (largest). Track 4 is independent.

---

## Track 0 — Quick wins (correctness of docs/tooling + dead code)

### WP-0.1 Fix stale route references left over from the `/shop/[shopSlug]` restructure

The app moved from top-level routes to `/shop/[shopSlug]/**`, but guidance and tooling still
reference the old layout. There is **no** `src/app/trips/`; the public schedule is
`/shop/[shopSlug]/schedule` (made public by regex in `src/lib/auth.config.ts:44`).

- `AGENTS.md` route map: replace "`/trips` is the public schedule" with the truth: public
  schedule is `src/app/shop/[shopSlug]/schedule` (auth-exempt); staff trip management is
  `src/app/shop/[shopSlug]/trips/**`.
- `scripts/task-context.mjs`: fix stale paths — `src/app/trips/[id]` and `src/app/trips`
  (waivers, certifications, bookings areas), `src/app/shop/certifications`,
  `src/app/shop/nitrox`, `src/app/shop/trips` → their real `/shop/[shopSlug]/...` equivalents.
  Verify by running `pnpm task:context -- waivers` etc. and confirming no path is annotated
  "(planned or not present yet)" unless it truly doesn't exist.
- `docs/product/roadmap.md:18`: "`/trips` schedule page" → the real route.
- Stale `.claude/skills/` references (skills now live in `.agents/skills/`):
  `docs/architecture/decisions/README.md:7`, `scripts/screenshot.mjs:4`, and the root
  `README.md` sentence claiming `.claude/` carries the skills.
- `docs/product/glossary.md` "Demo mode" entry: cite ADR `20260718-dynamic-demo-onboarding`
  (not `production-demo-seed`) and describe per-visitor onboarded demo shops, not only the
  single seeded Blue Mantis shop.

Acceptance: `pnpm check` green; grep for `src/app/trips` and `.claude/skills` returns no hits
outside historical ADR bodies.

### WP-0.2 Delete dead code

- `src/lib/diver-planning.ts`: delete `packingChecklist` and `fitMessage` (only their own tests
  reference them) and the corresponding cases in `diver-planning.test.ts`. Keep
  `dockDayTimeline` (used by `schedule/[id]`).
- `e2e/smoke.spec.ts`: delete it — its single `h1` assertion on `/` is subsumed by
  `e2e/marketing.spec.ts`.

Acceptance: `pnpm check` green; `pnpm e2e -- e2e/marketing.spec.ts --reporter=line` green.

### WP-0.3 One scroll-preservation mechanism

Two components solve the same problem with different sessionStorage keys:
`src/components/PreserveFormScroll.tsx` (global, mounted in `src/app/shop/[shopSlug]/layout.tsx:49`)
and `src/components/ScrollPreservingForm.tsx` (+`RestorePreservedScroll`), used only by
`src/app/shop/[shopSlug]/trips/[id]/manifest/page.tsx`.

- Keep the global `PreserveFormScroll`. Convert the manifest page's `ScrollPreservingForm`
  usages to plain `<form>` and remove `RestorePreservedScroll`; delete
  `ScrollPreservingForm.tsx`.
- Manually verify the manifest flow: toggling roll-call state deep in a long manifest must not
  jump scroll position. Run `pnpm e2e -- e2e/manifest.spec.ts --reporter=line`.
- Manifest is a safety-critical surface: request a `dive-domain-expert` review even though this
  is behavior-neutral.

### WP-0.4 Prune stale planning docs

- `docs/product/next-steps.md`: ~70% is a historical execution narrative for phases that have
  shipped, plus a `src/features/` module proposal that was never adopted. Rewrite it down to the
  still-open items only (its P1 items 3–5, P2 queue, measures). Fold anything that is really
  roadmap material into `docs/product/roadmap.md`. Do not preserve the shipped-phase narrative.
- `docs/product/brainstorm/` (6 files): orphaned — nothing in the repo links into it. Either
  add it to the `docs/README.md` Map table or delete the folder. Decision: **add it to the Map**
  as an explicitly non-canonical idea backlog (one line), cheapest way to end the orphan state.
- Merge `docs/product/defaults-to-verify.md` into `docs/product/human-decisions.md` (5 of the
  12 H-rows already just point at it). Keep one file; update every link (run `pnpm check:docs`).
- `docs/architecture/decisions/20260718-notification-delivery-status.md`: the "rejected"
  alternative (full attempt history) later shipped as `notification_delivery_attempts`
  (`src/db/schema.ts`, `src/db/notifications.ts`). Do not delete the ADR; add a superseding ADR
  (`YYYYMMDD-notification-attempt-history`) recording the reversal, and mark the old one
  Superseded. Follow the `adr` skill.

Acceptance: `pnpm check:repo` green (ADR checker + doc links).

---

## Track 1 — Staff app unification (the "confusing to use" fixes)

Background you need: the staff shell nav (`src/components/ShopNavLinks.tsx`) shows
Today / Divers / Schedule / Gear plus a "More" menu (Nitrox fills, Dive sites, Reports, Courses,
Waivers, Shop) and a "New trip" button. Several routes overlap or are misnamed. Trips data has
**two list surfaces** (`/schedule` and the dashboard) and **two detail surfaces**
(`/schedule/[id]` public booking view, `/trips/[id]` staff management view). Staff clicking a trip
on `/schedule` currently land on `/schedule/[id]`, which detects staff and redirects to
`/trips/[id]` (`src/app/shop/[shopSlug]/schedule/[id]/page.tsx:103-104`).

### WP-1.1 Make trip navigation direct and consistent — ✅ shipped 2026-07-20

> Staff trip cards on `/schedule` link straight to `/trips/[id]`; the `/schedule/[id]` staff
> redirect stays as a fallback; the Schedule nav tab now stays lit on `/trips/*`.

Decision: `/schedule` stays the single trip **list** (dual staff/public), `/trips/[id]` stays the
staff **detail**, `/schedule/[id]` stays the public **booking** page. Remove the indirection, not
the pages.

- In `src/app/shop/[shopSlug]/schedule/page.tsx` (~line 89): when rendering for a staff session,
  link each trip card to `/shop/[shopSlug]/trips/[id]`; keep `/schedule/[id]` links for
  anonymous/diver visitors. The page already branches on staff vs public — reuse that flag.
  Keep the `schedule/[id]` staff redirect as a fallback for old links.
- Nav active state (`ShopNavLinks.tsx:38-40`): make `/trips/*` highlight the "Schedule" tab so
  staff don't lose their place when on a trip detail.
- Acceptance: `pnpm e2e -- e2e/booking.spec.ts e2e/schedule-trip.spec.ts e2e/trips.spec.ts
  --reporter=line` green. Update `e2e/booking.spec.ts:79-87` if it asserts the redirect hop
  rather than the destination.

### WP-1.2 Rename the "Shop" settings surface honestly — ✅ shipped 2026-07-20

> Nav item is "Settings" → `/settings/payments`, which is now the canonical URL (connect/callback
> routes and the page's own actions all target it). The `/shop` alias route was **deleted** rather
> than redirected — there are no users yet, so no bookmarks to preserve. h1 stays "Shop settings".

`/shop/[shopSlug]/shop/page.tsx` is a 1-line re-export of `settings/payments/page.tsx`; the nav
says "Shop", the page h1 says "Shop settings", the canonical URL is unlinked. Three names, one
page.

- Nav (`ShopNavLinks.tsx`): rename the Business-group item "Shop" → "Settings", pointing at
  `/shop/[shopSlug]/settings/payments`.
- Replace `shop/page.tsx`'s re-export with a `redirect()` to `settings/payments` (bookmark
  compatibility, same pattern as `certifications/page.tsx`).
- Keep the h1 "Shop settings".
- Acceptance: `pnpm check` green; screenshot the nav; `pnpm e2e -- e2e/auth.spec.ts` green.

### WP-1.3 Merge Reports into the dashboard — ✅ shipped 2026-07-20

> Adapted for the post-#59 Today work queue: Today already surfaces every *actionable* report item
> (blockers, gear, instructor, payment), so the unique descriptive aggregate (booked divers) moved
> to the Schedule `ShopStat` snapshot, and the `/reports` route + `db/reports.ts` were **deleted**
> (no redirect — no users). "Reports" is gone from the nav.

`reports/page.tsx` (112 lines) duplicates the dashboard's operational snapshot — it even
self-describes as "not a separate dashboard to keep in sync" while the root dashboard
(`page.tsx`, 375 lines) is exactly that. Decision: one overview surface.

- Move any stat/aggregate that exists **only** on `/reports` into the dashboard
  (`src/app/shop/[shopSlug]/page.tsx`), reusing the existing `ShopStat` tiles.
- Replace `reports/page.tsx` with a `redirect()` to the dashboard; remove "Reports" from
  `ShopNavLinks.tsx`.
- Acceptance: no data previously visible on `/reports` is lost (compare the two pages before
  deleting); `pnpm check` green; dashboard screenshots light+dark.

### WP-1.4 Disambiguate the two Nitrox pages — 🔁 superseded 2026-07-20 by a footprint cut

> Instead of retitling the shop-wide fill log to "Nitrox log", the standalone `/nitrox` page, its
> `listShopNitroxFills` query, and its dedicated nav slot were **removed** — cutting nitrox's
> disproportionate surface down to the trip-scoped `/trips/[id]/nitrox` workflow. The safety-critical
> fill gate, readiness blockers, math lib, and tables were kept intact. The original disambiguation
> below is retained for history but is no longer the plan.

`/nitrox` (73 lines) is a read-only shop-wide fill log; `/trips/[id]/nitrox` (253 lines) is the
logging form. Both are titled "Nitrox fills".

- Retitle the shop-wide page (metadata + h1 + nav label) to "Nitrox log".
- In the shop-wide page, render each fill row's trip as a link to that trip's
  `/trips/[id]/nitrox` page, and keep the existing empty-state pointer.
- Acceptance: `pnpm e2e -- e2e/nitrox.spec.ts --reporter=line` green (update title assertions
  if any).

### WP-1.5 One flash/notice system — ✅ shipped 2026-07-20 (rendering unified)

> Every staff-page banner/notice/error record and inline status `<p>` now renders through the shared
> `ShopNotice`; `FlashParams` was added where missing (`dive-sites`, `orders/new`). No
> `BANNERS`/`NOTICES`/`ERRORS` records remain in `src/app/`. Flash **keys** were already largely
> `?notice=`/`?error=`; the dashboard's structured params (`?created=`/`?series=`/`?email=`) were
> left as-is since they carry data (trip name, count) and already render via `ShopNotice`. The
> public booking page (`schedule/[id]`) keeps its compact in-card messages by design.

Today there are four mechanisms: the shared `ShopNotice` (in `ShopPageHeader.tsx`), hand-rolled
`BANNERS`/`NOTICES`/`ERRORS` records (`trips/[id]/page.tsx:118`, `trips/[id]/manifest/page.tsx:35`,
`trips/[id]/nitrox/page.tsx:30`, `settings/payments/page.tsx:19`, `orders/[id]/page.tsx:65`,
`orders/new/page.tsx:74`, `schedule/[id]/page.tsx:76`), and raw inline status `<p>`s
(`waivers/page.tsx:98-103`, `orders/new/page.tsx:142`). `FlashParams` (URL-param cleanup) is used
on some pages and missing on others that still read params (`dive-sites/page.tsx`).

- Convert every hand-rolled banner/notice/error record and inline status `<p>` on staff pages to
  `ShopNotice`, extending its tones only if a page genuinely needs one it lacks.
- Mount `FlashParams` on every staff page that reads a flash query param (add to
  `dive-sites/page.tsx`; audit `nitrox/page.tsx`, `schedule/page.tsx`).
- Standardize flash query keys to exactly two: `?notice=` (success/info) and `?error=`.
  Migrate the outliers (`?created=`, `?reset=`, `?email=`, `?booking=`, `?waitlist=`, `?bid=`,
  `?waiver=`) — update both the server actions that redirect and the pages that read them.
- Acceptance: full `pnpm e2e` run green (this touches many flows); grep confirms no
  `BANNERS`/`NOTICES`/`ERRORS` records remain in `src/app/`.

### WP-1.6 Shared UI primitives: Button, EmptyState, page container

- Create `src/components/Button.tsx` (or extend `SubmitButton.tsx`) with the repo's standard
  primary/secondary styles; the canonical class string is the `min-h-11 rounded-xl bg-primary…`
  pattern currently copy-pasted at `page.tsx:79`, `schedule/page.tsx:43`, `dive-sites/page.tsx:42`,
  `courses/page.tsx:100`, `divers/page.tsx:98` (and variants). Replace the copy-pasted strings.
- Create `src/components/EmptyState.tsx` from the dashed-border card pattern
  (`page.tsx:321`, `dive-sites/page.tsx:85`) and use it for the plain-`<p>` empty states
  (`schedule/page.tsx:76`, `nitrox/page.tsx:45`).
- Adopt `SubmitButton` (pending-state guard) in the 14 files still using raw
  `<button type="submit">` in server-action forms: sign-in, waivers (public + staff), trips/new,
  trips/[id]/nitrox, orders/new, orders/[id], settings/payments, gear, courses, divers,
  divers/[personId], dive-sites/catalog, dive-sites/new, dive-sites/[id].
- Adopt `ShopPageHeader` on the staff pages that hand-roll headers where the page is a normal
  list/detail (reports is going away; the dashboard hero and manifest print view may stay
  bespoke): waivers, orders/new, orders/[id], settings/payments, dive-sites/[id],
  dive-sites/new, dive-sites/catalog, trips/[id]/nitrox. Standardize the container to the
  `ShopPageHeader` pages' `max-w-5xl px-4 py-8 sm:px-6 sm:py-10` for list pages; detail/form
  pages may use a narrower max-width but must share the same vertical rhythm.
- Semantic tokens only; no new hex values.
- Acceptance: full `pnpm e2e` green; screenshots (light+dark, desktop+phone) of divers, gear,
  waivers, orders/new, settings/payments; visual pass confirms headers/eyebrows/buttons look
  uniform.

Split WP-1.6 into three PRs if needed: (a) Button+SubmitButton adoption, (b) EmptyState,
(c) ShopPageHeader/container normalization.

---

## Track 2 — Public site unification

### WP-2.1 Give visitors a path to the product, and a way back in

- Add a "Sign in" link to `src/components/MarketingNav.tsx` (currently only Product, Pricing,
  "Start a trial"; sign-in is reachable only via the footer).
- Render `MarketingNav` + `MarketingFooter` on `/onboard` and `/sign-in` (currently bare pages
  with a text link home). Leave `/waivers/[token]` and `/offline-manifest` bare — they're
  task-focused surfaces.
- Add a marketing link to the live public schedule of the seeded demo shop
  (`/shop/blue-mantis/schedule`) — e.g. a "See a live schedule" secondary link near the hero
  CTAs in `src/components/HomeCTA.tsx`. The landing page markets a "live schedule" that no
  public link currently reaches.
- Unify CTA language: hero primary stays **"Try the live demo"** (`enterDemoAction`), and the
  nav/closing CTA stays **"Start a trial"** (`/onboard`) — but the landing closing CTA and hero
  must present *both* options with the same two labels, not new verbs.
- Acceptance: `pnpm e2e -- e2e/marketing.spec.ts e2e/auth.spec.ts --reporter=line` green;
  screenshots of landing, onboard, sign-in.

### WP-2.2 Deduplicate the marketing pages

`/`, `/product`, and `/pricing` all render the same `productFeatureGroups`
(`src/lib/marketing.ts:7-48`) with near-identical hand-maintained markup
(`product/page.tsx:87-105` vs `pricing/page.tsx:106-124`).

- Extract one `FeatureGroupsGrid` component (props: `featuresPerGroup?: number`) and use it on
  all three pages.
- Deduplicate the repeated screenshot+copy sections between landing and product
  (`page.tsx:29-31,66-71` vs `product/page.tsx:67-72,113-120`) into shared components with copy
  passed as props. Keep all three URLs — the goal is shared rendering, not fewer pages.
- Acceptance: `pnpm e2e -- e2e/marketing.spec.ts --reporter=line` green; visual diff of the
  three pages vs before (screenshots) shows no unintended change.

### WP-2.3 Make the marketing visuals honest (screenshot machinery)

Reality: `public/marketing/*.png` has never existed in the repo; every `MarketingScreenshot`
falls back to the hand-built mockups in `MarketingScreenFallbacks.tsx` (114 lines), while
`docs/product/marketing.md:17` claims tracked real screenshots. Decision: **ship the mockups as
the design**, remove the dead 404-image path.

- Replace each `MarketingScreenshot` usage (`page.tsx:20,29,67`, `product/page.tsx:68,116`) with
  a direct render of the corresponding fallback component; delete `MarketingScreenshot.tsx`.
- Delete `scripts/capture-marketing-screenshots.mjs` and the `screenshots:marketing` script from
  `package.json`.
- Rewrite `docs/product/marketing.md`'s screenshot section: the public pages ship deterministic
  illustrated mockups; real-screenshot capture can be reintroduced later via ADR if wanted.
- Acceptance: `pnpm e2e -- e2e/marketing.spec.ts` green; landing/product screenshots confirm
  identical visuals (the fallbacks were already what rendered).

### WP-2.4 Fix the trial/demo identity confusion

Two problems: (a) `onboardAction` (`src/app/actions/onboard.ts:75`) sets `isDemo: seedDemoData`,
so a real trial shop that keeps the default "seed demo data" checkbox gets the Demo Playground
banner and a destructive "Reset demo data" button; (b) the DemoBanner role-switcher
(`src/app/actions/demo.ts:80-94`) hardcodes seeded Blue Mantis emails, so on any *other* seeded
shop, instructor/divemaster/captain switching fails with `?error=switch_failed`.

- Split the concepts: seeding sample data must not imply demo mode. In `onboardAction`, set
  `isDemo: false` for onboarded shops (the checkbox only controls seeding). Reserve
  `isDemo: true` for the canonical seeded demo tenant created by `seedIfEmpty`
  (`src/db/seed.ts`) and `enterDemoAction`.
- Fix the role-switcher to look up each target person **by role within the current shop** (the
  owner path at `demo.ts:70-77` already does this) instead of hardcoded emails. If a role has no
  seeded person in that shop, hide that role card rather than failing after click.
- Update copy that promises role-switching on trials (`product/page.tsx:150-152`,
  `pricing` FAQ if applicable) to match: role-switching is a demo-tenant feature.
- Tests: extend `e2e/demo.spec.ts` to cover switching to instructor and back to owner; add a
  unit test asserting onboarded shops are not `isDemo`.
- This changes product semantics — keep the diff small and flag it clearly in the PR
  description. Acceptance: `pnpm e2e -- e2e/demo.spec.ts --reporter=line` green.

---

## Track 3 — Structural code cleanup (largest, do after Tracks 1–2 settle)

### WP-3.1 Split the `db/queries.ts` grab-bag

`src/db/queries.ts` (429 lines) mixes trips, bookings, and shop config, while dedicated modules
already exist.

- Move booking ops (`getBookingForTrip:325`, `restoreBooking:341`, `cancelBooking:350`) into
  `src/db/bookings.ts`.
- Move shop ops (`getShopBySlug:359`, `getShopById:364`, `setShopJurisdiction:370`,
  `setShopPackingList:380`, `getDefaultShop:393`) into a new `src/db/shops.ts`.
- Rename the remainder (trips, trip dives, conditions, crew, staff listing, waitlist reads) to
  `src/db/trips.ts`; update all imports (typecheck will enumerate them). Move the matching
  tests from `queries.test.ts` alongside.
- Pure mechanical move — no signature or behavior changes.
- Acceptance: `pnpm check` green; `git grep "db/queries"` returns nothing.

### WP-3.2 Shared test context for db tests

~20 `src/db/*.test.ts` files each define a private context builder repeating
`createTestDb()` → `seedDemo(db)` → `getShopBySlug(db, "blue-mantis")` (see
`bookings.test.ts:10-20`, `gear.test.ts:19-29`).

- Add `src/test/db.ts` exporting `seededShopContext()` returning `{ db, shop }` (and the couple
  of common extras like the seeded upcoming trips where several files need them). Convert the db
  test files to use it. Keep the per-file `// @vitest-environment node` pragma.
- Do **not** attempt to cache/share a single PGlite instance across tests in this WP — isolation
  per test stays. (A migrate-once template-db optimization is a separate, riskier task; note it
  in the PR description as a possible follow-up, don't do it.)
- Also add `e2e/helpers.ts` with the `signInAsOwner(page)` and `daysFromNow(days)` helpers
  currently duplicated verbatim in `booking.spec.ts:4-15` and `schedule-trip.spec.ts:4-16`, and
  import them from both specs.
- Acceptance: `pnpm test` and both e2e specs green; net line count of test files goes down.

### WP-3.3 Decompose the two monster pages

`src/app/shop/[shopSlug]/trips/[id]/page.tsx` (1,296 lines) and
`src/app/shop/[shopSlug]/divers/[personId]/page.tsx` (1,140 lines) each mix data loading,
several zod schemas, half a dozen inline `"use server"` actions, and full rendering.

For each page (separate PRs):
- Extract the server actions + zod schemas into a colocated `actions.ts` (file-level
  `"use server"`) next to the page.
- Extract the major render sections into colocated server components under a `_components/`
  folder beside the page (e.g. roster, readiness, gear, waivers, conditions, crew, payments for
  the trip page). Props in, JSX out — no client components unless one already exists.
- Zero behavior change; do not redesign markup while moving it.
- The trip page touches manifest/readiness (safety-critical): run
  `pnpm e2e -- e2e/manifest.spec.ts e2e/booking.spec.ts e2e/waivers.spec.ts e2e/gear.spec.ts
  --reporter=line` and request `dive-domain-expert` review.
- Acceptance: each page file lands under ~300 lines; full `pnpm check` + listed e2e green.

Optional follow-ups at the same pattern, lower priority: `schedule/[id]/page.tsx` (721) and
`gear/page.tsx` (514).

### WP-3.4 Document the server-action convention

19 pages define inline `"use server"` closures; only demo/onboard live in `src/app/actions/`.
Decision: **inline actions are the default for single-page mutations; `src/app/actions/` is only
for actions shared across pages; large pages colocate an `actions.ts` (WP-3.3 pattern).** Add
this rule to AGENTS.md (Layout bullet) and `docs/engineering/workflow.md`. No code churn beyond
what WP-3.3 already does.

---

## Track 4 — Small independent nits

Bundle these into one PR:

- `package.json`: drop the `format` script (redundant with `lint:fix`, which formats too), and
  add `"screenshot": "node scripts/screenshot.mjs"` so both screenshot entry points are wired.
- `tsconfig.json`: raise `target` from ES2017 to at least ES2022 (the stack is React 19 /
  Next 16 / TS7; ES2017 is a stale default). Verify `pnpm build` and `pnpm check`.
- `scripts/check-doc-links.mjs`: extend scanning to `.agents/skills/**/*.md` so skill docs get
  link-checked like everything else.
- `src/lib/auth.config.ts` / redirect stubs: no changes — noted here only so nobody "cleans up"
  the `certifications` and `orders` redirect stubs; they are intentional bookmark shims.

---

## Explicitly out of scope (do not do these as "cleanup")

- Merging `/schedule/[id]` and `/trips/[id]` into a single role-branched page — the split view
  (public booking vs staff ops) is intentional; WP-1.1 fixes the navigation confusion instead.
- Deleting superseded ADRs — the ADR convention retains them as history.
- Replacing PGlite-per-test with a shared database — flagged as a possible perf follow-up in
  WP-3.2, needs its own design.
- Any new runtime dependency (would need an ADR) — every WP above is dependency-free.
- Restructuring `src/lib` dive-site helper files (`dive-site-media/map/landmarks`) — they are
  small, live, and single-purpose; consolidation is churn without payoff.
