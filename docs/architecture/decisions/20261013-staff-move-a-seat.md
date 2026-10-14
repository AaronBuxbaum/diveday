# 20261013-staff-move-a-seat — Move a booked seat by changing its trip, staff-side only

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

[20260821-the-diver-may-release-their-own-seat](20260821-the-diver-may-release-their-own-seat.md)
deleted `rescheduleBooking` and rejected a staff move "until somebody asks". The third UX review
(item 11) asks: switching a diver to Sunday costs a remove, a re-seat, a re-sent waiver and a
hand-moved payment, and breaks the diver's links.

## Decision

**A staffer moves a seat by changing the booking's `trip_id` in one transaction
(`moveBooking`, `src/db/bookings.ts`); `moveSeat` (`src/db/seat-diver.ts`) is the one consequence
path; the roster row's "Move to another departure" is the one door.**

- **Same row.** What is keyed on the booking travels: order, payment, waiver, `/ready` link,
  notes, a package dive (re-settled), an unhandled help request. Nothing is charged or refunded;
  a higher price is said back as owed (`seat-moved-owed`); a pending checkout is expired.
- **What was said about the old day is cleared.** Conditions briefing, the "Anything changed?"
  answer, pickup time and running late are nulled. The notice carries the new time and meeting
  point, not the new conditions, so `/ready` must show them unread. A handled help request stays.
- **Money follows the invoice and payment, keyed by booking.** A completed checkout keeps the
  `trip_id` it was bought for, as the record of what was sold. The one revenue read joining a
  checkout by trip (`src/db/report-lines.ts`) only files it under Courses or Fun dives, which a
  move cannot change, and counts by completion date.
- **Measured as a new staff seat**, under the target's lock (both trips in id order, then the
  seat): both capacity limits, the course's instructor, ratio, card and age on the new date, and
  the certification gate.
- **Same kind only.** Course seat to a session of the same course, dive to dive, never a rehearsal.
- **Evidence is refused, not rewritten.** A seat checked in, absent, at roll call, on a buddy team
  or leading a party stays; the old departure keeps its activity, desk events and course forms.
- **The diver is told at once** by `trip_rescheduled`, worded for a seat and keyed by
  `seatMovedAt`. Both trails get a line and both crews read the catch-up strip.

## Alternatives considered

- **Cancel and re-book** — a new booking id strands the order, the waiver and the diver's links.
- **A diver-side picker on `/ready`** — money must move with a paid seat; a later product call.
- **Moving team, roll-call and party rows with the seat** — evidence about the old departure.
- **Re-keying a completed checkout** — it would misstate what was sold at which price.

## Consequences

- A seat moved after a reminder went out does not get it again; re-keying reminders is a follow-up.
- A report of money by departure would read the seat's order or payment, not its checkout.
- A party moves one seat at a time; revisit if shops ask.
