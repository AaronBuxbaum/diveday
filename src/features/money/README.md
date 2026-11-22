# money

Getting paid and staying straight: checkouts, orders and invoices, refunds and disputes,
payouts, promos, and what DiveDay itself charges a shop.

## Owns

- Payments: `payments/` (Stripe and its webhook, server only), `payment-marks.ts`,
  `payment-disputes.ts`, `dispute-sheet/`, `refund-failures.ts`, `unattributed-refunds.ts`,
  `stripe-restricted.ts`, `payouts/`, `checkout-recovery/`, `checkouts-paid-after-close.ts`.
- Orders: `orders-index.ts`, `order-new-page.ts`, `order-detail-page.ts`, `order-header.ts`,
  `order-booking.ts`, `order-export.ts`, `local-orders.ts`, `invoice-door.ts`,
  `stale-package-invoices.ts`, `party-payment-receipt.ts`, `party-seat-checkout.ts`, `room-charges.ts`.
- What a trip earns and is owed: `trip-money/`, `departure-money.ts`, `owed.ts`, `trip-credit/`,
  `recorded-purchases/`, `bookkeeper/`.
- Promos: `trip-promos.ts`, `promos-page.ts`.
- DiveDay's own pricing and billing: `pricing-flags.ts`, `pricing-offer.ts`, `pricing-volume.ts`,
  `pricing-report.ts`, `fee-comparison.ts`, `billing/`, `billing-page.ts`, `shop-subscriptions.ts`.

## Does not own

The Stripe keys and client (`src/lib/payments/`), the collection ledger (`src/db/collection-ledger.ts`),
and the seat a payment is for (`bookings`).

## Invariants

- Every Stripe-mutating call carries an Idempotency-Key from a `payment_operation_intents` row
  written first; paid state comes only from Stripe, never a return URL; a payment status only
  moves forward and a cancelled booking is never paid (ADR 20260723-payment-operation-intents).
- A zero-decimal currency is never divided by 100 and a settled order keeps its currency; a refund
  automates only inside the stated window for a real Stripe payment; a replayed webhook repairs a
  partial write but never regresses a refund.
- `netOfPercentDiscount` mirrors Stripe's rounding; a redemption counts once per paid checkout; a
  last-minute promo's `max_redemptions` is capped at the open seats.
- A local order charges no card and creates no provider invoice; it never clears a booking fare or
  grants package credit, and replays of one request UUID record nothing twice.
- The public offer (`pricing-offer.ts`) uses the same configured terms as billing; visitor cookies
  and headers never select pricing. `fee-comparison.ts` is USD-cent integer math, and each choice
  about Booking.com money leans toward the competitor.
- Recorded-collection statements (`pricing-volume.ts`) close serialized on the shop row and never
  change; a non-USD currency is stated separately, never converted.
