# 20260812-configurable-dock-day-rhythm — A shop's dive day is six configured minute amounts, never inferred from the trip window

- **Status:** Accepted — amended 2026-08-15 by
  [20260815-per-leg-travel-minutes](20260815-per-leg-travel-minutes.md)
- **Date:** 2026-08-12

**Amendment (2026-08-15).** Everything below stands — the six columns, the two kinds of number, the
`0`-takes-the-beat-out rule, the arrival clamp and the published-return invariant. One reading has
changed: `boat_ride_minutes` is now the shop's *usual* run and the **fallback** for any leg a
departure has not stated its own minutes for. A departure's legs live on `trip_dives.travel_minutes`
— per leg, because a two-tank day is dock -> A -> B -> dock and A->B is not B->A. That is the
"let each trip override the rhythm" alternative below, taken in the one shape that is not wrong:
per leg rather than per trip.

## Context

Every booking page prints a "Your dock-day rhythm" list — the shape of the day a diver just bought
a seat on. Until now the whole list came out of one number, `shops.dock_call_minutes`:

- `arrive` at the arrival call;
- `briefing` at `min(15, dockCall / 2)` before departure — a formula, not a fact about the shop;
- `boatRide` at **one third** of the trip's own `startsAt`→`endsAt` window;
- `surfaceInterval` at **two thirds** of that same window;
- `return` at `endsAt`.

The two beats on the water were literally arithmetic on the window's length. They moved when a
shop changed its return time and never moved when it changed anything true about its day. Three
consequences, all of them things a shop cannot correct:

- **A one-tank trip printed a surface interval.** The list has no idea how many dives a departure
  plans, so a check-out dive and a three-tank charter got the same two beats.
- **A shop that doesn't brief at the dock read DiveDay promising one.** Plenty brief on the boat;
  plenty have divers kit up on board rather than on the pier; a shore-entry shop has no boat ride
  at all. None of that was expressible. The packing list compounded it by listing "Crew briefing"
  under *Provided* unconditionally.
- **The distance to the site had no effect on anything.** A 10-minute run and a 90-minute run to a
  wall produced identical timelines whenever the two trips happened to be the same length.

The Settings row that existed named itself after the arrival call and showed a three-beat preview,
which was honest about the one number it owned and silent about the four it didn't.

## Decision

**The rhythm is six integer columns on `shops`, and nothing about it is inferred.**

| Column | Kind | `0` means |
| --- | --- | --- |
| `dock_call_minutes` | minutes **before** departure | — (floors at 5) |
| `gear_setup_minutes` | minutes **before** departure | divers kit up on board |
| `briefing_minutes` | minutes **before** departure | the shop briefs on the boat |
| `boat_ride_minutes` | **duration** after departure | a shore entry |
| `bottom_time_minutes` | **duration**, per dive | — (floors above 0: a dive trip has dives) |
| `surface_interval_minutes` | **duration**, between dives | back-to-back |

Two kinds of number, and the split is the model. Before departure a beat is *how far ahead of the
lines coming off* it happens, so it composes against the arrival call. After departure a beat is a
*duration*, and the day is laid end to end from them — ride out, dive, surface interval, dive — for
as many dives as **that departure** plans (`trips.planned_dives`), which is what finally makes a
one-tank trip render a one-tank day.

**`0` takes a beat out of the day rather than putting it at the departure.** That single rule is
how a shop says "we don't do that one", and it is why four of the six floor at zero.

Three invariants carry the model:

- **Nothing lands before the arrival call.** Beats before departure clamp to `dockCallMinutes`. A
  briefing that starts before the diver was asked to be there is a briefing they were set up to
  miss — the old formula existed to guarantee this, and the guarantee outlives it.
- **The published return time wins.** A shop whose stated dives don't fit the window they sold has
  a scheduling problem; printing "Dive 3 · 5:40 PM" under a trip that returns at 5:00 PM would make
  the page argue with itself in front of the diver. The water half is truncated at the first beat
  that doesn't fit — and the tail is then walked back past any trailing ride-out or surface
  interval, because both only mean something because of the dive that follows them.
- **One shape, two readers.** `dockDayOffsets` describes the day with no departure attached;
  `dockDayTimeline` maps it onto one trip's clock, and Settings renders it as-is beside the fields
  that produce it. A shop reading "Briefing · 15 min before" is reading the arithmetic their divers
  will read, not a second implementation of it.

**Saved as one record, never a field at a time.** `parseDockDayRhythm` refuses the whole submission
if any field is not a whole number inside its own bounds, and `DOCK_DAY_LIMITS` is the single table
the form's `min`/`max`, the server action's refusal, and the columns' CHECK constraints all read
from.

## Alternatives considered

- **Keep deriving, but from better inputs.** Feed the existing formula `planned_dives` and the site
  distance and leave the shop out of it. Rejected: it fixes the one-tank case and none of the
  others. A shop that briefs on the boat still cannot say so, and every improvement to the formula
  is another guess DiveDay makes on a shop's behalf about a day it has never seen.
- **One JSONB `dock_day_rhythm` column instead of six integers.** Fewer migrations for a future
  seventh beat. Rejected: the values are six independent bounded integers, which is exactly what
  CHECK constraints are for — in JSONB the floor on bottom time and the non-negativity of the rest
  become application-only rules, and the one place they are most likely to be violated is a data
  import or a hand-written fix, neither of which goes through the application.
- **Let each *trip* override the rhythm.** A house-reef morning and a wall trip genuinely differ.
  Rejected for now as the wrong first step: it multiplies the fields a shop maintains by every
  departure they run, to solve a problem nobody has reported, before anyone has used the shop-level
  one. A departure that truly differs already states the two facts that matter most — its own
  departure and return times, and its own dive count — and those are inputs here. Left as a
  follow-up rather than designed around. **Taken up 2026-08-15**, for the one beat that genuinely
  varies per departure and in the one shape that is not wrong: per *leg* on `trip_dives`, never a
  per-trip copy of these columns — see
  [20260815-per-leg-travel-minutes](20260815-per-leg-travel-minutes.md).
- **Absolute times per beat rather than offsets and durations.** Rejected because a rhythm has to
  compose with *every* departure a shop runs, including the 7:00 AM and the 1:30 PM; a beat pinned
  to a wall-clock time is a rhythm for one trip.

## Consequences

- The defaults (30 / 0 / 15 / 20 / 45 / 60) put every existing shop as close to the old derived
  timeline as fixed numbers can: 30 with a 15-minute briefing is exactly what
  `min(15, dockCall / 2)` produced at the default call, and there was never a set-up beat. A shop
  that had set a *short* call — say 10 minutes — read a 5-minute briefing before and reads one
  clamped to 10 now. That is a change, and it is the more truthful of the two.
- `briefingLeadMinutes` and `dockDayRhythmPreview(dockCallMinutes)` are gone;
  `setShopDockCallMinutes` is replaced by `setShopDockDayRhythm`, which takes all six.
- `packingConfidence` now takes whether the shop briefs, so *Provided* stops promising a briefing
  three inches under a rhythm that no longer contains one.
- The migration is additive — five `ADD COLUMN … DEFAULT … NOT NULL` plus five CHECKs, no
  destructive statement, so it applies under the previous release exactly as
  [20260806-destructive-migration-guard](20260806-destructive-migration-guard.md) requires.
- **Still not a dive plan.** These numbers describe the *shape of a day* for a diver deciding when
  to leave the house. Nothing here is used for gas planning, no-decompression limits, or any
  computation a diver's safety depends on — bottom time here is a shop's usual planned figure, and
  the crew's actual plan is briefed in the water's own presence, as it always was.
