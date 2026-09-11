# 20260911-the-confirm-tap-is-the-release — A no-show frees the seat on the confirm tap, with no second act

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

`bookings.status` has carried a `no_show` value since the first schema, and a dozen readers branched
on it — `ready.ts`, `recap.ts`, `tips.ts`, `closeout.ts` — every one of them dead, because nothing
in the product ever wrote one. Issue #1209 built the first writer: the counter's "Not here?"
disclosure, which records that a booked diver did not come.

Writing that status is the small half. The question the slice actually had to answer is what happens
to the seat, and it is the kind of question that is cheap to decide now and expensive to decide
later, because it fixes what *counting a full boat* means everywhere in the product. The shape a
shop's day takes hangs off it: a shop that releases nothing is doing the reseller's arithmetic on
paper at the desk, and a shop that releases on a timer is selling seats to divers whose flight
landed late.

Two constraints bounded it. The salvage panel beside the mark offers the freed seat to the **wait
list**, so a release the product cannot honour turns that invite into a promise that dead-ends at
`trip_full` the moment somebody accepts it. And the crew's roll call is the stronger statement about
where a person is: whatever the desk decides about the seat, a body at the rail must never be
refused.

## Decision

**The staffer's confirm tap is the release.** There is no second tap, no timer, no close-of-day
sweep, and no `seat_released_at` column.

1. **The seat boundary is a status set, named once.** `SEAT_HELD_STATUSES` (`src/lib/no-show.ts`) is
   `booked` and `checked_in`; `seatHeld` (`src/db/trips-queries.ts`) is its single spelling as a
   `where` clause. `cancelled` never held a seat and `no_show` no longer does, so the boat reads one
   seat lighter the instant the mark commits and the next diver claims it through `bookSpot`'s
   ordinary capacity transaction. No new write path, no reservation, no hold.

2. **Only the seat *counts* take the predicate.** The roster, the manifest, the gear register and
   the buddy builder still read every non-cancelled booking, and must: a diver the desk wrote off is
   still a name the crew has to account for at roll call. The manifest marks that row instead of
   dropping it (`notHere`, `src/lib/manifests.ts`), because a released seat that renders like a
   diver still walking down the dock sends a crew member chasing a name the desk settled forty
   minutes ago.

3. **Releasing is the desk's act, and only the desk's.** The mark is gated (`noShowGate`) and
   confirmed once; a `not_boarded` or `cleared` tap at the rail releases nothing, because a mis-tap
   at the boat must never sell a diver's seat out from under them. In the other direction the rail
   overrules: boarding a diver the desk released takes the seat straight back
   (`reclaimReleasedSeat`, `src/db/manifests.ts`) rather than refusing a body somebody is looking
   at, and carrying more people than seats is then something the manifest *says*
   (`summary.overCapacity`) rather than something it prevents.

4. **Undo is a re-count, not a status flip.** By the time somebody taps it the seat may be sold, so
   `undoBookingNoShow` re-counts under the departure's own `FOR UPDATE` against both limits every
   seat-granting path applies — the boat's capacity and a ratio-gated session's crew cap — and
   refuses with its own trail line naming which one, rather than overfilling the boat.

## Alternatives considered

- **A `seat_released_at` column and a second "release the seat" tap.** Honest about the two
  decisions being separable, and rejected because the wait-list invite sitting beside the mark
  becomes a promise the product cannot keep: the diver who accepts it arrives at `trip_full`. It
  also asks a staffer with somebody at the desk to perform a second act whose only effect is
  bookkeeping.
- **Release on a timer, some minutes after departure.** Rejected because nothing about elapsed time
  is evidence that a person did not come, and a clock cannot be argued with at a desk. The product
  already refuses to read an hour of elapsed time as "this diver dived"; reading it as the opposite
  is the same mistake.
- **A close-of-day sweep that marks the day's absentees.** Rejected, and worth naming because the
  tree briefly reasoned as though one existed: two dive-day readers let a standing desk sighting
  outrank a `no_show` to keep such a sweep from erasing a 06:40 check-in. With one human writer
  there is no sweep, the mark is always the later statement, and the escape only ever let 06:40 beat
  07:15.
- **Cancel the booking instead of marking it.** Rejected outright: a cancellation is the diver's
  statement that they are not coming, a no-show is the shop's that they did not. Collapsing them
  loses the difference between a courtesy and an accusation, and moves money nobody decided to move.

## Consequences

- **Capacity has one definition, and a missed call site is now a visible bug.** Before this, a count
  could spell `ne(status, "cancelled")` and be right. It is now wrong in a way a shop sees: "Full"
  over a seat that is free, or an oversell. A handful of counts stay deliberately looser and treat a
  released seat as still held — crew sizing, the minimum-decision sweep, blow-out candidates — each
  conservative in the direction its own question needs; `seatHeld`'s docblock names them.
- **The mark moves no money, and that is load-bearing.** A diver who missed a boat may be owed a
  refund, may owe the fare, or may be a regular the owner waves through. The counter says the seat
  is free; the money stays a human decision on the order.
- **The escape hatch.** Revisiting means a shop reporting that seats are being released and resold
  under divers who were merely late — which the boundary already answers by opening the door at
  departure rather than the dock call, and by keeping Undo. Reversing would cost a column, a second
  surface act, and an audit of every `seatHeld` call site to decide which of them the column
  governs; the wait-list invite would need a hold of its own before it could stay honest.
