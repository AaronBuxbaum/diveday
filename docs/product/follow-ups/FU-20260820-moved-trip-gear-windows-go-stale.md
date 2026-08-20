# FU-20260820-moved-trip-gear-windows-go-stale — Re-derive gear reservation windows when a departure moves

- **Status:** Open
- **Raised:** 2026-08-20 — noticed while wiring trip-level cancellations to release unclaimed gear (PR #574 review round)
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/db/trips-schedule.ts` (`moveTrip`), `src/db/gear.ts`, `src/lib/gear.ts` (`tripReservationWindow`)

## What I noticed

A gear reservation's `reserved_from`/`reserved_until` window is derived from the trip's dates at
assign time (`tripReservationWindow`, shop-local days). When staff later move that departure to a
different day (`moveTrip` on the schedule board), the reservations keep their original window: the
unit still reads busy on the *old* days in `listAvailableGearUnits` and reads free on the day the
trip actually sails — so a second trip on the old day is refused a unit that will be on the wall,
and a same-day trip on the new date can double-claim one that won't be. Cancellation is now
handled (unclaimed reservations release inside every cancel transaction); a *move* is the
remaining way trip dates and reservation windows drift apart.

## Why it isn't already done

Re-windowing on move is not a one-line update: shifting an unclaimed reservation onto the new
dates can collide with another reservation of the same unit (the `gear_reservations_no_overlap`
exclusion constraint refuses it, correctly), and the right behavior on collision is a product
call — silently release the loser? keep it and tell someone? Today's overdue/due-back rows are
window-driven, so whichever answer is chosen shows up there too. That decision deserved more than
a drive-by inside a review-fix push.

## Proposed change

In `moveTrip`'s transaction: re-derive the window for the trip's *unclaimed* reservations
(checked-out ones describe a physical handover that already happened — leave them). Attempt the
update per reservation; on an exclusion-constraint refusal, release that reservation and surface
the count in the move outcome so the board can say "2 gear assignments released — reassign on
prep". Unit tests for the shifted window, the collision-release path, and the checked-out
exemption.

## Prompt

```text
Read src/db/trips-schedule.ts (moveTrip), src/lib/gear.ts (tripReservationWindow), and
src/db/gear.ts (reserveGearUnit's 23P01 handling, releaseUnclaimedGearReservationsForTrips).
Inside moveTrip's transaction, re-derive reserved_from/reserved_until for the moved trip's
unclaimed gear reservations from the new trip dates (leave checked-out ones untouched); on an
exclusion-constraint collision (violatesExclusionConstraint, "gear_reservations_no_overlap"),
release the colliding reservation and count it; extend moveTrip's return shape so the schedule
board's notice can report released assignments, wiring the words through
src/i18n/locales/*/staff/*.json in both locales. Unit tests in src/db/gear.test.ts or
trips-schedule tests for: window follows the move, collision releases the loser and reports it,
checked-out reservations keep their window. Done means pnpm check green. Delete
docs/product/follow-ups/FU-20260820-moved-trip-gear-windows-go-stale.md as part of the change.
```
