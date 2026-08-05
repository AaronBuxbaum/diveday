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
state. The legacy `trips.dive_site_id` remains synchronized to the first dive for compatibility
with shared readiness and marine forecasting while consumers migrate to the ordered rows.

## Alternatives considered

- **Put a JSON array on `trips`** — rejected because per-dive site references, ordering, tenant
  validation, and future operational fields deserve database constraints and queryable rows.
- **Make every dive a separate trip** — rejected because booking, capacity, payment, waiver, and
  boat-day conditions are shared; splitting them would make the customer book the same boat twice.
- **Require every dive to have a site** — rejected because operators commonly publish a two-tank
  outing before choosing the second mooring and must not be pushed into fabricated details.

## Consequences

Staff can publish a polished one-to-four-dive plan incrementally, while divers see only details the
shop actually supplied. Readiness and forecast behavior remain backward-compatible through the
first-dive compatibility field. Per-dive readiness gates and per-dive conditions remain future
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
