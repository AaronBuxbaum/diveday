# 20260721-checkout-at-booking — Public checkout at booking time

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

The public booking flow reserves a seat with a name and an email; money changes hands later, when
staff build an order and Stripe emails an invoice
([20260719-stripe-connect-orders](20260719-stripe-connect-orders.md)). The
[competitive analysis](../../product/competitive-analysis.md#what-blocks-the-purchase) ranks this as
the single largest commercial gap: every credible competitor captures payment or a deposit at
booking, and for buyers that *is* the point of online booking — no-show protection and cashflow.
The prior ADR explicitly anticipated this layer: Checkout "may become a lower-friction 'pay now'
path … layered on top of the same connected-account header."

H-07's provider/mechanism half is settled (Connect, Standard accounts, shop as merchant of record);
its policy half (deposits, cancellation windows, refunds, tax, platform fee) remains open. This ADR
ships the mechanism with a conservative provisional policy, the same sequencing every prior payment
slice used.

## Decision

- **Book first, pay immediately after, in the same motion.** The capacity-safe booking transaction
  (`src/db/bookings.ts`) commits untouched; only then does the action hand the party one hosted
  Stripe Checkout session on the shop's connected account (quantity = party size, unit amount = the
  per-diver price) and redirect the diver to it. Payment never holds a lock inside the booking
  transaction, and a Stripe outage can only degrade to the existing book-now-pay-later flow — never
  to a lost seat or a phantom charge.
- **Abandonment is free by construction.** An unfinished checkout leaves exactly what exists today:
  an active, unpaid booking, visible through the shared `payment_due` blocker on Today and the
  roster when the trip requires payment. No seat-hold expiry machinery, no sweeper. If ghost
  bookings become a real cost, an expiry policy is an H-07 decision to layer on, not a reason to
  complicate the safety-critical booking path now.
- **Payment truth only ever comes from Stripe's own evidence.** `checkout.session.completed` (and
  `async_payment_succeeded`) on the existing Connect webhook — filtered on `payment_status:
  "paid"`, since a completed session with an async method is not yet money — marks the
  `booking_checkouts` row completed and cascades each covered booking to `paid` through the one
  shared `setBookingPayment` gate. The confirmation page's return-URL params prove nothing; when a
  diver beats the webhook home, the page re-reads the session from Stripe's API
  (`refreshCheckoutFromStripe`, mirroring `refreshOrderStatus`) rather than trusting the URL.
- **One open session per booking, reused.** "Finish paying" re-serves the stored hosted URL while
  the session is open and unexpired; only an expired session mints a new one. Public visitors can
  never stamp out unbounded Stripe objects for the same seats.
- **The per-diver price is the trip's own price** (`trips.price_cents`), with a course session
  charging its catalog pair via the same fallback `bookingInvoiceLines` uses
  (`perDiverBookingPriceCents`). An unpriced trip, an unconnected or charges-disabled account, or a
  missing `APP_HOST` origin all simply mean the flow stays book-now-pay-later — checkout is never a
  $0 charge and never a half-configured error page.
- **Checkout records are additive evidence, not a parallel payment system.** `booking_checkouts` +
  `booking_checkout_bookings` snapshot what was asked (per-diver amount, total, session, expiry);
  the booking's payment state stays in `booking_payments`, and orders/invoices remain the staff
  path for composed or after-the-fact charges. A staff cash mark and a late webhook converge on the
  same `paid` row.

### Provisional policy (H-07 remains open)

Full trip price per diver at booking; no deposit tier, no tax lines, no platform fee, no automated
cancellation/refund window. Refunds stay staff-initiated (via the diver's payment context). A shop
opts out of pay-at-booking by leaving the trip unpriced or not connecting Stripe. These defaults
require H-07 sign-off before production money.

## Alternatives considered

- **Require payment to hold the seat** (pay-first, book-on-webhook) — the strongest no-show
  protection, but it moves seat allocation into an asynchronous payment callback: capacity would be
  enforced against in-flight sessions, needing holds, expiry sweeps, and reconciliation for the
  safety-critical booking path. Rejected for this slice; the H-07 policy decision can revisit.
- **Stripe-hosted Invoices at booking** (reuse the order flow) — invoices are built for composed,
  after-the-fact billing with a days-until-due lifecycle, not a redirect-now purchase; Checkout is
  the purpose-built surface and was already reserved for exactly this in the prior ADR.
- **Embedded payment element on our page** — keeps the diver on-site but pulls PCI-scoped UI,
  Stripe.js, and payment-method rendering into the app for no functional gain over the hosted page
  at this stage.

## Consequences

- The best booking flow in the market now ends in the shop getting paid — the #1 buyer objection
  closes, with the shop's own account as merchant of record throughout.
- The Connect webhook endpoint must also subscribe to `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, and `checkout.session.expired` in the Stripe
  dashboard (same `STRIPE_WEBHOOK_SECRET`); until then the confirmation page's direct API refresh
  keeps paid state visible, fail-visible not fail-silent.
- `booking_payments` gains a third path to `paid` (checkout) beside the manual mark and the order
  webhook; all three still read through the one readiness rule.
- H-07's remaining policy questions (deposits, cancellation, tax, fees) now gate *pricing posture*,
  not mechanism. The provisional defaults above are recorded in
  [human-decisions.md](../../product/human-decisions.md#provisional-implementation-defaults--verify-before-production).
