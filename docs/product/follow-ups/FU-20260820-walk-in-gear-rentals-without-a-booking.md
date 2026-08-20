# FU-20260820-walk-in-gear-rentals-without-a-booking — Decide whether a gear reservation can exist without a booking

- **Status:** Parked
- **Parked:** 2026-08-20 by the product owner, deferred on first triage. Un-parked by a pilot
  shop saying, in a recorded call, that renting gear to somebody who is not on a boat that day is
  ordinary counter work rather than a rarity — the question is how often it really happens, and
  nobody here can answer that. Add it to [the first-call script](../pilot-kit/first-call-script.md)
  if it is not there when you next read this.
- **Raised:** 2026-08-20 — the gear-register build (ADR 20260815-minimal-gear-register, branch claude/dive-ship-gear-system-95gz3s)
- **Kind:** question
- **Effort:** M
- **Touches:** `src/db/schema.ts` (`gear_reservations.booking_id`), `src/db/gear.ts`, `src/app/shop/[shopSlug]/gear/page.tsx`

## What I noticed

`gear_reservations.booking_id` is NOT NULL: every reservation hangs off a booking, per the ADR
("the reservation is a *fulfillment* record" attached to the booking's own billing). Real shops
also rent gear to people who are not on any boat — a shore diver taking a tank and a BCD for the
weekend. Today the register cannot record that at all: the counter person would have to invent a
booking or track the loan on paper, and "who has AL80-04" would have a wrong answer in DiveDay.

## Why it isn't already done

It is a genuine modeling call, not an oversight. Making `booking_id` nullable re-opens questions
the booking spine currently answers for free: who the holder *is* (a `person_id` would have to
move onto the reservation), what window a walk-in rental spans (no trip to derive it from), and
where the money story lives (staff invoices already handle bookingless charges via
`orders.booking_id` nullable, so billing has an answer — but the ADR's fulfillment-not-billing
line deserves to be re-stated deliberately, not eroded by a schema tweak). H-49 makes the
migration itself cheap; the decision is the expensive part.

## Proposed change

Add `person_id` to `gear_reservations`, make `booking_id` nullable with a check that exactly one
holder shape is present (booking, or person + explicit window), and a small "rent to a walk-in"
form on the register page (pick diver, pick dates, pick units). Keep the exclusion constraint
unchanged — it already only cares about the unit and the window. What I am *not* proposing:
per-reservation pricing or payments; walk-in rental money stays a staff invoice
(`order_line_items`, kind `rental`) exactly like today.

## Prompt

```text
Read docs/architecture/decisions/20260815-minimal-gear-register.md (including the 2026-08-20
amendment), src/db/schema.ts's gear_reservations table, and src/db/gear.ts. Decide with the
product owner whether walk-in (bookingless) gear rentals belong in the register. If yes: add
person_id, relax booking_id to nullable with a one-holder check constraint, extend
reserveGearUnit and the register UI with a walk-in rental form (diver picker + explicit date
window), keep the gear_reservations_no_overlap exclusion constraint untouched, add db tests for
the new holder shape plus tenant isolation, and update the ADR and glossary. Done means pnpm
check is green and pnpm e2e e2e/gear.spec.ts passes. Delete
docs/product/follow-ups/FU-20260820-walk-in-gear-rentals-without-a-booking.md as part of the
change.
```
