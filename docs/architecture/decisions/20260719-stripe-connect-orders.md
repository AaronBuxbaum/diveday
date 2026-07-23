# 20260719-stripe-connect-orders — Shop-owned Stripe accounts, orders, and invoices

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

[20260718-payment-readiness](20260718-payment-readiness.md) added a `booking_payments` state so
"ready to board" can gate on money, with a `PaymentProvider` seam (`src/lib/payments/`) that mints
a Stripe Checkout link against one platform-level `STRIPE_SECRET_KEY`. That key belongs to a single
Stripe account, so any real charge through it settles into that one account — not the shop's own.
It was deliberately left unwired to any route: fine for a readiness *flag*, wrong for real money.

The product owner now wants two things this ADR settles together, since they are the same
integration: (1) a shop supplies its own Stripe account rather than money flowing through a shared
platform account, and (2) shops can generate an order/invoice for a diver, hand them a payable link,
and see the paid result in the app without a human re-keying anything. H-07 (payment/deposit/refund/
tax policy) in [human-decisions.md](../../product/human-decisions.md) remains open for the *policy*
questions (deposits, cancellation, refunds, tax); this ADR only settles the *mechanism*.

## Decision

- **Stripe Connect, Standard accounts, via OAuth.** A shop clicks "Connect Stripe" on the shop
  settings page (`/shop/[shopSlug]/settings/payments`); this redirects to Stripe's OAuth authorize endpoint
  (`https://connect.stripe.com/oauth/authorize`) and the shop signs into or creates their **own**
  Stripe account. The callback exchanges the returned code for a `stripe_user_id` and stores it in
  a new `shop_stripe_accounts` row (one per shop). Standard is the correct account type for "the
  shop supplies their own Stripe account": the shop keeps its own full Stripe dashboard, owns its
  own payouts and tax reporting, and can disconnect unilaterally from their Stripe settings. This is
  not Express/Custom (platform-controlled sub-accounts) — those exist for platforms that want to
  *own* the merchant relationship, which is the opposite of what was asked for.
- **One fixed OAuth callback.** Stripe requires each redirect URI to be pre-registered and does not
  permit a wildcard for a shop created in the future. Every shop therefore returns to
  `/api/stripe/connect/callback`; the authenticated staff session plus the short-lived state cookie
  identifies the initiating shop before the returned account ID is stored. Configure
  `${APP_HOST}/api/stripe/connect/callback` once in the platform's Connect OAuth settings.
- **No new SDK dependency.** Every Stripe call — OAuth token exchange, account status, customer,
  invoice items, invoice, webhook signature verification — goes over `fetch` against Stripe's REST
  API, the same pattern as the existing checkout seam and the Resend notification seam
  ([20260718-resend-transactional-email](20260718-resend-transactional-email.md)). Once a shop has
  authorized the platform via OAuth, the platform's own `STRIPE_SECRET_KEY` can act on that shop's
  behalf by sending a `Stripe-Account: <stripe_user_id>` header — no per-shop secret to store.
- **Orders are the local, provider-neutral record; Stripe Invoices are the payment surface.** A new
  `orders` table (status `open | paid | void | uncollectible | refunded`, a customer, an optional `booking_id`,
  totals, and the Stripe invoice/customer ids) plus `order_line_items` (kind, description, quantity,
  unit amount) let staff build an order from one or more charges — a trip fee, a course fee, rental
  gear, a deposit, or a free-form line — against an existing person. Creating an order calls the
  connected account's Invoicing API (customer → invoice items → invoice → finalize → send) and
  stores the resulting hosted invoice URL/PDF; staff can also share the link directly instead of
  relying on Stripe's email.
