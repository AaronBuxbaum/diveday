# 20261013-staff-move-a-seat — Move a booked seat by changing its trip, staff-side only

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

[20260821-the-diver-may-release-their-own-seat](20260821-the-diver-may-release-their-own-seat.md)
deleted `rescheduleBooking` and rejected a staff move "until somebody asks". The third UX review
(2026-10-13, item 11) asks: a diver switching to Sunday costs a staffer a remove, a re-seat, a
re-sent waiver and a hand-moved payment, and breaks the diver's links. The move ships staff-side
first.

## Decision

**A staffer moves a seat by changing the booking's `trip_id` in one transaction
(`moveBooking`, `src/db/bookings.ts`); `moveSeat` (`src/db/seat-diver.ts`) is the one consequence
path; the roster row's "Move to another departure" is the one door.**

- **Same row.** Everything keyed on the booking travels: order, payment, waiver, the `/ready` link,
  notes, a package dive (released and re-settled against the new trip), and a help request the
  old crew has not handled yet. Nothing is charged or refunded. A paid seat that lists higher on
  the new departure is said back (`seat-moved-owed`), the way a type change says it; a pending
  checkout at the old price is expired.
- **What was said about the old departure is cleared, never carried.** The conditions briefing
  stamp, the "Anything changed?" answer, a staff pickup time and "running late" are each about the
  old day, so the move nulls them. The briefing matters most: the notice carries the new time and
  meeting point, not the new conditions, so the diver has read nothing about them, and `/ready`
  must show the new conditions as unread. A help request the old crew already handled stays on
  the old departure as its record.
- **Money follows the invoice and the payment, which are keyed by booking.** A completed booking
  checkout keeps the `trip_id` it was bought for: it is the record of what was sold, at that
  departure's price, and is never re-keyed. The one revenue read that joins a checkout by its trip
  (`src/db/report-lines.ts`) uses it only to file the money under Courses or Fun dives, and a move
  never crosses that line (same kind only, below). The window it counts is the completion date,
  not the departure date. Disputes, failed refunds and the paid-after-close queue name the
  departure the charge was quoted for, which is the old one.
- **Measured as a new staff seat.** The target row is locked (both trips in id order, then the
  seat), both capacity limits, the course ratio and a course's card and age gates (on the
  new session's date) are read under the lock, and the trip's certification gate refuses.
- **Same kind only.** A course seat moves to another session of the same course; a dive seat to
  a dive. Never onto or off a rehearsal.
- **Evidence is refused, not rewritten.** A seat that is checked in, absent, at roll call, on a
  buddy team, or leading live party seats stays; each is undone on its own surface first. The old
  departure keeps its activity, desk events, arrival marks and sealed course forms.
- **The diver is told at once** with the existing `trip_rescheduled` notice, worded "we moved your
  seat to…", keyed by `seatMovedAt` because two departures can share a revision. Both trails get
  a line (`seat_moved_away`, `seat_moved_here`) and both crews read the catch-up strip.

## Alternatives considered

- **Cancel and re-book, as `rescheduleBooking` did** — a new booking id strands the order, the
  signed waiver and the diver's links, which is the work the move exists to save.
- **A diver-side picker on `/ready`** — the money still has to move with a paid seat, which the
  2026-08-21 record left to the shop. Staff first; the diver door is a later product call.
- **Rewriting team, roll-call and party rows to follow the seat** — they are evidence about the
  old departure; quietly moving them is the laundering the buddy-team one-way door forbids.

## Consequences

- Reminders key on kind and booking, so a seat moved after its 7-day or 24-hour reminder went out
  does not get that reminder again for the new departure. The reschedule notice carries the new
  time and the `/ready` link; re-keying reminders is a follow-up.
- A party lead cannot move with the party in one tap.
- A report of money by departure would have to read the seat's order or payment, not its
  checkout, to follow a moved seat. None exists today; one that is added reads it that way.
- Revisit if shops ask to move whole parties.
