# 20261124-free-shops-no-trial — Make a shop free with no trial, and state the fee only from the pricing configuration

- **Status:** Accepted
- **Date:** 2026-11-24
- **Supersedes in part:** [20261007-subscription-billing](20261007-subscription-billing.md) — the
  trial window, the `trialing` and `trial ended` standing states, and the trial as the first
  charge date. Stripe Billing, the webhook as source of truth, the hand-granted free term and the
  Portal stand.

## Context

Aaron, 2026-11-24 (final): DiveDay has no 14-day trial. A shop is free with no card, and DiveDay
keeps a percent only of payments taken in DiveDay. The price may change, so the copy must follow
the pricing settings. A trial that expires contradicts a free shop, and a bundle string that spells
"1%" goes stale the day `PRICING_BASIS_POINTS` changes. There are no users, so nothing needs a
compatibility path (H-20260815-no-legacy).

## Decision

- **No trial.** `src/features/shop-setup/trial.ts` is deleted; it was never stored.
- **Standing** (`src/lib/billing/standing.ts`) has five codes: `no_card`, `free_term`, `active`,
  `past_due`, `canceled`. `no_card` is the ordinary free state: it is in good standing and
  Settings > Billing draws no badge for it. A Stripe-side trial (Checkout's deferred first charge)
  reads as `free_term` while a granted term runs, otherwise `active`.
- **Billing starts at the card.** Money collected with no card is never billed, including the
  months before a card is added: the billable floor is the later of a granted free term's end and
  `shop_subscriptions.subscribed_at`, the card-added instant the billing webhook writes when a
  subscription is first linked (`billableFrom` in `standing.ts`, read by the monthly close and
  Settings > Billing). Checkout defers the first charge only to a running free term.
- **The fee is a parameter.** Every sentence that states DiveDay's price takes its figures from
  `planCopyParams(configuredPricing(pricingConfig()))` as ICU parameters (`{percent}`, `{base}`,
  `{hasBase}`, `{hasPercent}`), never a figure in a bundle. `marketing.pricing.priceNote` and
  `account.onboard.priceNote` (renamed from `trialNote`) read true for a percent alone, a monthly
  base alone, or both; `src/app/(marketing)/pricing/price-note.test.ts` renders them for several
  configurations.
- `/onboard`'s primary is "Create your shop".

## Alternatives considered

- **Keep the trial, with no card** — contradicts "free", and a timer that changes nothing is noise.
- **Keep "1%" in the bundles and edit them on a price change** — the drift this decision removes.

## Consequences

- A shop's collected money counts from the moment it adds a card, never earlier; a free term
  granted by hand is still how DiveDay waives a period after that.
- A new price is an environment change (`PRICING_MONTHLY_CENTS`, `PRICING_BASIS_POINTS`) and every
  public and in-app price line follows it. A price whose shape the ICU selects do not cover
  (a per-seat fee, say) needs new branches and a case in the render test.
- Revisit if DiveDay wants a time-limited offer again; it would be a new state in `standing.ts`,
  not a return of the deleted module.
