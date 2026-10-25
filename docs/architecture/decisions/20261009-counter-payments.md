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
  qualifies (not a counter-settled invoice; see the 2026-10-14 amendment); a counter order is never
  refunded, since no processor holds the money.
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
  a Stripe invoice and stayed Open forever. `recordPaymentOnOpenOrder` (`src/db/orders.ts`)
  **claims the row first**: under its lock, an open `stripe_invoice` takes the counter method as
  its `collection` while it stays `open`, and that commits. Then it marks the invoice paid out of
  band at Stripe (`markInvoicePaidOutOfBand`, so Stripe stops asking; a diver who paid online a
  moment earlier makes Stripe refuse, and the claim is given back). Then, under the lock again, it
  finishes the claim: `amount_paid_cents` its total, `paid_at` now, and the booking it was raised
  for marked paid. **The three Stripe ids stay**, so diver erasure still files the Stripe
  customer's deletion request. `orders_stripe_ids_match_collection` now allows a non-Stripe
  collection to carry either none of the ids or all three, never a PaymentIntent (migration
  `20261014220545_counter-settled-invoice`), and `recordOrderPaymentIntent` only ever writes to a
  `stripe_invoice` row. `stripeInvoiceOf` still refuses every Stripe operation on it. Any active
  staff member may record it, behind the money step-up, as any counter money, and the shop's
  activity log names who did (`order_paid_cash` / `order_paid_card_machine`).
- **Why the claim comes before Stripe** (security review of layer r4-3). The mark sends back an
  `invoice.paid` that can arrive before the mark's own call returns. Marked first and written
  second, that echo found an open `stripe_invoice` and booked the cash as a Stripe payment.
  Claimed first, the echo (`paid_out_of_band: true`) finds the claim and finishes the counter
  settlement itself (`applyInvoicePaid`); any other `invoice.paid` for a claimed row is the diver's
  own online payment in the same moment and is deferred (non-2xx, no page) until the claim is given
  back. The claim is the order row itself, not a `payment_operation_intents` row: it lasts one
  round trip, stamped in its own `counter_claimed_at` (migration `20261015052453_counter-claimed-at`,
  checked to exist only on an open invoice with a counter method) so no other write to the row can
  move it. One older than `STALE_AFTER_MS` belonged to a call that died and may be taken again, by a
  second tap or by the next `invoice.paid`; while it stands, a second tap is told a payment is being
  recorded rather than that it failed.
- **Only a refusal Stripe answered gives the claim back** (second security review of layer r4-3).
  `markInvoicePaidOutOfBand` tells `refused` (a 4xx carrying Stripe's error envelope) from
  `unknown` (threw, timed out, 5xx, 409). On `unknown` Stripe may have marked the invoice, and a
  released row would let the echo book the cash as Stripe money, so the claim stands: the echo
  finishes it, or it goes stale. The call times out at 30 seconds, well inside the claim's horizon,
  so it is over before anyone can retake its claim, and it carries one idempotency key per order
  (`order:<id>:paid_out_of_band`), so a retake replays it rather than issuing a second mark.
- **A counter line with no activity row means the call died after Stripe.** The actor is not stored
  on the claim, so when Stripe's echo finishes it, nothing names who tapped. The webhook's
  `order_paid_at_counter` outcome logs the order id, which the request log can be joined on.
- **A counter-settled invoice is never voided.** Stripe holds it paid out of band and has no way to
  un-pay an invoice, so a local void would leave the books disagreeing with Stripe and the diver's
  hosted invoice reading paid with no Stripe path left to collect through. `voidCounterOrder`
  refuses any counter order that carries Stripe ids (`isVoidableCounterOrder`), and the order page
  does not offer Void on one. Money taken back over the counter after such a settle is not
  recordable yet.
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

## Amendment 2026-10-16: room charge (fifth-loop ideas, item 57)

A resort dive center bills a guest's dives to their room and settles with the hotel's front desk
monthly. `order_collection` gains `room_charge`, and an order charged to a room names it:
`orders.room_number` (required with `room_charge`, and only with it:
`orders_room_charge_names_room`) and `orders.room_hotel` (optional, for a shop serving more than
one hotel; `orders_room_hotel_only_on_room_charge`). It is a third way to settle an **open
invoice** from the order page (`recordPaymentOnOpenOrder`), behind the same money step-up, the
same claim, and the same out-of-band mark to Stripe, so the diver is not asked twice; the claim
writes the room with the method and a released claim clears both. Counter rentals and bench
tickets stay cash and card machine. The activity log says `order_paid_room_charge`; the Orders
index tells an owner or manager the month's room charges per hotel ("Room charges in October: Reef
Hotel $1,840 on 14 orders", `src/db/room-charges.ts`), net of refunds; the CSV method code is
`room_charge`. This does not revive hotel rate cards (#1237).

## Amendment 2026-10-17: Reports says counter money is tax included (issue #2674)

DiveDay holds no tax rate for a shop, so counter money stays written with `tax_cents = 0` and counted
whole. Aaron chose option (a): Reports' month and year pages say so in one line under the tax
figure ("Counter sales are not split into tax, so Tax collected leaves them out."), shown only when
the counter took money in that window: `counterTaxIncludedCents` in `getMonthMoneyDetail` (`src/db/report-lines.ts`), orders on any
collection but `stripe_invoice`, paid in the month, with no tax of their own. No schema. A per-shop
counter tax rate (option b) waits until a shop asks; reading a rate from Stripe Tax for an
off-Stripe sale stays out (ADR 20260826-stripe-tax-is-opt-in-and-provider-owned).

## Amendment 2026-10-22: Record payment on a demo order (market sheet, item 6)

A demo shop's invoices carry made-up Stripe ids, so Record payment was disabled there with Refresh
and Void. Cash and the card machine never needed Stripe, so a demo order now records them:
`recordPaymentAction` sends a demo shop to `recordDemoPaymentOnOpenOrder`, which takes no invoicing
provider, reads `shops.is_demo` under a lock in the transaction that writes, matches the order on
its id and that shop, and settles through the same `settleCounterClaim` a real counter payment
uses. A real shop never reaches it (`not_demo`), and a room charge on a demo shop stays refused with
the demo note. Refresh, Void and Refund stay disabled on a demo order.

## Amendment 2026-10-25: Record payment holds eight seconds with Undo (issue #3030, H-159)

Cash and Card machine on an open invoice stay one tap, but the tap no longer records: it holds the
payment as a `counter_payment` held send ([20260906-before-you-ask](20260906-before-you-ask.md),
decision 2) for eight seconds, the row reading "Recorded $340 cash" with Undo. Undo deletes the
hold and records nothing; the hold running out, from the tapping screen or the hourly sweep for a
screen that went elsewhere, records it through `recordPaymentOnOpenOrder` (or the demo writer) with
the activity line naming who tapped it (`src/db/counter-payment-hold.ts`). A second tap inside the
hold is the same hold. The money step-up is asked at the tap. The room charge keeps its form and
records on its confirm.
