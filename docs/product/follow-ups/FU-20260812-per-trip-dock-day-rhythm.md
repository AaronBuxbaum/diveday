# FU-20260812-per-trip-dock-day-rhythm — Model a departure's timeline as a route, not as one ride-out number

- **Status:** Open
- **Raised:** 2026-08-12 — ADR 20260812-configurable-dock-day-rhythm.
  **Rewritten 2026-08-14** (Aaron Buxbaum): the original entry recommended a single nullable
  `trips.boat_ride_minutes`, and that recommendation is wrong. See "What changed" below.
- **Kind:** question
- **Effort:** L
- **Touches:** `src/lib/diver-planning.ts`, `src/db/schema.ts`, `src/db/trips-record.ts`,
  `src/app/shop/[shopSlug]/trips/[id]/_components/DetailsSection.tsx`,
  `src/app/s/[shopSlug]/trips/[id]/_components/PackingSection.tsx`

**This is a feature, not a field.** The original `M` framing is what made it look like something a
session could pick up between other work.

## What I noticed

The dock-day rhythm is six minute amounts on `shops` — arrival call, gear set-up, briefing, ride
out, bottom time, surface interval — and every departure lays its day out from the same six. Two
facts about the *trip* already feed in (`startsAt`/`endsAt` and `planned_dives`), which is what makes
a one-tank afternoon render a one-tank day. Nothing else can differ.

So a house-reef morning ten minutes off the dock and a wall trip ninety minutes out share one
`boat_ride_minutes`. The house-reef diver reads a ride that does not happen; the wall diver reads a
first dive an hour before it starts. On the seeded demo shop, "Discover Scuba Diving — afternoon" and
any deep wall departure render identical shapes with only their published start and return differing.

## Why it isn't already done

It needs a product call nobody can make from inside the code, and the call it needs is not the one
this entry originally asked for. The ADR shipped the shop-level rhythm first on the reasoning that a
per-trip override multiplies maintained fields by every departure to solve a problem nobody had
reported. That reasoning still holds — but the *shape* of the fix it deferred was wrong, which is
the substance of the next section, and picking the right one depends on how real shops actually run
their boards.

## What changed, and why the obvious fix is wrong

The original entry proposed one nullable `trips.boat_ride_minutes` — "override only the ride out",
resolved in `dockDayOffsets` by taking the trip's value when set and the shop's otherwise. It called
that the cheap, obviously-correct half.

**It isn't, because a departure is not one ride.** A two-tank trip is dock → site A → site B → dock,
and each leg has its own duration. Worse, the durations are **order-dependent**: A→B is not the same
run as B→A when the two sites sit on different parts of the reef line, and dock→A depends on which
site the boat opens with. A single number per trip cannot express "10 minutes out to the house reef,
25 across to the wall, 30 back", and averaging the legs puts every rendered time wrong — each in a
different direction, which is worse than the uniform wrongness we have now, because a wrong number
that varies looks authoritative.

That makes this a modelling question about what a departure *is*, not a question about which column
to add.

## The options, and what each costs

The raw material already exists: `trip_dives` knows which site each dive visits and in what order,
and `dive_sites` carries coordinates for the route maps. What is missing is duration between points.

1. **A per-pair travel table on the shop.** Honest and exact. Unfillable: n sites means n² ordered
   pairs, and a shop with 34 catalog sites would face a settings page with over a thousand boxes. A
   shop would fill in four of them and the rest would silently fall back, which is the current
   problem wearing a bigger form.
2. **Estimate from coordinates.** No data entry at all. Wrong in a way that is hard to explain: boats
   do not travel in straight lines at constant speed, and the difference between the inside route and
   going around is exactly the kind of local knowledge a shop is selling. A confidently-wrong
   computed time is worse than an obviously-rough shared one.
3. **Per-leg minutes on `trip_dives`.** Fillable, correct, and it puts the number where the fact
   lives. Cost is per dive per departure — real typing for a shop running a full board, and it
   re-asks the same question every time they run the same trip.
