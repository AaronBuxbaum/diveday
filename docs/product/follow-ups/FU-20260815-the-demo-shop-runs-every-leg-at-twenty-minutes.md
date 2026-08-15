# FU-20260815-the-demo-shop-runs-every-leg-at-twenty-minutes — Give blue-mantis two departures with real per-leg travel

- **Status:** Open
- **Raised:** 2026-08-15 — building ADR 20260815-per-leg-travel-minutes (per-leg `trip_dives.travel_minutes`).
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/db/seed-trips.ts`, `src/db/seed-more-trips.ts`, `src/db/dive-site-templates.ts`,
  `e2e/visual.spec.ts`, `src/lib/diver-planning.ts`

## What I noticed

A departure can now state how long the boat runs to reach each dive's site — ten minutes out to the
house reef, twenty-five across to the wall — and the diver's "Your dock-day rhythm" list on
`/s/<slug>/trips/<id>` lays the day out from it. **Nothing in the seeded demo shop states one.**
Every `trip_dives` row blue-mantis seeds leaves `travel_minutes` null, so every departure falls back
to the shop's single `boat_ride_minutes` (20) and the demo renders exactly the shape it rendered
before the column existed.

The concrete case: blue-mantis's two-tank departures visit Molasses Reef then French Reef, and the
Spiegel Grove wreck charter runs much further out than either. On the booking page all three read
"Ride out to the site · 20 min", which is the uniform wrongness the whole change was about. A shop
owner clicking through the demo — or a screenshot in a pitch — sees no evidence the product knows a
wall trip is not a house-reef morning.

## Why it isn't already done

Out of the scope I was given, and deliberately so on one count. `src/db/seed.ts` and its
`seed-*.ts` scenarios are the repo's top conflict magnet (ADR 20260803-seed-scenario-modules), and
that change was running concurrently with several other sessions in the same working directory. It
is also a *content* decision — which departures should look far out, and by how many minutes — that
reads better made once, deliberately, against the dive-site catalog's real Florida Keys geography
than bolted onto a schema change.

The behaviour itself is proven end to end without it: `e2e/dock-day-rhythm.spec.ts` creates a
two-tank departure through the real staff form with a ten-minute first leg and a 150-minute second,
and asserts the times a diver reads. This entry is about the *demo*, not about coverage.

## Proposed change

Set `travel_minutes` on the seeded `trip_dives` rows of two or three departures whose sites make the
difference legible, and leave the rest null so the fallback stays visible too:

- the two-tank reef morning (Molasses -> French): a short first leg, a short hop, nothing dramatic;
- the Spiegel Grove charter: a genuinely long run out, so the boarding time and the first dive are
  visibly further apart than the reef trip's;
- ideally one departure where the *second* leg is longer than the shop's 60-minute surface interval,
  since that is the only case that changes the rendered beat (it reads "Ride to the next site"
  instead of "Surface interval") and nothing in the demo exercises it.

Then add — or confirm — a visual capture of a booking page whose day is driven by real legs, so the
difference is baselined rather than only asserted in text.

**Not proposed:** inventing coordinates-derived numbers (ADR 20260815-per-leg-travel-minutes
declines that outright), setting a leg on *every* seeded dive (the null fallback is a state worth
seeing in the demo), or moving `boat_ride_minutes` off the shop.

## Prompt

```text
The seeded demo shop (blue-mantis) leaves `trip_dives.travel_minutes` null on every departure, so
every trip on the demo renders the shop's single 20-minute ride out and the per-leg travel feature
is invisible to anyone clicking through it. Give two or three seeded departures real legs.

Read first:
  - docs/architecture/decisions/20260815-per-leg-travel-minutes.md — what the column means, and
    the rule that makes a leg visible: between two dives the gap is max(surfaceInterval, travel),
    so a leg SHORTER than the shop's 60-minute surface interval changes nothing a diver reads
  - src/lib/diver-planning.ts (dockDayOffsets, LegTravelTimes) and its test
  - src/db/seed.ts's orchestrator, plus src/db/seed-trips.ts and src/db/seed-more-trips.ts, which
    are where the two-tank reef morning and the Spiegel Grove charter are seeded
  - src/db/dive-site-templates.ts — the real Florida Keys sites the catalog publishes, for
    plausible minutes

Do it in the scenario module that already owns those departures — never by wedging rows into
another scenario (ADR 20260803-seed-scenario-modules). Leave at least one seeded departure with no
legs at all, so the fallback to the shop's own figure stays visible in the demo too. Include one
departure whose second leg exceeds the shop's surface interval, since that is the only shape that
changes which beat is rendered, and give it a visual capture in e2e/visual.spec.ts.

Done when `pnpm check` is green, `pnpm e2e:run e2e/dock-day-rhythm.spec.ts --reporter=line` still
passes, and the visual diffs that result are explained in the PR (the demo's booking pages will
move pixels on purpose). Delete
docs/product/follow-ups/FU-20260815-the-demo-shop-runs-every-leg-at-twenty-minutes.md as part of
the change.
```
