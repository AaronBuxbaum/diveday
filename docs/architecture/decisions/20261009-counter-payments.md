# 20261009-counter-payments — Record money taken at the counter as a paid order with no Stripe ids

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Every `orders` row was a Stripe invoice ([20260719-stripe-connect-orders](20260719-stripe-connect-orders.md)):
`stripe_account_id`, `stripe_customer_id` and `stripe_invoice_id` were NOT NULL. A counter gear
rental ([20260815-minimal-gear-register](20260815-minimal-gear-register.md), amended 2026-10-08) is
often paid in cash or on the shop's own card machine, and that money had nowhere to land: it never
showed as Paid in the Orders ledger, in Reports, or on the gear Rentals list. Aaron decided on
2026-10-09 that a shop must be able to record such a payment, and that it reads as Paid everywhere a
Stripe-settled order does.

## Decision

- **One `orders` table, a `collection` column.** New enum `order_collection`
  (`stripe_invoice`, `cash`, `card_machine`), NOT NULL, default `stripe_invoice`. The three Stripe
  ids are nullable, and the check constraint `orders_stripe_ids_match_collection` requires all three
  on a `stripe_invoice` order and none on any other.
- **`recordCounterOrder`** (`src/db/orders.ts`) writes the order already `paid`:
  `amount_paid_cents = total_cents = Σ quantity × unit_amount_cents`, `tax_cents = 0` (the figure is
  what was collected, tax included), `finalized_at = paid_at = now`, its line items, package
  entitlements and the `order.paid` integration event, in one transaction. No Stripe call, no email,
  no booking. Line items carry `createOrder`'s exact bounds; the payer must belong to the shop.
- **Any active staff member may record one.** Taking cash at the counter is day work, like renting
  the gear out (H-06). Billing a diver by invoice stays owner/manager (H-14, `createOrder`).
- **Correcting a mistake is local and owner/manager.** `voidCounterOrder` sets `void`, stamps
  `voided_at` and zeroes `amount_paid_cents`, so Reports drops it. Only a `paid` counter order
  qualifies; a counter order is never refunded, since no processor holds the money.
- **Every Stripe operation refuses a counter order** through `stripeInvoiceOf(order)`, which returns
  the ids only for a `stripe_invoice` row: refund (`not_invoiced`), void, resend, refresh. Webhook
  lookups by invoice id are unchanged; a counter order has no id to match. Erasure queues no
  processor work for it.
- **Reports anchors an order with no booking to `paid_at`.** Booking revenue stays anchored to the
  departure; an order on no booking (a counter rental, a retail sale) counts in the month it was
  paid, by `amount_paid_cents`.

## Alternatives considered

- **A separate `counter_payments` table.** Rejected: the ledger, Reports, the diver's history, the
  export and the integrations all read `orders`, and each would need a second source.
- **Fake Stripe ids on a counter order.** Rejected: every Stripe call would then need its own
  guard, and the export would hand a shop references its Stripe account has never seen.
- **Owner/manager only for recording.** Rejected by Aaron: the person at the counter takes the cash.

## Consequences

- A counter order cannot be refunded in DiveDay. The shop hands the cash back and voids the order;
  a part refund of counter money is not recordable yet.
- Integrations receive `order.paid` for counter money with no hint of how it was taken; an
  accounting adapter that books to a Stripe clearing account would misfile it. Revisit when one does.
- Adding a fourth method (bank transfer) is one enum value and one word in each locale.
