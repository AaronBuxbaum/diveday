# 20260721-automated-cancellation-refund — Automated refund inside the cancellation window

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

[The deposit and declarative cancellation-window slice](20260721-deposit-cancellation-policy.md)
shipped `trips.cancellation_window_hours` as a *shown* cue and deliberately kept refunds
staff-initiated, naming the automated version as the "highest-value" follow-up but deferring it
because it moves real money on a finance- and safety-adjacent path. H-07's owner has now chosen to
automate it. This ADR ships that mechanism with the same conservative, fail-safe posture: money only
moves through the shop's own connected account, only when the shop's stated window still holds, and
only for a payment we can actually reverse — everything else degrades to the staff-run refund the
declarative window already supported.

## Decision

- **The refund rule is one framework-free function.** `refundOnCancellation(trip, paidCents, now)`
  (`src/lib/deposits.ts`) returns `{ refundCents, outcome }`. It is gated on a *stated* window: with
  none it returns `no_policy` and declines to move money (pre-automation behavior). Inside the
  window it returns the full amount paid; past the deadline the seat is `forfeit`. It never returns
  more than was paid and clamps a non-positive amount to zero. One rule, one test surface.
- **The money path is the checkout provider, extended.** `CheckoutProvider.refundCheckoutSession`
  (`src/lib/payments/checkout.ts`) expands the session's payment intent and reverses it on the shop's
  connected account — fetch-based, no SDK, the same shape as `invoicing.ts` `refundInvoice`. It
  degrades to `not_configured` with no Stripe key and reports `not_refundable` when a session never
  captured a payment.
- **The orchestration fails safe.** `refundBookingOnCancellation` (`src/db/refunds.ts`) is tenant-
  scoped and only ever flips a booking's payment row to `refunded` *after* Stripe confirms the
  reversal. A counter/cash payment (`provider !== "stripe"`), a disconnected account, or a Stripe
  failure returns `manual`/`failed` and leaves the payment untouched, so a "refunded" status never
  outruns an actual reversal. Cancellation frees the seat first, so a refund failure can never block
  the cancellation itself.
- **Staff see the outcome.** The staff "remove booking" action calls the refund after cancelling and
  the trip notice banner reports which happened — refunded, forfeit (past window), or a
  refund-owed-issue-by-hand call to action — so a manual case is never silent.

## Alternatives considered

- **Keep refunds fully manual** — the shipped bridge, but the competitive analysis flags automated
  refunds as table stakes and the owner has chosen to close the gap. The manual path survives intact
  as the degrade target for every non-automatable case.
- **A standalone refund provider module** rather than extending `CheckoutProvider` — cleaner in
  isolation, but the refund needs the very session the checkout provider created, and colocating the
  reverse beside the charge keeps one place to reason about a booking's money.
- **Auto-refund manual/counter payments too** — impossible to do safely from code (no captured
  intent to reverse), so those correctly route to staff with an explicit notice instead of a
  pretend-refunded status.

## Consequences

- A cancel inside a shop's stated window now returns the diver's money automatically through the
  shop's own account, with no staff step — the highest-value half of H-07's money automation.
- The feature is off until a shop both connects Stripe and states a window; with either absent it is
  exactly today's staff-run refund, so nothing changes for shops that have not opted in.
- Money only moves on confirmed Stripe reversals; every ambiguous or non-Stripe case is surfaced to
  staff rather than silently mutated, keeping the finance path boring and auditable.
