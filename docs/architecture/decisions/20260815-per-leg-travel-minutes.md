# 20260815-per-leg-travel-minutes — A departure's travel time is one number per leg on `trip_dives`, never one per trip

- **Status:** Accepted
- **Date:** 2026-08-15

## Context

[20260812-configurable-dock-day-rhythm](20260812-configurable-dock-day-rhythm.md) made a shop's dive
day six configured minute amounts on `shops` and stopped inferring the timeline from the trip
window. One of those six is `boat_ride_minutes` — "how long the ride out to the first site takes".

That ADR listed "let each *trip* override the rhythm" among its alternatives and deferred it. The
follow-up it left behind (`FU-20260812-per-trip-dock-day-rhythm`) then proposed the obvious version
of that override — a single nullable `trips.boat_ride_minutes` — and was rewritten on 2026-08-14 to
say that the proposal was wrong. The rewrite is the reason this record exists, so it is worth
restating plainly:

**A departure is not one ride.** A two-tank morning is dock -> site A -> site B -> dock, and each
leg has its own duration. The durations are **order-dependent**: A->B is not the same run as B->A
when the two sites sit on different parts of the reef line, and dock->A depends entirely on which
site the boat opens with. A single number per trip cannot express "10 minutes out to the house reef,
25 across to the wall, 30 back", and averaging the legs puts every rendered time wrong — each in a
different direction. That is worse than the uniform wrongness of one shop-wide figure, because a
wrong number that varies per departure reads as though somebody measured it.

What exists already: `trip_dives` knows which site each dive visits and in what order, and
`dive_sites` carries coordinates. What is missing is duration between points.

The product call this needed — build it per leg rather than as reusable named routes — was made by
the product owner on 2026-08-15, and the pilot-shop question the follow-up wanted to ask first is
closed.

## Decision

**One nullable `trip_dives.travel_minutes`: how long the boat runs to reach *this* dive's site —
from the dock for dive one, from the previous dive's site after that.**

The column is where the fact lives. A leg belongs to an ordered pair of sites on one departure, and
`trip_dives` is already the row that names the site and the order. Bounds are the same 0–480 that
`DOCK_DAY_LIMITS.boatRideMinutes` puts on the shop-wide figure, enforced as a CHECK constraint so an
import or a hand-written fix cannot write a leg the form would have refused.

Three rules carry the model:

