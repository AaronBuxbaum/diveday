# 20261022-pricing-ab-test — Test a percent-of-volume plan against the flat price, off by default

- **Status:** Accepted
- **Date:** 2026-10-22
- **Amends:** [20261007-subscription-billing](20261007-subscription-billing.md)

## Context

Aaron wants to measure whether a share of what a shop takes through DiveDay converts better than
the flat price. On 2026-10-24 he chose to run the public
50/50 test now, with a lawyer reviewing the terms after launch (#2947; the Tier 1 item in
[legal-engagement-scope.md](../../product/stakeholders/legal-engagement-scope.md)). With a handful
of shops, results are directional.

## Decision

- Two plans in `src/lib/billing/pricing-plans.ts`: `flat_monthly` and `percent_of_volume` (basis
  points of the month's volume, plus an optional base fee); a shop or visitor is in one **pricing
  arm**.
- **Volume** is card money paid through DiveDay in the shop's calendar month
  (`cardMoneyThroughDiveDayCents`): Stripe invoices and online booking checkouts, net of
  refunds recorded by the close, never tips, tax, pass-through fees, counter money, hand-marked
  payments or imported history. Free-term money is not billed. The fee is integer cents, half up.
- Five optional env vars, read by `src/lib/pricing-flags.ts`. Unset, the **test is off**: no
  cookie, no request read, today's copy. One invalid value resets all five.
- The proxy gives a new marketing visitor's GET an arm cookie (`dd_pricing`, 90 days, HttpOnly)
  and a request header for the first render. The setup request stores the arm; shop creation
  stores it in `shop_subscriptions`, or, with none recorded and the test on, the new shop's id
  bucket. **A shop read with no stored arm is flat**, so existing shops never move. `pnpm billing:pricing-plan` sets an
  override, never under an open Checkout.
- Checkout snapshots the numbers it sells, and a live subscription keeps them. Any fee but today's
  is `price_data` on the existing product; the percent plan adds a metered price.
- A cron on the 2nd and 3rd writes each percent shop's statement once, then reports its fee to a
  Stripe Billing Meter (`diveday-fee-<shop>-<yyyy-mm>`), reading the meter before re-sending past
  Stripe's dedupe.
- **`/terms` carries the percent-plan clause**, rate and base fee from
  `pricingConfig`, test on or off: the fee base above, a monthly statement, the shop pays and never
  the diver, 30 days' notice of any change.

## Alternatives considered

- **Connect `application_fee_amount`.** Changes the shop's merchant charges, needs per-charge
  disclosure, and cannot see counter or invoice nuance.
- **Shop-reported volume.** Unverifiable.
- **Edge Config, SSM, AppConfig.** Each adds a service a rarely tuned test does not need.

## Consequences

- With the env unset the flat arm's copy is byte-identical.
- Flat-only claims ("no cut of your bookings") are the flat arm's alone; the percent arm has its
  own lines, and no per-booking-fee box on the guides or JSON-LD `Offer` on `/`.
- A visitor can edit the arm cookie to pick either arm, never other numbers.
- A month's statement is never recomputed; a refund recorded after the close is not credited.
- A meter event in an already invoiced Stripe period may bill late or never.
- With the test off, an override stands and `PRICING_FLAT_MONTHLY_CENTS` applies.
