/**
 * Provider registry and connection contract for shop-owned integrations.
 *
 * Routes and settings import this file only. Provider modules can change their
 * API details without turning every future connection surface into a custom
 * set of database, OAuth, and retry rules.
 */

export {
  consumeIntegrationOAuthState,
  createIntegrationOAuthState,
  disconnectShopIntegration,
  getShopIntegration,
  type IntegrationCredentialResult,
  type IntegrationKeyRefusal,
  listShopIntegrations,
  readIntegrationCredentials,
  saveShopIntegration,
  updateShopIntegrationSettings,
} from "@/db/integrations";
export {
  dispatchDueIntegrationDeliveries,
  type IntegrationDispatchSummary,
} from "./dispatcher";
export {
  deliverQuickBooksEvent,
  exchangeQuickBooksCode,
  type QuickBooksConfig,
  type QuickBooksCredentials,
  quickBooksAuthorizationUrl,
  quickBooksConfigFromEnvironment,
  quickBooksRefundReceipt,
  quickBooksSalesReceipt,
} from "./quickbooks";
export {
  INTEGRATION_PROVIDER_IDS,
  INTEGRATION_PROVIDER_REGISTRY,
  type IntegrationCapability,
  type IntegrationEventType,
  type IntegrationProviderDefinition,
  integrationProviderDefinition,
  listIntegrationProviders,
} from "./registry";
export {
  buildShopifyCatalog,
  exchangeShopifyCode,
  normalizeShopifyDomain,
  type ShopifyCatalogItem,
  type ShopifyConfig,
  type ShopifyCredentials,
  shopifyAuthorizationUrl,
  shopifyConfigFromEnvironment,
  shopifyProductSetVariables,
  syncShopifyCatalog,
} from "./shopify";
export {
  deliverZapierEvent,
  normalizeZapierEventTypes,
  normalizeZapierWebhookUrl,
  sendZapierTest,
  type ZapierCredentials,
} from "./zapier";

import type { DbExecutor } from "@/db/client";
import { listShopIntegrations } from "@/db/integrations";
import type { IntegrationProvider } from "@/db/schema";

export function integrationCallbackUrl(appHost: string, provider: IntegrationProvider): string {
  return new URL(`/api/integrations/${provider}/callback`, `${appHost}/`).toString();
}

/** Safe settings projection: credentials_sealed never crosses the feature boundary to the UI. */
export async function listIntegrationSummaries(db: DbExecutor, shopId: string) {
  const rows = await listShopIntegrations(db, shopId);
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    status: row.status,
    externalAccountId: row.externalAccountId,
    externalLabel: row.externalLabel,
    settings: row.settings,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt,
  }));
}
