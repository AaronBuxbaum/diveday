/**
 * Provider registry and connection contract for shop-owned integrations.
 *
 * Routes and settings import this file only. Provider modules can change their
 * API details without turning every future connection surface into a custom
 * set of database, OAuth, and retry rules.
 */

export {
  dispatchIntegrationsAfterResponse,
  WRITE_PATH_DISPATCH_BUDGET_MS,
  WRITE_PATH_DISPATCH_LIMIT,
} from "./dispatch-on-write";
export {
  dispatchDueIntegrationDeliveries,
  INTEGRATIONS_CRON_BUDGET_MS,
  INTEGRATIONS_CRON_CRONTAB,
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
  consumeIntegrationOAuthState,
  createIntegrationOAuthState,
  disconnectShopIntegration,
  editShopIntegrationSettings,
  getShopIntegration,
  type IntegrationCredentialResult,
  type IntegrationKeyRefusal,
  listShopIntegrations,
  readIntegrationCredentials,
  recordShopIntegration,
} from "./store";
export {
  deliverZapierEvent,
  normalizeZapierEventTypes,
  normalizeZapierWebhookUrl,
  sendZapierTest,
  type ZapierCredentials,
} from "./zapier";

import type { IntegrationProvider } from "@/db/schema";

export function integrationCallbackUrl(appHost: string, provider: IntegrationProvider): string {
  return new URL(`/api/integrations/${provider}/callback`, `${appHost}/`).toString();
}

export { getIntegrationSettingsPage, INTEGRATION_SETTINGS_GATE } from "./settings-page.store";
export {
  exchangeSquareCode,
  squareAuthorizationUrl,
  squareConfigFromEnvironment,
} from "./square-api";
export type { SquareReceiptResult } from "./square-store";
export {
  chooseSquareLocation,
  getSquareReceiptState,
  linkSquareReceipt,
  releaseSquareReceipt,
  squareLocationsForShop,
} from "./square-store";
export type { IntegrationSyncKey } from "./store";
export {
  getIntegrationSyncRecord,
  markIntegrationError,
  markIntegrationHealthy,
  upsertIntegrationSyncRecord,
} from "./store";
export { listIntegrationSummaries } from "./summaries";
