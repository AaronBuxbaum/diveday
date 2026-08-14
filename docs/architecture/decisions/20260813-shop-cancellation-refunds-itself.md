# 20260813-shop-cancellation-refunds-itself — When the shop cancels a departure, the money goes back by itself

- **Status:** Accepted
- **Date:** 2026-08-13
- **Amends:** [20260804-blowout-cascade](20260804-blowout-cascade.md)'s "No money moves" bullet and
  its "auto-refund" alternative, and
  [20260813-minimum-head-count-departures](20260813-minimum-head-count-departures.md)'s deferral of
  automatic refunds. Both withdrew from the money question for the same stated reason — the existing
  refund arithmetic is wrong for a shop-called cancel — and both were right about the arithmetic and
  wrong about the conclusion. Everything else in those records stands.

## Context

DiveDay automated the refund for the cancellation the **diver** causes and automated nothing for the
two it causes itself.

A diver who cancels inside the shop's stated window gets their money back without a human touching
it (`refundBookingOnCancellation`, ADR 20260721-automated-cancellation-refund). Both shop-side paths
stopped short:

**The weather blow-out.** `callTripBlowout` cancelled the departure, snapshotted every active
booking, mailed each diver — and said in its own docblock, "No money moves here." The diver read a
message telling them their money was safe, and it stayed on the shop's Stripe account until someone
with the H-14 refund role opened each booking by hand.

**The below-minimum sweep, which is worse, because nobody is in the room.** The minimum-head-count
feature publishes a promise on the booking page — "runs with at least 4 divers; if it hasn't got
there by Thu 14 Aug, 7:30 AM, the shop cancels it and emails everyone booked" — and keeps it with an
hourly cron. That module touched payments nowhere at all. A diver who paid a full fare at 11 PM for
a Saturday charter could have it cancelled by a machine at 4 AM, get an email saying so, and be
holding a captured Stripe charge with no refund, no timeline, and nothing telling them what happens
next until a human noticed on Monday.

The published promise is what made it sharp. The shop advertised a decision moment, DiveDay enforced
it automatically, and the half of the promise that involved giving money back was the half left
manual.

## Decision

**Both shop-caused cancellation paths refund the captured fare automatically, and the stated
cancellation window is bypassed rather than reused.**

- `refundBookingOnShopCancellation` (`src/db/refunds.ts`) is a second arm beside the diver-cancel
  one: same Stripe call, same connected-account rule, same durable payment-operation intent and
  idempotency key — and **no** `refundOnCancellation` window arithmetic and no `no_policy`
  short-circuit, because neither concept is about a trip the shop took away. A window is a rule
  about a diver changing their mind. The full capture goes back.
- `callTripBlowout` refunds inside each claimed cascade row, before composing that diver's message.
  The claim (`pending` → `sending`) is what already made the send once-per-diver, so it makes the
  refund once-per-diver too; and a booking that already reads `refunded` comes back as
  `already_refunded`, so a resumed cascade never reverses twice. That outcome is deliberately
  distinct from `unpaid`: the message a resume composes is picked from it, and reading an
  already-reversed capture as "nothing was captured" would tell a diver who paid and was refunded
  that they were never charged.
- The minimum-seats cron refunds **every active seat** on each swept departure
  (`refundBookingsForShopCancelledTrip`), not just the seats it can email. A walk-in with no address
  is unreachable and has just as much money with the shop.
- **The messages say what happened.** `paymentStory` gains `refunded` and `refund_owed`; the
  blow-out mail stops saying "your payment is safe, the shop will be in touch" when the money is
  already on its way back, and the minimum-not-met mail gains a money line where it had none.
- **Degradation is unchanged and is stated to the diver.** A counter/cash payment, a disconnected
  account, or a Stripe failure returns `manual`/`failed`, leaves the payment row `paid`, and reads
  to the diver as "you're owed a full refund, and the shop will be in touch." What must never happen
  is silence.
- The ledger says which kind of cancellation it was: `payment_event_operation` gains
  `shop_cancellation_refund` beside `cancellation_refund`.

**H-14 is untouched.** The refund role gates a *staff member* issuing a refund. These two callers are
the system honouring a cancellation the shop already made — the same standing on which the
diver-cancel arm already moves money without a role check. Whoever is on the dock at 6 AM still
cannot refund a booking by hand without the role.

## Alternatives considered

**Reuse `refundOnCancellation`'s arithmetic.** Rejected for the reason both amended ADRs gave: it
answers "may this *diver* cancel free?", so a departure cancelled by the shop past its own window
would forfeit the fare. That is the wrong answer, and it is what kept these paths manual.

**Refund only the automated sweep, leaving the staff-called blow-out manual.** Tempting, because a
shop that blows out a Saturday often wants to talk about next weekend before handing the money back
— a refund ends the conversation, a rebooking continues it. Rejected: the cascade already offers
each diver up to three alternatives they qualify for, so the conversation happens in the same
message, and "we'll refund you when we get to it" is precisely the experience DiveDay positions
itself against. A shop that would rather give credit can still offer it after the diver is whole.

**Keep both manual and fix only the copy** — stop implying the refund is handled, and give staff a
queue. Honest, cheap, and still leaves a diver holding a captured charge for a service the shop
cancelled, which is a consumer-protection question in most jurisdictions rather than a preference.

## Consequences

- Money now moves on two paths that previously moved none, one of them a cron with no human in the
  loop. That is the point, and it is also the risk: the blast radius of a bug here is a shop's
  bank balance. Both arms are covered by unit tests that assert the no-double-refund property
  directly, and the Stripe call is idempotency-keyed off a durable intent row as before.
- A shop that wants to hold money against a rebooking can no longer do so by default. It offers
  credit after the refund instead.
- `trip_minimum_not_met` gains an optional `paymentStory`, and `trip_blowout`'s enum gains two
  values; `paid`/`deposit` stay parseable so a message queued before this change still sends on
  retry.
- One additive migration: `ALTER TYPE payment_event_operation ADD VALUE 'shop_cancellation_refund'`.
- The swept-departure path has no staff surface listing money it could not return — the blow-out has
  one, the sweep does not. Filed as `FU-20260813-owed-refunds-have-no-staff-queue`.
