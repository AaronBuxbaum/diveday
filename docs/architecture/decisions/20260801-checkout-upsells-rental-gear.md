# 20260801-checkout-upsells-rental-gear — Move rental-gear selection ahead of the first checkout

- **Status:** Accepted
- **Date:** 2026-08-01

## Context

[future-features.md, now merged into roadmap.md](../../product/features/roadmap.md#not-scheduled--candidate-subsystems)
flagged this as the highest-leverage of the three deferred revenue-layer candidates, gated on a
shape decision between two payment models, and required an ADR before scheduling. The pricing math
already ships (`RentalPricing` / `quoteRentalFit`, `src/lib/rentals.ts`) and is shop-configured; what
is missing is *ordering*. Today `bookSpot` sends the diver to Stripe Checkout
([20260721-checkout-at-booking](20260721-checkout-at-booking.md)) before `RentalFitForm` ever
renders — gear selection only exists post-booking, on `BookingConfirmation.tsx` and
`/ready/[token]`. `src/lib/payments/checkout.ts` also builds exactly one hardcoded Stripe line item
(`line_items[0]`), so a multi-item cart is a shape change to the checkout request, independent of
which ordering is chosen.

## Decision

- **Gear selection moves into the booking form, before the first Stripe Checkout session is
  created.** One combined payment covers the trip fee and any priced gear, instead of a second
  post-booking payment with its own refund path. This is the flow every public diver walks, so it
  is gated on `hasAnyRentalPricing(shop.rentalPricing)`: a shop that has priced no rental gear online
  shows no gear step at all and sees zero change to today's flow.
- **The step is skippable and defaults follow `RentableItem.defaultRented`** exactly as
  `RentalFitForm` already defaults today — a diver who ignores it still books, at the shop's default
  kit.
- **`CreateCheckoutSessionRequest` moves from one hardcoded line to a `lineItems` array.**
  `startBookingCheckout` composes: one line item for the trip fee (unchanged `checkoutCharge` logic —
  deposit or full fare, quantity = party size when every diver pays the same amount) plus one
  additional line item per diver whose chosen gear has a nonzero priced subtotal
  (`quoteRentalFit(...).subtotalCents`), described per-diver so the Stripe receipt is legible for a
  party. `tips.ts`, the interface's only other caller, wraps its existing single line in a one-item
  array — mechanical, no behavior change.
- **Gear is always charged in full; the trip's deposit policy never applies to it.** A deposit
  discounts only the trip-fee line; gear a diver actually chose to rent is billed at its full quoted
  price in the same checkout.
- **Unpriced gear stays out of checkout**, exactly as `quoteRentalFit` already models: an item the
  shop hasn't priced online is never added to a line item, surfaced instead as "settled at the shop"
  the same way the post-booking form already reports `unpricedKinds`.
- **The rental fit itself is saved through the existing `saveRentalFit` path** (`src/db/rental-fit.ts`),
  now called at booking time instead of only post-booking; the post-booking form still exists for a
  diver who skipped the step or wants to change their mind later.
- **Each diver's quoted gear subtotal is snapshotted onto their `booking_checkout_bookings` row**
  (new `gear_cents` column, defaulting to 0) alongside the existing checkout total, so a later refund
  or reporting view can attribute the paid amount back to trip-fee vs. gear per diver rather than only
  reading the checkout's single `total_cents`.
- **Refunds stay whole-payment-intent, as today.** An automated cancellation refund or a staff-run
  refund reverses the checkout's Stripe payment intent (or a staff-specified partial amount); there is
  no separate gear-only refund path in this slice. Cancelling a paid seat inside the shop's
  cancellation window refunds the trip fee *and* the gear the diver paid for together — a diver who
  isn't diving doesn't keep gear charged to them by default.
- **Party bookings select gear per diver**, reusing the same per-index party fields
  (`fullName-${index}`, `email-${index}`) `bookSpot` already threads for up to six divers.

## Alternatives considered

- **Second post-booking payment for extras** (the other shape future-features.md posed) — keeps
  today's booking flow untouched and is a smaller diff, but means two Stripe payments and two refund
  paths per trip, and asking after the sale converts worse than an in-flow upsell — the entire
  commercial point of "checkout upsells." Rejected.
- **Per-item deposits / partial gear refunds in this slice** — real dive shops may eventually want to
  refund a cancelled trip fee while keeping a no-show's rental fee, but that needs the `gear_cents`
  split this ADR already adds plus new refund-decision logic in `src/lib/deposits.ts`. Deferred: ship
  whole-payment refund first, split it only if a shop actually asks.
- **Keep one hardcoded checkout line and encode gear as a price adjustment on the trip-fee line** —
  would corrupt the per-diver trip-fee snapshot (`amountPerDiverCents`) that abandoned-checkout
  recovery and reporting already read literally. Rejected; a real second line item is the honest
  shape.

## Consequences

- Closes the highest-leverage gap of the three deferred revenue-layer candidates with the pricing
  layer already built; the diver-facing win is picking gear in the same motion as booking instead of
  a staff member adding a line item after the fact.
- `CheckoutProvider.createCheckoutSession`'s signature changes (single line → `lineItems` array),
  touching every implementation and test double of the interface (`checkout.ts`, `tips.ts`, and the
  fake providers in `checkouts.test.ts`, `tips.test.ts`, `refunds.test.ts`, `recap.test.ts`,
  `shop-promos.test.ts`, `checkout-recovery.test.ts`) — mechanical, since every existing caller still
  sends exactly one line.
- `booking_checkout_bookings` gains a `gear_cents` column (schema-change skill: `pnpm db:generate`
  after the schema edit); existing rows default to 0, meaning "no gear on this historical checkout,"
  which is accurate.
- The public booking form gains a step for shops that price rental gear online; visual regression
  and the booking e2e spec need a new scenario for a shop with rental pricing configured, alongside
  the existing no-pricing-configured path staying pixel-identical.
- **Escape hatch:** if a shop later needs to refund gear independently of the trip fee (a genuine
  no-show who keeps rented-and-used gear), the `gear_cents` snapshot this ADR adds is exactly the
  input a split-refund decision needs — extending `src/lib/deposits.ts`'s refund logic to take it into
  account is additive, not a rework of this ADR's shape.