4. **A named route the shop defines once and picks per departure.** "Molasses & French" is a route:
   an ordered list of sites with a leg duration on each, defined once and attached to any departure
   that runs it. This is the one that fits how a shop actually operates — most run a handful of
   itineraries repeatedly rather than a fresh permutation each morning — and it collapses option 3's
   per-departure typing into per-route typing. It is also the largest change: a new table, a new
   staff surface to manage it, a picker on the trip editor, and a resolution path in
   `dockDayOffsets`.

My recommendation is **4, conditional on a real shop confirming the premise** — that departures
repeat a small set of itineraries. If they genuinely permute sites freely, 4 buys nothing over 3 and
costs a whole surface. That premise is the thing to ask about, and it is not something to guess.

Note the one piece of good news that survives the rewrite: `dockDayOffsets(rhythm, plannedDives)`
takes a plain `DockDayRhythm` value rather than reading a shop row, so whatever resolves the legs is
a merge at the call site and the arithmetic itself does not change.

## Proposed change

**Do not implement anything yet.** Ask a pilot shop (`docs/product/rollout.md`'s recruiting work,
H-31/H-32) three questions:

1. Do your departures repeat a small set of itineraries, or is each one assembled fresh?
2. For a typical two-tank, how different are the three legs — dock to first site, first to second,
   second back?
3. Does the order you dive them change the timings enough to matter, or is it roughly symmetric?

If the answers say routes repeat → build option 4, with its own ADR, and read
`20260804-boat-resource-model`'s alternatives section first: it already declined an adjacent
dimension with reasoning that applies. If they say each departure is assembled fresh → option 3, per
leg on `trip_dives`. If they say the legs are close enough that nobody would notice → close this and
record that the shop-level rhythm was right all along.

**Not proposed:** a single `trips.boat_ride_minutes` (the falsified recommendation above), six
nullable columns duplicating the Settings form on every trip, or a computed estimate from
coordinates.

## Prompt

```text
Decide how a departure's timeline should model travel between dive sites, and implement the answer.
This is a feature-sized change with its own ADR, not a column.

Read first:
  - docs/product/follow-ups/FU-20260812-per-trip-dock-day-rhythm.md (this file — its "What changed"
    section explains why the obvious single-field fix is wrong, and its options section costs four
    alternatives with a recommendation)
  - docs/architecture/decisions/20260812-configurable-dock-day-rhythm.md
  - src/lib/diver-planning.ts (dockDayOffsets) and its test
  - src/app/s/[shopSlug]/trips/[id]/_components/PackingSection.tsx — where a diver reads it
  - src/db/schema.ts — tripDives (which site, in what order) and diveSites (coordinates)
  - docs/architecture/decisions/20260804-boat-resource-model.md, alternatives section — it already
    declined an adjacent dimension for reasons that apply here

The constraint that makes this non-obvious: travel time is PER LEG and ORDER-DEPENDENT. Dock->A,
A->B and B->dock are three different durations, and A->B is not B->A. Any model built on one number
per trip is wrong in a way that varies per departure, which reads more authoritative than the
uniform wrongness it replaces. Do not add `trips.boat_ride_minutes`.

Do NOT start building without the pilot-shop answers to the three questions in this file. Which
option is right turns entirely on whether a shop repeats a small set of itineraries or assembles
each departure fresh, and that is a fact about real shops that no amount of reading the code
settles. If you do not have those answers, say so and stop.

Whatever is built: the migration is additive only (ADR 20260806-destructive-migration-guard),
dockDayOffsets keeps taking a plain value rather than reading rows, diver-facing behaviour gets a
case in src/lib/diver-planning.test.ts plus an assertion in e2e/dock-day-rhythm.spec.ts, and the
rendered times are checked against a real two-tank shape rather than only a unit fixture.

Done when `pnpm check` is green and `pnpm e2e:run e2e/dock-day-rhythm.spec.ts --reporter=line`
passes. Delete docs/product/follow-ups/FU-20260812-per-trip-dock-day-rhythm.md as part of the
change.
```
