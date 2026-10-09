# 20261009-demo-test-mode-payments — The canonical demo takes a card at booking, in Stripe test mode

- **Status:** Accepted
- **Date:** 2026-10-09
- **Amends:** [20260719-stripe-connect-orders](20260719-stripe-connect-orders.md) (which key a call uses)

## Context

The online booking and payments feature pages say a diver pays when they book, into the shop's
own Stripe account, with rental gear and a nitrox request in the same step (issue #2094). That is
true for a connected shop and could not be checked in the demo: Blue Mantis has no Stripe
connection, so `canAcceptPayments` is false and its public trip pages offer "Book these spots"
with no price at the button, no gear or nitrox fields and no payment step. The marketing claims
policy asks that every claim can be checked in the demo.

The product owner chose the first of the issue's three options: connect the demo to a Stripe
test-mode account, so the real flow runs end to end. Not a drawn payment step only the demo
renders (a second path), and not a note saying the demo takes no payment.

One constraint shapes everything below. In production `STRIPE_SECRET_KEY` is a live key, and a
platform's live key acting on a connected account moves real money. Test mode is a property of the
key, not of the account, so the demo needs the platform's **test-mode** key for every call about
its account, and must never be called with the live one.

## Decision

- **Two variables name the demo's connection**: `STRIPE_DEMO_ACCOUNT_ID` (an `acct_` id the
  founder connects to the platform in test mode) and `STRIPE_DEMO_SECRET_KEY` (the platform's
  test-mode secret or restricted key, `sk_test_` or `rk_test_` only). Both, valid, or neither
  (`demoStripeAccount`, `src/lib/payments/stripe-keys.ts`). Registered in
  `config/env-registry.mjs` with `STRIPE_TEST_WEBHOOK_SECRET`, which the webhook already read and
  the registry had never listed.
- **The key follows the account and who holds it.** Every Stripe call on a connected account
  already names the account, so the checkout, promotion, invoicing and customer providers ask
  `stripeSecretKeyFor` for the key per call, with the account's holder as the database says
  (`stripeAccountHolder`, read only when it changes the answer): the demo's account gets the
  test-mode key, and only while the canonical demo (`DEMO_SHOP_SLUG` with `is_demo`) holds it;
  held by any other shop, or by none, it gets no key. A demo shop's any other account never gets
  a live platform key, only one that is itself plainly test mode (a workstation). Every other
  account gets the platform key. There is no second payment path: the demo runs the same booking
  action, the same checkout session, the same webhook and the same settlement as any connected
  shop.
- **A demo shop a live key would reach offers no payment.** `getShopStripeAccount` and
  `getShopStripeAccountByAccountId` read a demo shop's row as absent unless `mayOfferPayment`
  allows it (the canonical demo on the configured account, or no live key configured at all), so
  `canAcceptPayments` is false for it on every surface.
- **The connection is configuration, only on the canonical demo.** `syncDemoStripeAccount`
  (`src/db/stripe-accounts.ts`) writes a connected, charges-enabled row for the shop at
  `DEMO_SHOP_SLUG` with `is_demo`, and removes it when the pair is gone. It runs in the seed, in
  every demo reset (which clears the shop's Stripe row with its other settings) and in the nightly
  demo refresh, so configuring the pair connects the demo by the next morning. A real shop is never
  touched, a minted demo never holds the account (the unique index on `stripe_account_id`), and an
  account another shop already holds is left there and logged.
- **The demo's settings cannot disconnect or refresh it.** Anyone can be a demo's owner;
  disconnecting would deauthorize the account from the platform for everybody, and a refresh would
  read it with the live key. Both actions answer "The demo stays connected to Stripe in test mode."
  on a demo shop. The OAuth callback already refused to connect a demo.
- **Test-mode webhooks on a deployment that takes real money touch only the demo.** Any one sign
  counts: a live webhook secret configured, a live platform key, or Vercel's production
  environment, not the key's prefix alone. There, an event verified by
  `STRIPE_TEST_WEBHOOK_SECRET` is acted on only if its account is the demo's and the canonical demo
  holds it. A deployment that is test mode throughout is unchanged.
- **The visitor is told which card to use.** Under the pay button, where a connected shop's page
  says the diver finishes on a Stripe page, the demo's says Stripe is in test mode, names the
  4242 test card and says nothing is charged. Shown only when the account really is the
  configured test-mode one (`isDemoTestModeAccount`).
- **The shared demo's booking form says it is shared.** Under the button, with the cancellation
  window (`BookingFinePrint`), the canonical demo says anyone trying it can see what is typed there.
  A visitor's own minted demo does not.
- **Without the variables nothing changes**: no row, and the demo books without payment as before.
  The e2e fleet sets neither, and reaches the paying surfaces through
  `/api/test/seed-stripe-account` as it already did.

## Alternatives considered

- **A drawn checkout only the demo renders.** A second code path that proves nothing about the
  first; ruled out in the issue and by the owner.
- **Keying the choice on `shops.is_demo`.** Every minted demo would then be called with the test
  key against an account it cannot hold. The account is what Stripe acts on, so the account is the
  key's selector.
- **Running the whole platform in test mode.** Real shops take real money.

## Consequences

- One human step remains, outside the repository: create (or pick) a Stripe account, connect it to
  the platform in test mode, and set `STRIPE_DEMO_ACCOUNT_ID`, `STRIPE_DEMO_SECRET_KEY` and the
  test-mode `STRIPE_TEST_WEBHOOK_SECRET` (a test-mode endpoint at `/api/webhooks/stripe` listening
  to connected accounts) on the production deployment.
- The demo's paid bookings are test-mode orders in the demo's own tables, reset with the rest of
  the demo. Refund and void stay disabled on a demo shop, as before.
- A visitor can complete a test checkout without a card of their own. Each one is a test-mode
  session on DiveDay's test account; nothing reaches any real person's money.
