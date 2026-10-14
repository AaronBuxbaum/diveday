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

## Amendment, 2026-10-14: counter money on an invoice already sent, and online seats on the ledger

Fourth UX review, items 18 and 19. Two gaps in "money the shop took":

- **Record payment on an open order.** A diver invoiced $340 walks in and pays cash. The order was
  a Stripe invoice and stayed Open forever. `recordPaymentOnOpenOrder` (`src/db/orders.ts`) marks
  the invoice paid out of band at Stripe first (`markInvoicePaidOutOfBand`, so Stripe stops asking
  and a diver who paid online a moment earlier makes Stripe refuse), then, under the row's lock and
  only while it is still an open `stripe_invoice`, makes it a paid counter order: `collection` is
  the method, `amount_paid_cents` its total, `paid_at` now, and the booking it was raised for is
  marked paid. **The three Stripe ids stay**, so diver erasure still files the Stripe customer's
  deletion request. `orders_stripe_ids_match_collection` now allows a non-Stripe collection to
  carry either none of the ids or all three, never a PaymentIntent (migration
  `20261014220545_counter-settled-invoice`). `stripeInvoiceOf` still refuses every Stripe operation
  on it, and the `invoice.paid` echo changes nothing. Any active staff member may record it, behind
  the money step-up, as any counter money.
- **A bench ticket paid at pickup.** `recordWorkOrderCounterPayment`
  (`src/db/work-order-follow-up.ts`) records the ticket's lines through `recordCounterOrder` and
  links the order as the ticket's bill. One bill per ticket is re-checked under the ticket's lock;
  the loser of a double tap is voided by `voidPaidCounterOrder` (the void without its role gate,
  the system undoing its own race rather than anyone's decision).
- **Online seat payments on the ledger.** A diver who paid at booking left a `booking_checkouts`
  row and no order, so the Money ledger and "Download orders (CSV)" never showed that money.
  `src/db/seat-payments.ts` lists one row per seat of a completed checkout, its share of the
  settled charge split by what each seat was asked, merged with orders by a `unionAll` in
  `pagedOrdersByDay` and filtered alike. Nothing is written: the seats stay `booking_checkouts`,
  and refunds stay on the checkout. The CSV gains "Paid on" and "Method".
