# 20261108-configured-pricing — Configure one monthly and percentage offer

- **Status:** Accepted
- **Date:** 2026-11-08
- **Supersedes:** [20261022-pricing-ab-test](20261022-pricing-ab-test.md)

## Context

Aaron requested actual pricing configuration with an optional percentage and optional monthly cost,
with copy matching the configured components, instead of a pricing experiment.

## Decision

- Publish one offer for everyone. Remove randomized assignment, pricing cookies, visitor headers,
  experiment switches and split settings.
- Read `PRICING_MONTHLY_CENTS` (0–100000) and `PRICING_BASIS_POINTS` (0–1000; 300 means 3%).
  Setting either makes the omitted component zero. Both unset or blank use $0/month plus 3%, as requested after the initial implementation. Explicit zeroes mean free. Invalid input rejects the entire configuration and
  restores the default, logging variable names only.
- Derive the internal billing plan from the percentage: a positive percentage uses the metered
  plan; otherwise use monthly billing. Existing Stripe meter, monthly statements, fee arithmetic
  and card-receipts base remain unchanged.
- Percentage means eligible card receipts collected through DiveDay, after refunds, excluding
  tips, tax, pass-through fees, cash and imported history. It does not mean all shop income.
- Keep subscriber snapshots and explicit shop deals. Unsubscribed shops without an override use
  the configured offer. Changing environment values never rewrites an active subscription.
- Public pricing, Billing, metadata and related claims describe the components actually charged.
  The billing report groups by current plan rather than experimental assignment.

## Alternatives considered

- Keep the experiment at a 100% split: retains two offers and cookie-dependent pricing.
- Require both numbers: makes a monthly-only or percentage-only offer unnecessarily cumbersome.

## Consequences

Operators replace the five experiment variables with two values and redeploy. The default offer is $0/month plus 3% when neither is configured. Existing subscribers without a
terms snapshot retain the original $99 monthly price, independently of the new-offer default. Percentage billing still requires the existing Stripe
meter configuration. Revisit if shops need a self-service plan selector; that would require new
presentation and subscription-change behavior rather than restoring random assignment.
