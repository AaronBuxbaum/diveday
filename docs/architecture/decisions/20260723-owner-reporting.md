# 20260723-owner-reporting — A monthly owner dashboard over data we already hold

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

The buyer is usually the owner, and the question they ask first — *"how's my month?"* — had no surface.
[competitive-analysis.md](../../product/assessments/competitive-analysis.md#what-blocks-the-purchase)
lists "no owner reporting" as a recurring deal-blocker: rivals (DiveShop360, DiveAdmin, EVE) all show
bookings, revenue, and fill at a glance, and its absence reads as "this is a tool for the crew, not
for me." The [roadmap](../../product/roadmap.md) scopes the answer deliberately small — *"even a
modest dashboard over data that already exists removes the objection"* — because the data is already
here: trips carry capacity, bookings carry status, `booking_payments` carry collected money, and
`waiver_records` carry completion. Nothing new needs to be captured; it needs to be *summed*.

The one real modelling question is the time axis. Bookings, fill, and waivers live on a trip;
revenue lives on a payment. Reporting each on its own clock ("bookings by created date, revenue by
paid date") makes a single dashboard incoherent — the numbers stop describing one thing.

## Decision

- **One owner surface, `/shop/[shopSlug]/reports`** — a month view of four headline numbers
  (revenue collected, bookings, seat fill, waiver completion) plus a per-trip breakdown, with plain
  prev/next month navigation (`?month=YYYY-MM`, reusing `src/lib/calendar.ts`). Server-rendered, no
  client JS.
- **Everything is anchored to the trips that *departed* in the month**, in the shop's timezone. Fill
  rate, bookings, and waiver completion are intrinsic to those trips; **revenue is the money
  actually collected on their bookings** — the `paid` + `deposit_paid` `booking_payments` that also
  gate boarding. One clock, one coherent picture. Standalone retail orders are out of scope for this
  slice; the report says "collected on this month's trips," not "all money."
- **Layering mirrors the rest of the app.** The arithmetic — fill rate, waiver completion, the
  headline percentages, empty-month null handling — is pure and DB-free in `src/lib/reporting.ts`
  (`summarizeMonth`), exhaustively unit-tested. The three aggregate queries live in
  `src/db/reporting.ts` (`getMonthlyReport`), which converts nothing about time — the route turns the
  shop-local month into a UTC window with `src/lib/zoned.ts` and hands it two instants.
- **Owner/manager only** (`canViewShopReports` in `src/lib/authz.ts`, delegating to the export
  predicate). Revenue is owner-grade information the daily crew has no reason to see; the page shows
  the same owner-only notice the export does when a captain or instructor lands on it.
- **The demo is seeded with a realistic trailing quarter** so reporting is not hollow the first time
  a buyer opens it. `seedHistory` (in `src/db/seed.ts`) back-fills already-sailed trips across this
  month, last month, and the one before, with the bookings, `booking_payments`, signed
  `waiver_records`, and paid `orders` those trips left behind. It is derived deterministically from a
  booking counter (never a live clock or randomness) so the frozen-clock e2e fleet renders identical
  history every run and the report totals are Argos-stable. It is scoped to the past, so today's
  board and its exactly-asserted readiness counts are untouched.
- **The history is demo-only, and gated out of two paths.** The unit-test template
  (`src/test/db-template.ts`) and the trial-shop seeder (`seedShopWithDemoData`) pass
  `{ history: false }`: unit tests are calibrated to the small controlled dataset (and build their
  own history when they need it), and a **trial shop can connect its own Stripe account**, so it must
  never carry the fabricated-invoice orders. Those seeded `orders` have invented Stripe ids, so on a
  **demo shop the order page disables Refresh / Void / Refund** (with a hover explanation) and the
  server actions refuse before any Stripe call — the demo can show a billing history without a live
  Stripe round-trip failing against it.

## Alternatives considered

- **Report revenue by payment date, everything else by trip date** — rejected: two clocks on one
  dashboard stop describing a single month. Trip-departure anchoring keeps every number about the
  same set of trips.
- **Sum `orders` for revenue** — rejected as the canonical source: a paid order linked to a booking
  is the *same money* as that booking's payment, so counting both double-counts. `booking_payments`
  is the boarding-gate truth and is seeded everywhere the demo needs it; orders are seeded for
  billing-history realism on the diver profile, not for the revenue total.
- **Leave `orders` out of the demo** (the prior stance) — reconsidered: the seed used to omit orders
  precisely because their live Stripe actions would fail for fabricated invoices. Disabling those
  actions on a demo shop removes the hazard, so the demo can now show real-looking invoices — which
  is what makes the diver profile and the shop read as a going concern.
- **All-staff access** — rejected for the same reason as export/import: revenue is owner/manager
  work.
- **A charting library** — unnecessary. The dashboard is stat cards and CSS share-bars over semantic
  tokens (ADR-0004); no new runtime dependency, no ADR churn.

## Consequences

Easy: the loudest buyer objection now has a concrete answer in the demo, and the numbers are real —
seeded history means "how's my month" is populated on first open, and month navigation walks back
through fully-realized prior months. The pure `summarizeMonth` keeps the math testable, and the
trip-departure anchor means a later revenue slice (standalone retail) is an additive column, not a
reshape. Hard: the current month is inherently *month-to-date* — it mixes already-sailed trips with
still-upcoming ones whose waivers and payments are still coming in, so mid-month completion reads
lower than a closed month; the page labels the current month "so far" to be honest about it. The
demo/e2e vs unit-test split (`{ history }`) is a seam to keep in mind — the lean template is what
unit tests are calibrated to, and new history belongs behind that flag. Follow-up: standalone retail
revenue, a trailing-months trend, and per-trip revenue in the breakdown are the obvious next columns.
