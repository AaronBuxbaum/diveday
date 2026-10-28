# integrations

Shop-owned Shopify, QuickBooks Online, and Zapier connections.

The provider register in `registry.ts` is the extension point for future
integrations. Each provider gets one definition, one credential/API handler,
and one settings action surface. Connection rows, encrypted credentials,
OAuth state, order events, retries, and sync mappings stay provider-agnostic
in `src/db/schema/` and the integration database modules.

## Safety contract

- OAuth state is one-time and only its SHA-256 digest is stored.
- Provider credentials and Zapier webhook URLs are sealed with
  `SECRET_ENCRYPTION_KEY` before persistence.
- Paid/refunded order events are written in the same transaction as the order
  change, with an idempotency key and retryable delivery row. A completed online
  checkout, a paid tip and a checkout refund travel the same way, as
  `order.paid`/`order.refunded` with `entityType` `checkout` or `tip`: one
  receipt per checkout, a tip on its own line
  (`docs/architecture/decisions/20261014-checkouts-reach-integrations.md`).
- The cron dispatcher claims deliveries conditionally so concurrent workers do
  not send the same delivery twice.
- The settings projection never returns `credentials_sealed`.

Shopify syncs priced rental/package catalog items on demand. QuickBooks writes
idempotent SalesReceipts and RefundReceipts for paid/refunded orders.
Zapier posts selected order events to a Catch Hook URL.

Calling a provider's API at all is governed by
`docs/architecture/decisions/20260827-shop-authorized-provider-connectors.md`,
which supersedes the earlier emit-only rule. Two constraints from it bind every
adapter here: a connector may push DiveDay's own facts out and read back only
what keeps that push idempotent — never a provider's data as truth — and no app
registered for these connectors is submitted to a public app directory. A further
provider is a new ADR, not just a new file. Xero was one and was removed
before launch; it can return by reverting that commit
(`docs/architecture/decisions/20261017-xero-removed-before-launch.md`).

## Deployment configuration

All three providers are optional. The shared `SECRET_ENCRYPTION_KEY` must be a
base64-encoded 32-byte key before any credentials can be saved. Configure the
provider app credentials only for the providers a deployment offers:

- Shopify: `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, and optionally
  `SHOPIFY_API_VERSION`. Register `/api/integrations/shopify/callback` as the
  app's redirect path under the deployment's `APP_HOST`.
- QuickBooks Online: `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, and
  optionally `QUICKBOOKS_ENVIRONMENT=sandbox`. Register
  `/api/integrations/quickbooks/callback` as the redirect path.
- Zapier: no app client secret is needed; a shop pastes its HTTPS Catch Hook
  URL in Settings. `APP_HOST` is still used for the OAuth redirect URLs above.

The hourly integration dispatcher is scheduled at
`/api/cron/integrations` and uses the deployment's normal `CRON_SECRET`. A cron pass admits work
for at most four minutes, with a one-minute ceiling per delivery; writes also dispatch after the
response with a fifteen-second budget. Timed-out provider work follows the normal retry path.
