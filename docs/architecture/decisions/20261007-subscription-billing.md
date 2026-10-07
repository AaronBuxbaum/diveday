# 20261007-subscription-billing — Bill shops with Stripe Billing on DiveDay's own account, with webhooks as the source of truth

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

DiveDay had no way for a shop to pay it. The trial ran for three weeks from `shops.created_at`
(`src/lib/trial.ts`), Settings told the owner how many days were left, and the next step was an
email to `onboarding@dive.day` (H-12, 2026-08-05). The market audit (item 7) asked for the paid
path: a card captured once, a monthly charge, and a cancel the owner can do alone.

Constraints that shaped this decision:

- DiveDay already talks to Stripe through **Connect**. A shop's own account takes divers' money
  (ADR 20260719-stripe-connect-orders). The billing relationship runs the other way, from the
  shop to DiveDay, and must never touch a shop's connected account or its keys.
- **No paywall.** Expiry is soft by product decision (H-12). Nothing locks, hides or slows down
  because a shop has not paid.
- The product has **no operator identity**, so there is no "DiveDay staff" login that could grant a
  shop free months from a screen.
- Pre-pilot (H-49): no backfill and no dual-read.

## Decision

**Stripe Billing on DiveDay's own platform account.** Stripe is called with `fetch` and no SDK,
the same as Connect, from `src/lib/billing/stripe-billing.ts`:

- **Checkout** (`mode=subscription`, one price) captures the card.
- The **Customer Portal** handles card changes and cancellation. Cancel opens the Portal's
  `subscription_cancel` flow on the shop's own stored subscription.
- **Stripe emails the invoices.** DiveDay renders none.

**Three environment values turn billing on**, all registered in `config/env-registry.mjs` as
manual: `BILLING_STRIPE_SECRET_KEY`, `BILLING_STRIPE_WEBHOOK_SECRET` and `BILLING_STRIPE_PRICE_ID`.
They are separate from the Connect variables and never fall back to them. A billing key equal to
`STRIPE_SECRET_KEY` counts as not configured, so the Connect key pasted into the wrong slot cannot
half-work.

- `billingConfigFromEnvironment` returns `null` unless all three are present and well-formed.
- While it is `null`, Settings > Billing says billing is not turned on and offers no button.
- The webhook answers 503 and nothing else changes.

The human steps live in the manual action `stripe-billing-setup` (`infra/lib/infra-stack.ts` §17):
the product and price, a restricted key, the webhook endpoint, the Portal configuration and
customer emails.

**One row per shop, `shop_subscriptions`, written only by the webhook and two narrow hands:**

- The webhook stores Stripe's own subscription status (`stripe_status`, Stripe's eight values),
  the current period end, `cancel_at_period_end`, and the instant of the newest event applied
  (`last_subscription_event_at`).
- The Checkout action records the Stripe customer id. The id is minted with Idempotency-Key
  `diveday-billing-customer-<shopId>-<hash of the request parameters>`, so a double tap is one
  customer while a changed shop name inside Stripe's 24-hour key window is a new request rather
  than a refused one. The first write wins; a customer id another shop already holds is refused
  with "Stripe didn’t answer" rather than bound to two shops.
- The Checkout action also records the session it opened (`stripe_checkout_session_id`), only over
  the session it last settled (a compare-and-set); `checkout.session.completed` clears it.
- `pnpm billing:free-term <shop-slug> <last-free-day | none>` sets `free_term_ends_on`. This is how
  Aaron grants founding free months by hand. It is a script because there is no operator identity
  in the product.
- `first_paid_at` is written once, by the first `invoice.paid` with a non-zero amount on the
  subscription the row holds. It is the "first paid month" milestone, and the route also logs it
  as `billing.first_paid_month` and records the funnel's `first_paid_month` milestone in
  `shop_milestones` (ADR 20261007-founder-metrics) for a real shop. A paid invoice that arrives before its subscription is linked
  gives its claim back and answers 503, so Stripe delivers it again once the link has landed; a
  one-off dashboard invoice, or one for another subscription, never counts.

**The status a person sees is derived, not stored.** `billingStanding` in
`src/lib/billing/standing.ts` is pure, and maps the trial window, the free term and Stripe's status
onto six words:

| Word | Meaning |
| --- | --- |
| trialing | in the 21-day trial |
| free term | inside a granted free term |
| active | paying |
| past due | Stripe's `past_due`, `unpaid` or `paused` |
| canceled | Stripe's `canceled` or `incomplete_expired` |
| trial ended | no card, and no free time left |

`isInGoodStanding` is true for the first three words. It is the seam a future gate would read, and
**nothing reads it to gate anything today.**

**Checkout defers the first charge to the end of the free time.** The free time is the later of
the trial's end and the free term's end; a free term ends at the start of the shop's next local
day. Checkout sends it as `subscription_data[trial_end]`, with a floor of 48 hours plus 5 minutes,
because Stripe refuses anything shorter. A shop that adds a card on day 3 is charged on day 21, not
on day 3.

**The webhook route `src/app/api/webhooks/billing/route.ts`** follows the Connect webhook's
patterns, in this order:

1. **Signature.** `verifyStripeWebhook` is called with the billing secret, with a 300-second
   tolerance. Anything else is answered 400.
2. **Livemode.** An event whose `livemode` disagrees with the key's mode is acknowledged and
   ignored.
