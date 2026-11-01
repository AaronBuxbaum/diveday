# 20260719-trip-dive-briefings — Keep shared trips and optional per-dive briefings separate

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

A boat outing is one bookable trip with shared timing, capacity, price, conditions, and readiness
requirements, but it may contain up to four separate dives. Shops often know only that a trip is a
"two-tank dive" when it is published; the diver-facing experience should still be clear without
inventing site or route details.

## Decision

Keep the shared information on `trips` and store ordered optional detail rows in `trip_dives`. Each
row may name a dive, reference a reusable dive-site briefing, and include a short diver-facing
description. The trip's `planned_dives` remains the count used by manifests and is constrained to
one through four; blank detail rows are valid and render as a transparent "details to be briefed"
state. The ordered rows are the only place a planned site lives; the trip row carries no site column
(see the 2026-10-31 amendment, which removed the compatibility pointer this paragraph first
introduced).

## Alternatives considered

- **Put a JSON array on `trips`** — rejected because per-dive site references, ordering, tenant
  validation, and future operational fields deserve database constraints and queryable rows.
- **Make every dive a separate trip** — rejected because booking, capacity, payment, waiver, and
  boat-day conditions are shared; splitting them would make the customer book the same boat twice.
- **Require every dive to have a site** — rejected because operators commonly publish a two-tank
  outing before choosing the second mooring and must not be pushed into fabricated details.

## Consequences

Staff can publish a polished one-to-four-dive plan incrementally, while divers see only details the
shop actually supplied. Readiness and the marine forecast read the ordered rows. Per-dive readiness gates and per-dive conditions remain future
extensions; this slice is briefing and itinerary detail, not a second safety authorization path.

## Amendment 2026-08-05 — the migration off the compatibility field is finished, and it now tracks the first *chosen* site

"While consumers migrate to the ordered rows" stayed true for a year of surfaces. The schedule
card, the staff trip header, and the trip's own requirements note all still read
`trips.dive_site_id` and presented it as *the trip's site* — so a two-site day named only the
first, and a shop owner comparing a two-tank booking page against it read "one dive site, two dive
briefings" and reasonably concluded the two concepts disagreed.

Two things change, neither of them schema:

1. **Every surface that answers "where does this trip go" composes the dives**, through one shared
   function — `summarizeTripDiveSites` (`src/lib/trip-dives.ts`), batched for a list by
   `tripDiveSiteSummaries` (`src/db/trips-queries.ts`). It returns the distinct sites in dive order
   *and* how many tanks have no site yet, because the second number is what makes "one site, two
   dives" legible as the published plan this ADR deliberately allows rather than as missing data.
   The per-dive cards say `Site to be confirmed` on the open tank for the same reason. A trip with
   no `trip_dives` rows at all falls back to `trips.dive_site_id`; every write path mints one row
   per planned dive, so that shape should not exist, but answering "nowhere" for a trip whose row
   names a site would be worse than the bug being fixed.
2. **The compatibility field now points at the first dive that *has* a site**, not strictly dive
   one (`primaryDiveSiteId`, `src/db/trips-create.ts`). Its two remaining consumers are the marine
   forecast's coordinate and the calendar feed's `LOCATION`, and both want any real site on the day
   rather than nothing: a departure planned second-tank-first stored null and so offered no
   forecast, no `LOCATION`, and no directions. This can only add a site the trip already visits, so
   it changes no gate — readiness and the depth advisory already union this pointer with every
   `trip_dives` site (`tripVisitedSites`, `src/db/readiness.ts`).

The trip's requirements note is the safety-relevant half. `getTripSiteRequirement` was already the
union across every visited site, while the sentence naming the source of the rule read
`trip.diveSite` — so on a two-site day whose Deep gate came from tank two, staff were sent to the
wrong site card to understand or change it. It now names every visited site, with a plural wording
to match.

## Amendment 2026-10-31 — `trips.dive_site_id` is gone; `trip_dives` is the single representation (issue #3237)

The compatibility pointer duplicated a domain fact and the policy that kept it in step (create,
edit, series propagation, a revision bump when it moved), and the zero-`trip_dives` fallback
existed only to tolerate a shape no writer produces. Aaron decided on 2026-10-31 that prior
behavior need not be preserved (H-20260815-no-legacy: no legacy), so both are deleted.

- **The column, in two releases.** The first release removed the `trips.dive_site_id` declaration
  and every reader and writer, leaving the column in the database, unread and unwritten. The deploy
  guard (`pnpm check:migrations`) refuses a `drop-column` while the previous release still
  declares the column, because that release's whole-row selects name it. The second release,
  `20261101174606_drop-duplicate-lookup-indexes`, dropped the foreign key and the column. Per H-20260815-no-legacy
  there is no backfill: a trip that had a pointer and no `trip_dives` rows (only demo seeds did) is
  rebuilt by the seed, not migrated.
- **One projection for "the trip's site".** `tripPrimarySiteId` (`src/db/trip-primary-site.ts`) is
  a correlated subquery: the site of the lowest-numbered dive that has one, which is exactly what
  the pointer held. Its consumers are the ones that can show only one site: the `diveSite` joined
  onto the schedule and trip-record reads (forecast point, card headline), the calendar feed's
  `LOCATION`, similar-departure matching, the Today station line, and the demo-seed readers. It
  is never a gate.
- **Gates read every dive.** Readiness, the requirements summary and the depth advisory join
  `dive_sites` through `trip_dives` alone (`tripVisitedSites`, `tripRequirementSummaries`,
  `getTripMaxDepthMeters`), so a trip whose dives span several sites still requires the
  certification, specialty and nitrox of every one of them, whichever tank carries the strictest
  site. The tests in `src/db/readiness.test.ts` pin that, including a gate that lives only on the
  last dive.
- **"Trips at this site" asks every dive.** Site reviews and past-diver invitations use
  `tripVisitsSite` / the dive rows, not the first site, so a second-tank visit counts.
- **Writers.** `createTrip`, `createTripSeries` and `updateTrip` take only `dives`; the
  single-site shorthand (`diveSiteId` on a new trip or a patch) is removed, and the schedule
  builder's quick-row site becomes dive one. Series propagation copies the dive rows, and a
  sibling's `revision` rises when its ordered site list changes, as before.
- **Exports.** `trips.csv` no longer carries `dive_site_id` and `dive_site_name`; `trip_dives.csv`
  holds each dive's site. The bundle contract changed deliberately and the export snapshot was
  regenerated.
- **Cost.** The correlated subquery runs once per listed trip against `trip_dives_trip_number_unique`
  (an index probe returning the first non-null row), replacing a column read. A list is one page
  of departures, so the added work is a bounded index lookup per row.