- **Null means "the shop's own `boat_ride_minutes` is right for this leg."** That is what every
  existing row reads as, so a shop that has filled nothing in reads exactly the day it read before,
  and a departure that states one leg is never worse off than one that states none. `0` is a
  *real* answer — the same site twice, or a walk-in entry — so the resolver honours it rather than
  treating it as absent. (This is the opposite of `SiteBottomTimes`, where zero means "nothing to
  say": a dive of no length is not a thing a shop can mean, and a run of no length is.)
- **Between two dives, the run and the rest are the same window.** The boat moves to the next site
  while the divers sit their interval out, so the gap between consecutive dives is
  `max(surfaceIntervalMinutes, travel)` rather than their sum, and whichever fact dominates that
  window is the beat the diver reads: a 90-minute run under a 60-minute interval renders as a ride,
  a 25-minute run under the same interval renders as the interval it fits inside. Adding them
  instead would have pushed every existing two-tank day out by a ride it already had — far enough on
  a tight window for the published-return truncation to swallow dive two. The ride *back* is not
  modelled at all: a trip's return time is a published promise, and the previous ADR's "the
  published return time wins" invariant is untouched.
- **`dockDayOffsets` still takes plain values, never rows.** Its new fourth parameter is a
  `LegTravelTimes` array — the same shape as `SiteBottomTimes` — so whatever merges a shop's rhythm
  with a departure's legs is a merge at the call site, and the arithmetic stays one function two
  readers share (the diver's timeline and the Settings preview). This was the one piece of good news
  the follow-up preserved through its rewrite and it survives intact.

A `boatRide` beat now carries a `number`, like `dive` and `surfaceInterval` already did: leg 1 is
the ride out from the dock, leg 2 the run across to the second site. The diver-facing word follows
it (`{number, plural, =1 {Ride out to the site} other {Ride to the next site}}`), because "ride out"
is a thing that happens once and a mid-day hop is not it.

**Where staff type it:** the per-dive plan on the trip form — `TripDiveFields`, which the schedule
board's "More options" disclosure (the one place a trip is created,
[20260806-one-trip-create-form](20260806-one-trip-create-form.md)) and the trip editor's
`DetailsSection` both mount. One optional box per dive card, beside the site it is a run to. A
copied departure and every instance of a recurring series inherit the legs, because the same sites
in the same order are the same run.

## Alternatives considered

- **A named route the shop defines once and picks per departure** ("Molasses & French" as an ordered
  list of sites with a leg duration on each). The follow-up's own recommendation, conditional on a
  pilot shop confirming that departures repeat a small set of itineraries — and the alternative this
  record most needs to close, so the next reader does not re-open it. **Rejected**, and
  [20260804-boat-resource-model](20260804-boat-resource-model.md) is why: it declined the adjacent
  `location`/marina dimension as "deliberately not spent here… deserves its own decision when a real
  split-site operator exists", and judged the full resource model down for being "structurally
  all-at-once" — a new schedulable entity, a backfill, and a surface to maintain, bought before any
  operator had asked for it. A route table is exactly that shape: a new table, a new staff surface
  to manage it, a picker on the trip editor, and a resolution path — all of it maintained by every
  shop, including the ones that permute sites freely, to save typing that only repeats-heavy shops
  would have done. The premise it rests on ("most shops run a handful of itineraries") is a fact
  about real shops that nobody here has. This decision keeps the cheap thing that is correct either
  way; if routes are earned later, they resolve *into* `travel_minutes` and this column is what they
  write, so nothing here is unwound.
- **A single nullable `trips.boat_ride_minutes`.** The falsified recommendation the follow-up was
  rewritten to withdraw. Rejected for the reason in Context: travel is per leg and order-dependent,
  so one number per trip is wrong in a way that varies per departure.
- **A per-pair travel table on the shop** (every ordered pair of sites, once). Honest and exact, and
  unfillable: n sites means n² ordered pairs, so a shop with 34 catalog sites faces a settings page
  with over a thousand boxes. It would fill four and silently fall back on the rest — the current
  problem wearing a bigger form.
- **Estimate the legs from `dive_sites` coordinates.** No data entry at all, and wrong in a way that
  is hard to explain: boats do not travel in straight lines at constant speed, and the difference
  between the inside route and going around is exactly the local knowledge a shop is selling. A
  confidently-computed wrong time is worse than an obviously-rough shared one.
- **Six nullable columns on `trips` duplicating the whole Settings form.** Rejected on the reasoning
  the previous ADR already gave: it multiplies the fields a shop maintains by every departure they
  run. Only the ride out ever genuinely varied per departure, and it varies *per leg*, which is not
  a trip-level column at all.

## Consequences

- The migration is additive — one `ADD COLUMN` and one CHECK, no destructive statement — so it
  applies under the previous release exactly as
  [20260806-destructive-migration-guard](20260806-destructive-migration-guard.md) requires.
- **Nothing moves for a shop that types nothing.** Every leg falls back to `boat_ride_minutes`, and
  the default ride (20) fits inside the default interval (60), so an untouched departure lays out
  minute for minute as it did before. The unit suite asserts that directly rather than leaving it to
  inspection.
- **A leg shorter than the surface interval is invisible, on purpose.** A shop that states "25
  minutes across to the wall" under a 60-minute interval sees the day unchanged, because the boat
  moved while the divers were sitting anyway. The box starts mattering exactly when the run is the
  thing that constrains the day, which is the case it was added for.
- The Settings preview is unaffected: it renders `dockDayOffsets(shop)` with no legs, so every leg
  falls back and no second ride appears at the default rhythm.
- **Still not a dive plan.** As with the rhythm itself, these minutes describe the *shape of a day*
  for a diver deciding when to leave the house. Nothing here feeds gas planning, no-decompression
  limits, or any computation a diver's safety depends on.
- `FU-20260812-per-trip-dock-day-rhythm` is closed and deleted; the pilot-shop questions it wanted
  asked are moot. [20260812-configurable-dock-day-rhythm](20260812-configurable-dock-day-rhythm.md)
  is **amended, not superseded** — its six shop columns, its `0`-drops-the-beat rule, its arrival
  clamp and its published-return invariant all stand. The one line of it this record changes is the
  reading of `boat_ride_minutes`, which is now the shop's usual run and the fallback for any leg a
  departure has not stated.
