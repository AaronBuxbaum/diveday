# Square receipt matching

Square takes the payment. DiveDay records the purchase and can match the external receipt to it.
This connector does not take payments, refund cards, import a catalog, create customers or
silently import sales. It is not a POS.

## Activation

No Square account, application or production connection was created by this implementation.
A deployment operator must register its private Square application and supply:

- `SQUARE_CLIENT_ID` and `SQUARE_CLIENT_SECRET` for the selected environment.
- `SQUARE_ENVIRONMENT=sandbox` or `production`. Missing/unknown is disabled, not production.
- The existing `SECRET_ENCRYPTION_KEY` for sealed credentials and `APP_HOST` for redirects.

Register `${APP_HOST}/api/integrations/square/callback` as the redirect URL. Start in Sandbox.
An owner/manager uses Settings → Integrations → Connect Square, then selects one active Square
location in the shop's currency. Reconnecting clears the prior location selection so a different
merchant can never inherit it. App registration, legal agreements, credentials and production
activation remain human-controlled. Do not put any secret in a repository, fixture or issue.

The requested permissions are exactly `PAYMENTS_READ` and `MERCHANT_PROFILE_READ`. The connector
pins Square API version `2026-09-16`. It uses the existing random, hashed, single-use OAuth state
bound to the initiating staff member and shop, plus the selected environment. Tokens are sealed
at rest; a refresh updates only the still-live matching credential and cannot resurrect a
disconnected connection. See Square's [authorization flow](https://developer.squareup.com/docs/oauth-api/create-urls-for-square-authorization)
and [refresh guidance](https://developer.squareup.com/docs/oauth-api/refresh-revoke-limit-scope).

Disconnect in DiveDay stops local use and clears the stored credentials. Receipt mappings stay.
It does not revoke the merchant-wide Square authorization because another DiveDay shop may use
that same merchant. A seller can additionally revoke the app in Square, which affects all shops
using that grant.

## Daily flow

1. Record the already-paid purchase in DiveDay, including its original total, tip and any known
   included tax/pass-through amount. This is the only collection/billing event.
2. Open the purchase and use **Square receipt → Match receipt** with the Square payment ID, not
   the four-character receipt number. DiveDay verifies a completed payment using the connected
   merchant's credentials and selected location.
3. The original gross amount, original tip, currency and cumulative refund must agree. No amount
   is rounded or converted, including zero-decimal currencies. The receipt link does not infer
   tax/pass-through allocation, seat ownership or the buyer's identity.
4. A payment or purchase already linked elsewhere is refused without revealing another shop.
   Repeated matches update the observation, never the purchase or fee.
5. **Check again** reads the current receipt. A differing refund shows a warning. Return money in
   Square, record the money already returned in DiveDay, and check again. DiveDay does not issue
   or initiate a Square refund, nor assume a pending refund completed.

The [Payment object](https://developer.squareup.com/reference/square/objects/Payment) supplies
completed status, location, gross `total_money` including tips, `tip_money` and cumulative
`refunded_money`. `amount_money` alone is not the gross total. Stored evidence contains only the
provider identity, location, currency, amounts, optional short receipt number and check time.
Full payment bodies, card details, receipt URLs and contacts are deliberately discarded.
A mistaken association can be deleted and matched again. Its prior evidence remains in the
sync-map history; the purchase and billing records are untouched.

Split tenders, a single Square payment covering several DiveDay purchases, and a purchase split
between several Square payments do not qualify for this one-to-one matcher. Staff records remain
usable without a link. Neither a match nor a mismatch marks a booking paid: the booking's existing
record-payment path owns that operation and must not be duplicated with another purchase.

## Fees and country/currency

Square's application fee is supplied when an application creates/processes a payment; observing
an existing ordinary POS payment does not allow a retroactive fee. DiveDay therefore keeps its
existing 3% collection ledger and billing path, rather than attempting another Square charge.
See [application fees](https://developer.squareup.com/docs/payments-api/take-payments-and-collect-fees).

Square payment processing is available in Australia, Canada, France, Ireland, Japan, Spain,
the UK and US. A location's currency governs its payments. A read-only matcher does not expand
Square's payment availability or add currency conversion. Square application-fee collection also
has developer-account country/currency requirements, which this slice avoids.
[International development](https://developer.squareup.com/docs/international-development)
and [Locations API](https://developer.squareup.com/reference/square/locations-api/list-locations).

## Why no webhooks or order import yet

A webhook integration would need a durable inbox and reconciliation queue, not a handler that
creates a new order for every callback. Square retries unsuccessful events for up to 24 hours;
delivery is not guaranteed to be in order and may repeat. Event IDs deduplicate transport, while
merchant/environment/payment identity deduplicates the economic event. Refund and payment updates
are distinct events and cannot each create a fresh fee.
[Webhook overview](https://developer.squareup.com/docs/webhooks/overview)
and [technical reference](https://developer.squareup.com/docs/webhooks/v2webhook-events-tech-ref).

Authenticity would require HMAC-SHA256 over the configured notification URL plus exact raw body,
using the subscription signing key and constant-time comparison before parsing or mutating.
Never trust the request Host as the signing URL. No webhook endpoint or subscription is shipped.
[Signature validation](https://developer.squareup.com/docs/webhooks/step3validate).

Orders could add item/tax detail under `ORDERS_READ`, but split tender, discounts, service charges,
returns, tips and cash/external payments still need a deliberate mapping. Current OAuth does not
request that extra scope. Automatic imports require an explicit product decision on sale scope,
historical start date, match-before-create, refund allocation and which records incur billing.
[Permissions](https://developer.squareup.com/docs/oauth-api/square-permissions).

## Verification before production activation

Use sandbox fixtures to check OAuth cancellation/expired state, reconnecting another merchant,
wrong location/currency, zero-decimal currency, pending payments, reused payment IDs, partial and
full refunds, expired/revoked tokens and disconnect during a request. Confirm the collection
ledger remains byte-for-byte unchanged after matching and rechecking. A mock/unit pass does not
claim a real Square sandbox account has been exercised.
