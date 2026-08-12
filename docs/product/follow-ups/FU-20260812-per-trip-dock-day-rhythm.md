# FU-20260812-per-trip-dock-day-rhythm — Decide whether a single departure may override the shop's dock-day rhythm

- **Status:** Open
- **Raised:** 2026-08-12 — ADR 20260812-configurable-dock-day-rhythm
- **Kind:** question
- **Effort:** M
- **Touches:** `src/lib/diver-planning.ts`, `src/db/schema.ts`, `src/app/shop/[shopSlug]/trips/[id]/_components/DetailsSection.tsx`, `src/app/s/[shopSlug]/trips/[id]/_components/PackingSection.tsx`

## What I noticed

The dock-day rhythm is now six minute amounts on `shops` — arrival call, gear set-up, briefing,
ride out, bottom time, surface interval — and every departure lays its day out from the same six.
Two facts about the *trip* already feed in (`startsAt`/`endsAt` and `planned_dives`), which is what
makes a one-tank afternoon render a one-tank day. Nothing else can differ.

A real shop's departures do differ, and the ride out is the obvious one: a house-reef morning that
is ten minutes off the dock and a wall trip that is ninety share one `boat_ride_minutes`. Today the
house-reef trip's diver reads a 20-minute ride that does not happen, and the wall trip's diver
reads a first dive an hour before it starts. Bottom time is the next most likely — a training
confined-water session is not a 45-minute drift.

Concretely: on the seeded demo shop, "Discover Scuba Diving — afternoon" and any deep wall
departure render identical shapes with only their published start and return differing.

## Why it isn't already done

It needs a product call I can't make on my own, and the ADR chose to ship the shop-level version
first deliberately: a per-trip override multiplies the fields a shop maintains by every departure
they run, to solve a problem nobody has reported yet, before anyone has used the shop-level one at
all. That reasoning is honest but it is a bet, and the bet should be checked against a real shop
rather than left to age quietly.

The trade-off:

- **Do nothing.** Cheapest, and the timeline is already far more truthful than the trip-window
  thirds it replaced. Risk: a shop with genuinely varied departures reads DiveDay telling their
  divers a shape they don't run — the same complaint that produced the whole change.
- **Override only the ride out.** One nullable `trips.boat_ride_minutes` (null = use the shop's).
  Covers the case most likely to be wrong, costs one optional box on the trip editor. My
  recommendation if a shop asks for anything here.
- **Override the whole rhythm per trip.** Six nullable columns and a second copy of the Settings
  form on every trip. I would not do this: it is a lot of surface for a rare need, and a departure
  that differs *that* much is arguably a different kind of trip.

## Proposed change

Ask a pilot shop (docs/product/rollout.md's recruiting work) whether their departures share one
shape. If yes, close this as answered. If no, add a single nullable `trips.boat_ride_minutes`,
resolve it in `dockDayOffsets` by taking the trip's value when set and the shop's otherwise, and
put one optional box beside "Days" in `DetailsSection` — deliberately *not* a per-trip copy of the
Settings form.

Note the shape that makes this cheap: `dockDayOffsets` already takes the rhythm as a plain
`DockDayRhythm` value rather than reading a shop row, so an override is a merge at the call site
and no change to the arithmetic.

## Prompt

```text
Decide whether a single departure may override the shop's dock-day rhythm, and implement the
answer.

Read first: docs/architecture/decisions/20260812-configurable-dock-day-rhythm.md (its "Alternatives
considered" section covers this and says why it was deferred), then src/lib/diver-planning.ts and
its test, then src/app/s/[shopSlug]/trips/[id]/_components/PackingSection.tsx.

The constraint that makes this non-obvious: `dockDayOffsets(rhythm, plannedDives)` takes a plain
DockDayRhythm value, not a shop row, so a per-trip override is a merge at the call site and needs
no change to the arithmetic at all. Resist adding a second copy of the Settings form to the trip
editor — the recommendation in the follow-up is one nullable `trips.boat_ride_minutes` and one
optional box beside "Days" in DetailsSection, nothing more.

If the answer is "shops don't need this", just delete the follow-up file and say so in the PR.

If implementing: the migration must be additive only (ADR 20260806-destructive-migration-guard),
the new column needs the same DOCK_DAY_LIMITS bound and a CHECK, and the diver-facing behaviour
needs a case in src/lib/diver-planning.test.ts plus an assertion in e2e/dock-day-rhythm.spec.ts.
Done when `pnpm check` is green and `pnpm e2e:run e2e/dock-day-rhythm.spec.ts --reporter=line`
passes. Delete docs/product/follow-ups/FU-20260812-per-trip-dock-day-rhythm.md as part of the
change.
```
