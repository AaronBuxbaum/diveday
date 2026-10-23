# 20261022-pricing-ab-test — Test a percent-of-volume plan against the flat price, off by default

- **Status:** Proposed
- **Date:** 2026-10-22
- **Amends:** [20261007-subscription-billing](20261007-subscription-billing.md)

## Context

DiveDay sells one flat monthly price. Aaron wants to measure whether a share of what a shop takes
through DiveDay converts better, with adjustable numbers.

## Decision

- Two plans in `src/lib/billing/pricing-plans.ts`: `flat_monthly` and `percent_of_volume` (basis
  points of the month's volume, plus an optional base fee). A **pricing arm** is the plan a visitor
  or shop is put in.
- **Volume** is card money paid through DiveDay in the shop's own calendar month, by the Reports
  page's money-by-line rules (`cardMoneyThroughDiveDayCents`): Stripe-collected invoices and online
  booking checkouts, net of refunds recorded by the close, never tips, tax, pass-through fees,
  counter money, hand-marked payments or imported history. Trial and free-term money is not billed.
  The fee is integer cents, half up, never negative.
- The numbers are five optional env vars read by `src/lib/pricing-flags.ts`. Unset, the **test is
  off**: no cookie, no request read, today's copy and price.
  One invalid value sends all five to their defaults, test off, logged once by name.
- The proxy gives a new marketing visitor an arm cookie (`dd_pricing`, 90 days, HttpOnly) and
  overwrites a request header so the first render shows it. The setup request stores the arm; shop
  creation copies it to `shop_subscriptions`, or a shop with none takes its id's SHA-256 bucket.
  `pnpm billing:pricing-plan` sets an override by hand.
- Checkout snapshots the numbers it sells (`plan_monthly_cents`, `plan_basis_points`), and a live
  subscription keeps them whatever the env says later. Today's flat price checks out on the
  existing price; any other fee is `price_data` on that price's product, fetched once per process
  (simpler than another env var); the percent plan adds a metered price.
- A cron on the 2nd and 3rd writes each percent shop's statement once, with the basis points used,
  then reports its fee to a Stripe Billing Meter under identifier `diveday-fee-<shop>-<yyyy-mm>`.
  `invoice.paid` adds to `paid_total_cents`; `pnpm billing:pricing-test` reads both arms.

## Alternatives considered

- **Connect `application_fee_amount`.** Changes the shop's merchant charges, needs per-charge
  disclosure, and cannot see counter or invoice nuance.
- **Shop-reported volume.** Unverifiable.
- **Edge Config, SSM, AppConfig.** Each adds a service or dependency; a redeploy per change is
  acceptable for a test tuned rarely, and env vars add nothing to run.

## Consequences

- With the env unset nothing changes; the flat arm's copy is byte-identical.
- Flat-only claims render for the flat arm alone. The percent arm has its own lines, and no
  per-booking-fee box on the guides or JSON-LD `Offer` on `/`.
- The arm cookie is client-editable: a visitor can pick either arm on offer, never other numbers.
- A month's statement is never recomputed; a refund recorded after the close is not credited.
- A meter event timestamped in a Stripe period already invoiced may be billed late or not at all.
- An override stands with the test off, and `PRICING_FLAT_MONTHLY_CENTS` applies with the test off.
