# 20261104-arrival-is-a-trail — Read arrival from its trail; the seat status says only what the shop decided

- **Status:** Accepted
- **Date:** 2026-11-04
- **Amends:** [20260907-the-counter-survives-offline](20260907-the-counter-survives-offline.md) decision 1 (the `bookings.status` projection) and its consequence of writing both in one transaction; [20260911-the-confirm-tap-is-the-release](20260911-the-confirm-tap-is-the-release.md) decision 1 (the held set)

## Context

`bookings.status` carried two lifecycles in one column: what the shop decided about the seat
(held, released, cancelled) and where the person had got to (`checked_in`). The second already had
an append-only trail, `booking_arrival_events`, so arrival lived in two places, and every writer
that put a seat back had to copy the trail onto the column (#1838). Issue #2702 (review idea L02-1)
proposed reading arrival from the trail alone; Aaron chose it on 2026-11-02 (decisions 27 to 29).
The invariant it must keep is decision 4 of the counter ADR: an arrival is never aboard.

## Decision

1. **`booking_status` is `booked | cancelled | no_show`.** `checked_in` is dropped; a migration moves
   its rows to `booked`. `seatIsHeld` is `status === "booked"` and `seatHeld` is its SQL;
   `SEAT_HELD_STATUSES` is gone.
2. **Checked in is two records read together**: the seat is `booked` and the newest arrival event is
   `arrived`. `seatCheckedIn` (`src/db/arrival-provenance.ts`) is the SQL, correlated on the seat's
   shop, departure and id; `isCheckedIn` (`src/lib/presence.ts`) is the same rule over values read.
   A released or cancelled seat is never checked in, whatever its trail says.
3. **Only `checkInBooking` and `undoCheckInBooking` write arrival**, and they write only the trail
   (and clear `running_late_at`). Releases, cancels, reclaims and restores touch the seat word and
   leave the sighting standing, so a restored seat reads as checked in again with nothing copied.
4. **Where "booked" used to mean "not yet at the desk", the reader now asks the trail too**: a
   diver's self-cancel, a party cancel, a seat claim, a move, running late, the cancellation notice
   and the reply and Inbox seat pickers each refuse or skip a checked-in seat, as they did before.

## Alternatives considered

- **Keep the column and derive it by trigger** — two places again, now hidden.
- **A `presence` view** — every reader would join it; the correlated predicate is the same query
  without a schema object.

## Consequences

A no-show, cancel, reclaim or restore cannot desynchronise arrival, because there is nothing to
synchronise. Decisions 2 to 7 of the counter ADR stand: the offline queue still reaches only the
two arrival writers, and nothing on that path can write `roll_call_events`. The trail is still
evidence of who was seen, never of who dived.

The previous release, still serving while the migration runs, fails a check-in tapped during the
deploy; the desk taps again. Revisit if a reader needs arrival per departure in bulk and the
correlated subquery shows in the render-cost ratchet: the fix is a lateral join, not a column.
