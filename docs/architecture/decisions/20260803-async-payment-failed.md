# 20260803-async-payment-failed — Release a failed delayed-notification payment as an expired checkout, with a timestamp saying why

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

Stripe's delayed-notification payment methods (bank debits and similar) settle after the hosted
session closes. The session emits `checkout.session.completed` with `payment_status: "unpaid"` —
which this app deliberately settles nothing on
([20260721-checkout-at-booking](20260721-checkout-at-booking.md)) — and then, days later, either
`checkout.session.async_payment_succeeded` or `checkout.session.async_payment_failed`.

Only the success half was handled. The failure fell through to `unhandled_event_type`, so the
`booking_checkouts` row stayed `pending` **forever**: the abandoned-checkout recovery scan kept
offering the diver a link that could never be paid, and the seat kept reading "awaiting payment"
with nothing left to await. That is finding **PAY-L1**, "permanent pending desync".

## Decision

**`checkout.session.async_payment_failed` moves a `pending` checkout to `expired` and stamps
`async_payment_failed_at`; `booking_payments` is not touched.**

- `markCheckoutPaymentFailedBySessionId` matches only a `pending` row of the expected connected
  account, the same shape and the same defense-in-depth account cross-check
  `markCheckoutExpiredBySessionId` already uses. A redelivery, a failure racing a completion, or a
  failure arriving after a local disqualification all match nothing and return null — the route
  then answers a quiet 200, because a non-2xx would make Stripe retry a genuinely-handled event
  forever.
- `expired` is the **existing terminal for "this local checkout is no longer payable"**, and every
  consequence of it is already the right one: recovery emails stop (`dueCheckoutRecovery`), and a
  later completion cannot resurrect it (`markCheckoutPaidBySessionId`'s disqualification check,
  which then refuses to attribute a stale price to whatever the booking is now).
- `async_payment_failed_at` is what keeps the two causes apart — a session that simply timed out
  unpaid, versus one whose payment was attempted and bounced. Null means only "no failure was
  reported", never "the payment succeeded".
- **`booking_payments` is deliberately untouched.** An async payment that never settled wrote no
  payment row in the first place, so there is nothing to release; and writing `unpaid` is the one
  thing that *could* regress a booking a human had since marked paid or waived. The invariant that
  a booking's payment status only ever advances forward is preserved by not writing at all, not by
  a new guard.
- The handler falls back to `markTipExpiredBySessionId` on the shared session-id space, exactly as
  the completion and expiry handlers do ([20260726-post-trip-tipping](20260726-post-trip-tipping.md)).

## Alternatives considered

- **Add a `payment_failed` value to the `checkout_status` enum** — the most truthful modelling, and
  rejected on blast radius: every consumer of that enum (including the hand-written union in
  `src/lib/checkout-recovery.ts`) would have to learn a value whose behaviour is identical to
  `expired` in all of them. A nullable timestamp says the same thing additively.
- **Write `unpaid` onto the covered bookings** — the only path by which this event could regress a
  seat a human had already marked paid or waived, in exchange for recording a state that is already
  the meaning of an absent row.
- **Leave it unhandled and let the recovery scan's Stripe reconciliation notice** — the scan does
  reconcile before nudging, but only for sessions it considers due; a failed async payment on an
  already-nudged checkout would still sit `pending` indefinitely, and the diver would still have
  been sent a dead link at least once.
- **Cancel the covered bookings** — releasing seats on a failed payment is
  [HD-15](../../product/human-decisions.md)'s question (abandoned checkout = seats held forever),
  not this handler's.

## Consequences

Makes easy: the pending-forever state is gone, and the reason a checkout died is recoverable
without asking Stripe. The handler is a single conditional `UPDATE`, so it is idempotent by the
same mechanism its siblings are rather than by a new one.

Makes harder: a reader of `booking_checkouts.status` alone cannot tell a timed-out session from a
failed payment; they have to look at the timestamp. That is the deliberate trade above.

### What this deliberately did not do

- **It does not notify the diver.** A shop finds out through the checkout row and the webhook log.
  Telling a diver "your bank payment failed, here is a fresh link" is a product slice with its own
  copy, locale and cadence questions, and re-offering payment for a seat is entangled with HD-15.
- **It does not release the seat.** The bookings stay exactly as they were — unpaid and held.
- **It does not add a `checkout_status` value**, so no existing surface changes and no visual
  baseline moves.
- **It does not append to `booking_payment_events`.** Nothing about the booking's payment state
  transitioned ([20260803-booking-payment-events](20260803-booking-payment-events.md) records
  transitions, not provider events).
- **It does not handle `invoice.payment_failed`** — the invoice-side sibling. An order stays `open`
  there, which is already a correct and non-stuck state, unlike a `pending` checkout.

### Escape hatch

If a shop ever needs to distinguish the two states in the UI, or if a retry flow arrives, the
`payment_failed` enum value can still be added later: `async_payment_failed_at` already marks
exactly the rows that would be backfilled to it.
