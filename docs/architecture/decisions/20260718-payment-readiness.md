# 20260718-payment-readiness — Add payment to readiness behind a provider seam

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

"Ready to board" combined waiver + certification evidence but ignored money. Shops want a
pay-to-board charter to block an unpaid diver at the desk, the same way an unsigned waiver does.
Full payments are an M7 concern (a provider decision, credentials, webhooks), but the *readiness
dimension* — is this booking paid? — can land now without waiting on the online-payment
integration.

## Decision

- **Payment is a booking state, gated per trip.** A `booking_payments` row holds the current
  status (`unpaid | deposit_paid | paid | waived | refunded`) per booking; `trip_requirements`
  gains `requires_payment`. When a trip requires payment, readiness adds a `payment_due` blocker
  unless the booking is `paid`, `deposit_paid`, or `waived` — an **absent row reads as unpaid**, and
  a `refund` re-opens the gate. Payment is trip-level only (a commercial term, not a dive-site gate),
  so it is read straight off the requirement, not composed with the site.
- **Staff mark payment today; a provider seam takes it online later.** The roster has per-diver
  payment controls (mark paid / deposit / waived / refunded). `src/lib/payments/` defines a
  `PaymentProvider` (Stripe Checkout over its form API, gated on `STRIPE_SECRET_KEY`) with a
  `createCheckout` entry point; no key → a disabled provider returns `not_configured`.
- **Deferred:** webhook confirmation of a completed online payment (auto-advancing a booking to
  `paid`) is future work — today the seam mints a pay link and staff confirm receipt.
- **Human prerequisite (H):** a Stripe account + `STRIPE_SECRET_KEY` (and later a webhook secret).

## Alternatives considered

- **Denormalize `payment_status` onto `bookings`** — simpler, but a dedicated row leaves room for
  amount, currency, provider ref, and a future ledger without widening the hot bookings table.
- **Treat a deposit as not-cleared** — some shops require full payment to board; modeled as a
  reversible policy (today deposit clears). If shops need "full payment only", add a requirement
  flag rather than changing the enum semantics.
- **Wait for the full M7 payments milestone** — needlessly delays the readiness signal, which is
  useful with manual marking alone.

## Consequences

- Makes "ready to board" honest about money and keeps one shared readiness result across staff
  roster, confirmation, and manifest.
- Commits us to the fail-closed rule here too: unknown/absent payment is unpaid, and a refund
  blocks — money never silently clears a diver.
- Escape hatch: wiring real Stripe means adding a checkout redirect + a webhook that calls
  `setBookingPayment('paid', provider:'stripe', providerRef)`; the readiness contract is unchanged.
