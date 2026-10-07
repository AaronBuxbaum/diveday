# H-07: What payment/deposit, cancellation, refund, tax, and provider policy should the first paid booking support?

- **Status:** In progress
- **Human owner:** Product owner + finance owner

## Decision or approval needed

What payment/deposit, cancellation, refund, tax, and provider policy should the first paid booking support?

## Minimum outcome to record

Policy plus provider approval and webhook/account owner.

## Unblocks / follow-up

The provider decision is made and implemented: Stripe Connect (Standard, shop-owned accounts), orders/invoices, and webhook confirmation — see [20260719-stripe-connect-orders](../../architecture/decisions/20260719-stripe-connect-orders.md). Public checkout-at-booking is also implemented on that substrate with a [provisional policy](README.md#booking-checkout) — see [20260721-checkout-at-booking](../../architecture/decisions/20260721-checkout-at-booking.md). The deposit and declarative-cancellation-window *mechanisms* are now shipped too (opt-in, off by default, no default values) — see [20260721-deposit-cancellation-policy](../../architecture/decisions/20260721-deposit-cancellation-policy.md). **Automated refunds inside the cancellation window are now implemented** — a cancel inside a shop's stated window refunds a Stripe payment automatically through the shop's own account, degrading to the staff-run refund for counter payments, disconnected accounts, or Stripe failures — see [20260721-automated-cancellation-refund](../../architecture/decisions/20260721-automated-cancellation-refund.md). Still open (policy, not mechanism): the deposit/window *values* shops should be guided toward, percentage vs. flat deposits (mechanism deferred by owner request), refund/tax policy, and whether the platform ever takes a fee; a live Stripe Connect platform application (`STRIPE_CONNECT_CLIENT_ID`) and Connect webhook secret (`STRIPE_WEBHOOK_SECRET`) — now also subscribed to the three `checkout.session.*` events — still need a named owner. **Values decided 2026-07-24 (Aaron Buxbaum):** DiveDay ships **no hard defaults** (correct as-is) but now shows a non-binding **guidance hint** on the trip deposit/cancellation fields ("many shops set 20–30% of the fare"; "48 hours is a common window") — `trips/new/page.tsx` and `DetailsSection.tsx`. Deposits stay **flat** (percentage remains deferred). **No platform fee** for the founding cohort. Unpaid bookings **do not auto-expire** — they surface via the existing `payment_due` blocker for staff to release. The Stripe Connect platform application and webhook-secret owner is **Aaron Buxbaum** (sole operator; same as H-04). **Still gated on the accountant:** sales-tax/VAT treatment on deposits and fares — excluded from this decision. **Reconfirmed 2026-07-30 (Aaron Buxbaum): no baked-in default deposit or cancellation-window values, ever** — the guidance-hint copy is the final answer, not an interim step toward a real default; a shop with neither set stays full-fare, no-refund-window (current behavior, now explicitly settled rather than open). **Shop-caused cancellations decided 2026-08-13 (Aaron Buxbaum):** a departure the *shop* cancels — a weather blow-out or the minimum-head-count sweep — **refunds the captured fare automatically**, with the stated cancellation window *bypassed* rather than reused, because a window is a rule about a diver changing their mind. Degradation is unchanged (counter payment, disconnected account, or a Stripe failure leaves it to staff) and the diver is now told which of the two happened. This closes the question both [20260804-blowout-cascade](../../architecture/decisions/20260804-blowout-cascade.md) and [20260813-minimum-head-count-departures](../../architecture/decisions/20260813-minimum-head-count-departures.md) left to this row — see [20260813-shop-cancellation-refunds-itself](../../architecture/decisions/20260813-shop-cancellation-refunds-itself.md).

## Note

**H-07 mechanism update (2026-08-26):** Stripe Tax is now the implemented, per-shop opt-in
mechanism for sales tax/VAT on booking Checkout and staff invoices. Listed prices remain pre-tax;
tax is exclusive, shown to the diver, retained as provider evidence, and reported separately from
net revenue. The tax portion of H-07 remains open for accountant/legal confirmation of
applicability, registrations, remittance, and the treatment of deposits and fares.

Part of the [human decision log](README.md#decision-register).
