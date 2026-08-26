# integrations

Shop-owned Shopify, QuickBooks Online, and Zapier connections.

The provider register in `registry.ts` is the extension point for future
integrations. Each provider gets one definition, one credential/API handler,
and one settings action surface. Connection rows, encrypted credentials,
OAuth state, order events, retries, and sync mappings stay provider-agnostic
in `src/db/schema.ts` and the integration database modules.

## Safety contract

- OAuth state is one-time and only its SHA-256 digest is stored.
- Provider credentials and Zapier webhook URLs are sealed with
  `SECRET_ENCRYPTION_KEY` before persistence.
- Paid/refunded order events are written in the same transaction as the order
  change, with an idempotency key and retryable delivery row.
- The cron dispatcher claims deliveries conditionally so concurrent workers do
  not send the same delivery twice.
- The settings projection never returns `credentials_sealed`.

Shopify syncs priced rental/package catalog items on demand. QuickBooks writes
idempotent SalesReceipts and RefundReceipts for paid/refunded orders. Zapier
posts selected order events to a Catch Hook URL.

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

The ten-minute integration dispatcher is scheduled at
`/api/cron/integrations` and uses the deployment's normal `CRON_SECRET`.