- **A webhook confirms payment in the app — the deferred half of the prior ADR.** A single Connect
  webhook endpoint (`/api/webhooks/stripe`, verified with `STRIPE_WEBHOOK_SECRET`) receives
  `invoice.paid`, `invoice.voided`, `invoice.payment_failed`, `account.updated`, and
  `account.application.deauthorized` for every connected account (Stripe includes the connected
  account id as the event's `account` field). `invoice.paid` marks the matching order `paid` and,
  when the order carries a `booking_id`, calls the existing `setBookingPayment(status: "paid",
  provider: "stripe", providerRef: invoiceId)` — the exact escape hatch the prior ADR described, so
  the shared readiness rule is untouched. `account.updated` keeps `charges_enabled`/
  `payouts_enabled`/`details_submitted` current without staff needing to reload the settings page.
  Order pages also offer a manual "Refresh status" action (a direct `GET` to the invoice) so a shop
  is never stuck if the webhook secret is not yet configured — fail-visible, not fail-silent,
  matching how every other provider seam here degrades to `not_configured` rather than pretending.
- **A trip carries an optional per-diver price (`trips.price_cents`).** It is the trip's own
  attribute, not something orders invent: staff set it when scheduling (or later, on the trip's
  detail page), and it is null-safe — an unpriced trip just means the trip-fee line item starts
  blank. Starting an order from a roster row ("Create order") pre-fills the first line item's kind,
  description, and amount from the trip; staff still review before sending, since a discount or an
  added rental line is common.
- **Orders require a connected, charges-enabled account.** Without one, order creation is blocked
  with a link back to the connect flow — never a phantom invoice that can never be paid.
- **Refunds are initiated from the person-first payment context.** A paid order can request a full
  Stripe refund through its invoice payment intent. The local order becomes `refunded`, and a
  linked booking's payment gate becomes `refunded` so readiness requires payment again. A missing
  Stripe payment intent fails visibly; it never pretends that a refund happened. The policy details
  around partial refunds, cancellation windows, taxes, and deposits remain H-07.
- **No platform fee is taken today.** The shop's own account is the merchant of record for its
  invoices; this ADR does not implement Stripe Connect's `application_fee_amount`. A platform
  commission is a commercial/H-07 decision, not a mechanism this ADR forecloses — add the fee
  parameter to invoice creation when that policy is set.

## Alternatives considered

- **Express or Custom Connect accounts** — give the platform more control (a lighter onboarding, a
  platform-branded dashboard) at the cost of the platform owning KYC, payouts, and 1099 exposure.
  Rejected: the ask was explicitly for the shop to bring its own account, which Standard is built
  for.
- **A "delegated" model where the platform's single Stripe account processes all shops' money and
  the app internally allocates who is owed what** — this was the "delegated Stripe system"
  alternative the product owner floated. Rejected: it makes the platform a payment facilitator (much
  higher compliance burden, manual payout reconciliation, and the platform holds shops' money) for
  no benefit over Connect, which Stripe already built for exactly this multi-tenant shape.
- **Keep using Stripe Checkout Sessions instead of Invoices** — Checkout is well-suited to a single
  fixed-price purchase at the moment a diver pays, but shops need to compose multiple line items
  (trip + rental + course) into one payable document and see its lifecycle (open/paid/void) after
  the fact; Invoicing is the API built for that and still produces a hosted, payable link. The prior
  checkout seam (`createCheckout`) is left as-is and unwired — it may become a lower-friction "pay
  now" path for a single-item deposit later, layered on top of the same connected-account header.
- **Create/reuse a Stripe Customer per person, stored on `people`** — would avoid creating a new
  Stripe customer per order. Deferred: it requires per-shop customer identity (a person can be a
  customer of multiple shops with different connected accounts) and isn't required for a shop to
  invoice a diver correctly today; revisit if duplicate-customer volume becomes a real support cost.
- **Poll Stripe instead of a webhook** — simpler to build, no public endpoint or signing secret, but
  makes "see it was paid in the app" laggy or dependent on staff re-opening the order. The manual
  refresh action already covers the no-webhook-configured case, so polling adds little.

## Consequences

- A shop's diver payments settle directly into the shop's own Stripe account and payouts, matching
  how a real business expects to get paid — the platform is never in the money-holding path.
- `booking_payments` gains a second, automatic path to `paid` (via an order's webhook) alongside the
  existing manual staff mark; both still read through the one shared readiness rule.
- Two new human prerequisites: a Stripe Connect **platform** application (`STRIPE_CONNECT_CLIENT_ID`,
  reusing the existing `STRIPE_SECRET_KEY` as the platform secret) and a Connect webhook endpoint
  configured in the Stripe dashboard with its signing secret (`STRIPE_WEBHOOK_SECRET`). Until both
  are set, the connect button and order creation clearly report `not_configured` rather than
  half-working.
- Tax, refunds, disputes, cancellation policy, and any future platform fee remain H-07 decisions —
  this ADR intentionally ships the mechanism ahead of that policy, the same sequencing the prior
  payment-readiness ADR used for the manual-mark slice.
- A new Stripe customer is created per order rather than reused; acceptable at today's volume, and
  isolated behind `src/lib/payments/invoicing.ts` if that changes.