3. **Idempotency.** A claim is written to the existing `stripe_webhook_events` ledger under the id
   `billing:<event id>`, so it can never collide with a Connect claim. A duplicate gets 200. A
   handler that throws releases its claim and answers 500, so Stripe's retry is handled.
4. **Tenancy.** The shop is resolved only through the stored `stripe_customer_id`. The
   `metadata.shop_id` and `client_reference_id` on an event are claims: if one disagrees with the
   customer's shop, nothing is written (`tenant_mismatch`).
   - A subscription is adopted only when the shop has none, or when its current one has ended.
   - A second live subscription is refused (`foreign_subscription`).
   - `checkout.session.completed` only **links**: it writes the subscription id into an empty slot
     and touches no status, period or ordering clock. Those belong to the subscription events,
     which may arrive before or after it; a reset decided on a read those events had already made
     stale would wipe what they wrote.
   - A subscription id another shop holds is refused by a unique index
     (`subscription_claimed_elsewhere`).
5. **Order.** An update applies only when its event is at least as new as
   `last_subscription_event_at`. The check is part of the UPDATE's WHERE clause, so an older event
   that arrives late is a no-op. Stripe stamps events to the second, so within one subscription
   `canceled` and `incomplete_expired` are terminal: only another ended status may follow them,
   whatever order two same-second events arrive in.

The five events handled are `checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted` and `invoice.paid`.

**Settings > Billing (`/shop/[shopSlug]/settings/billing`) is the owner's alone.**
`canManageBilling` and `canPersonManageBilling` re-read the live roles, both on the page and in
each action. A manager is refused, as is a session whose JWT still says owner.

- The page shows the plan and price (from `earlyAccessPrice`), the status, and the next charge or
  end date.
- It offers one button: **Add a card** before a subscription exists, then **Manage billing** and
  **Cancel plan**.
- **One subscription per shop** is decided on the row, never on the displayed standing. "Add a
  card" goes to the Portal whenever the row holds a subscription that has not ended, including one
  linked with no status yet and one still `incomplete`. Before opening a Checkout it settles the
  last one at Stripe: an open session is expired (`POST /v1/checkout/sessions/:id/expire`), and a
  completed one whose webhook has not landed refuses with "Stripe is still confirming". Back from
  Checkout, or linked with no status yet, the page reads "Waiting for Stripe to confirm your card"
  instead of offering the button again.
- The actions redirect to the URL Stripe's API returns, and follow it only when it is https. The
  host is deliberately **not pinned** to `*.stripe.com`: Stripe can serve Checkout and the Portal
  from a custom domain the account configures, and pinning would turn that dashboard setting into
  a silent "Stripe didn’t answer". The URL arrives over TLS from Stripe's API under DiveDay's own
  key, so it is as trusted as the key.
- Demo shops are never billed and have no door to the page.
- The trial card that used to sit on the Settings hub moved here.

## Alternatives considered

- **Bill through the Connect account the shop already linked.** No. That account is the shop's
  money, not DiveDay's, and not every shop connects one.
- **Store the five-value status the brief named (`trialing / free-term / active / past_due /
  canceled`).** No. Trial and free term are DiveDay's own facts and Stripe's status is Stripe's.
  Storing a merged word would mean recomputing it on every clock tick. The six-word mapping is
  derived instead, with a sixth word, `trial ended`, so a shop with no card and no free time is
  never called "active".
- **A new ledger table for billing events.** No. `stripe_webhook_events` is already the claim
  ledger, already pruned by retention, and a prefix keeps the two endpoints apart.
- **The Stripe SDK.** No. The repo calls Stripe with `fetch`, and a new runtime dependency would
  need its own ADR for three endpoints.
- **A staff screen for free terms.** No. No operator role exists. A script against `DATABASE_URL` is
  honest about who can run it.
- **Gate features on standing.** Refused by H-12's soft-expiry decision. The seam exists; the gate
  does not.

## Consequences

- A shop can pay without an email, cancel without one, and change its card in Stripe's own UI.
  DiveDay renders no card field and stores no card data. The only Stripe ids it stores are the
  customer id and the subscription id, in `shop_subscriptions`.
- **This reverses part of H-12.** On 2026-08-14 H-12 decided the six-month founding term gets **no
  per-shop free-term state in the product**. `free_term_ends_on` is exactly that state. The column
  exists because the market-audit brief asked for "a staff-set free-term end date, so Aaron can
  grant founding free months by hand". The H-12 row must be amended by Aaron. Until he does:
  - The column is inert unless the script writes it.
  - A shop without it reads exactly as before: trialing, then trial ended.
- **The pricing FAQ goes stale once billing is turned on.** It still says to move to paid by
  emailing `onboarding@dive.day` (`marketing.pricing.faq.trialMeaning`). That copy is owned
  elsewhere, and its update is tracked with this change rather than made in it.
- Taxes are untouched. Stripe Tax on DiveDay's own invoices is the finance owner's call
  (`docs/product/stakeholders/finance-and-tax.md`). Turning it on is a Stripe price and dashboard
  setting, not a code change.
- `shop_subscriptions` sits outside retention and erasure. It holds no person, only a shop and its
  Stripe handles, and a shop reset keeps it, as it keeps `shop_stripe_accounts`.
- **Escape hatch.** If billing moves to another provider, only `stripe-billing.ts`, `events.ts` and
  the route change. The standing mapping and the page read only `shop_subscriptions`. Dropping
  billing entirely is one table and one route.
