# Percentage billing setup

Complete the subscription billing setup in [manual actions](manual-actions.md) first.
This guide configures Stripe; source defaults alone do not enable collections.

```text
Enable percentage billing
    when     before accepting subscriptions on the default $0/month plus 3% offer; test mode first
    why      DiveDay computes the fee in cents from money recorded received by any payment method, net of linked reversals, excluding separately recorded tax, tips, pass-through fees and imported history. Stripe collects that fee via a Billing Meter, not a Connect application fee.
    run      Finish [10], retaining BILLING_STRIPE_PRICE_ID as the original $99 monthly price for flat subscriptions. It is still required even when the new offer has no monthly charge.
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
    note     Subscriber snapshots and hand-set deals retain their terms. No customers exist yet; there is no receipt backfill. Changing source defaults does not create Stripe resources or change deployed environment overrides.
```

## Receipt accounting checks

Use test-mode fixtures only. Do not run the setup against live accounts as part of source work.

- Record a cash deposit and a later balance in different shop-local months. Charge each amount
  once when recorded, never the unpaid booking value. Also take a Stripe deposit and then cash:
  the seat keeps its original capture pointer, and the manual-held amount contains only cash.
  Replaying a paid event must not replace that mixed balance. Route a mixed refund to staff,
  returning each portion by its original method rather than sending the combined amount to Stripe.
- Replay a paid Stripe event and an external settlement echo. The receipt creates one collection;
  its seat cascade creates none. Sell a package and redeem it: only its sale counts.
- Record an external partial return using the dedicated amount control. Its amount cannot exceed
  the manual-held portion; the provider pointer and online money remain untouched. Re-submit a
  stale version, enter zero or too much, and try as crew without refund rights: none changes money.
- Refund after a statement closes, then change the rate. The later fee credit uses the original
  rate and rounding. An empty month carries the credit, and a failed refund reverses it.
- Check a fully refunded invoice whose tax split was reduced to zero. A failed refund restores
  its original chargeable balance, not tax and pass-through money as billable revenue.
- Keep JPY, EUR and USD separate. This meter and final-invoice adapter support USD only;
  non-USD statements must remain unreported, with no conversion or charge. Agree and implement
  native-currency Stripe prices before enabling billing for another currency.
- Missing exact settlement totals, missing enabled-tax evidence and contradictory totals block
  the affected close. Resolve source evidence before retrying; do not substitute the quote.
- Canceled subscriptions retain later refund credits. Settle unused credit with the shop rather
  than deleting it. Inspect `pricing_close.ended_subscription_adjustment` before any new charge.
- A 50,000-entry historical close bound fails visibly; it never returns a truncated fee. Add
  incremental checkpoints before a shop reaches that bound.
