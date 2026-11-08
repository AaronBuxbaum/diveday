# Percentage billing setup

Complete the subscription billing setup in [manual actions](manual-actions.md) first.
This guide configures Stripe; source defaults alone do not enable collections.

```text
Enable percentage billing
    when     before accepting subscriptions on the default $0/month plus 3% offer; test mode first
    why      DiveDay computes the fee in cents from eligible card receipts, net of refunds, excluding tax, tips, pass-through fees, cash and imported history. Stripe collects that fee via a Billing Meter, not a Connect application fee.
    run      Finish [10], retaining BILLING_STRIPE_PRICE_ID as the original $99 monthly price for legacy subscriptions. It is still required even when the new offer has no monthly charge.
             In DiveDay's Stripe account, create a Billing Meter with sum aggregation, event name diveday_percent_fee, customer mapping stripe_customer_id and value field value.
             Add a recurring monthly USD metered price to the DiveDay product, linked to that meter, at $0.01 per unit. This is one cent per fee-cent reported, NOT three cents per revenue-cent.
             Configure the restricted billing key for the endpoints used by src/features/billing/stripe-billing.ts: Customers, Checkout Sessions and Customer Portal sessions write; Prices and Subscriptions read; Billing meter events write and meter event summaries read; Invoice Items and Invoices write (including reads) for a canceled shop's final month. Do not grant connected-account access.
             Set BILLING_STRIPE_PERCENT_PRICE_ID to the metered price_... id and BILLING_STRIPE_PERCENT_METER_EVENT to diveday_percent_fee.
             Set PRICING_MONTHLY_CENTS=0 and PRICING_BASIS_POINTS=300 explicitly, then redeploy. Both blank also select this default; setting only monthly cents makes the omitted percentage zero.
    store    Billing credentials in 1Password and .env.manual, deployed through .env.vercel. Keep test and live Stripe objects and keys separate.
    verify   In test mode, a non-demo owner's Billing page shows 3% and no monthly fee, and Add a card opens Checkout with only the metered price. Complete test Checkout and confirm the signed billing webhook records the subscription and terms.
             Exercise the monthly close in staging with controlled eligible receipts: $1,000 net eligible volume produces a $30 statement, a meter value of 3000, and a $30 usage charge, not $3,000. Check invoice timing and refunds before switching to live.
             The existing /api/cron/pricing-volume schedule closes months on the 2nd and 3rd. Verify CRON_SECRET and scheduled invocations work, inspect failed reports, and confirm a canceled subscription's final month produces its invoice.
    if not   Without both percentage variables, percentage Checkout is disabled and closes can write statements but cannot report usage. A configured key with insufficient Stripe permissions can still render Add a card, so a real test-mode checkout and close are required.
    note     Existing subscriber snapshots and hand-set deals are preserved. This setup is not a migration of current customers. Changing source defaults does not create Stripe resources or change deployed environment overrides.
```
