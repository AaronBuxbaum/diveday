import type { IntegrationProvider } from "@/db/schema";

export type IntegrationEventType = "order.created" | "order.paid" | "order.refunded";

export type IntegrationCapability = "catalog_sync" | "accounting_export" | "outbound_events";

export type IntegrationProviderDefinition = {
  id: IntegrationProvider;
  labelKey: string;
  connection: "oauth" | "webhook";
  capabilities: readonly IntegrationCapability[];
  eventTypes: readonly IntegrationEventType[];
};

/**
 * The provider register is the extension point for future integrations. The
 * database stores the provider id, while this immutable map describes what a
 * provider can do and which events should fan out to it.
 */
export const INTEGRATION_PROVIDER_REGISTRY = {
  shopify: {
    id: "shopify",
    labelKey: "integrations.shopify.name",
    connection: "oauth",
    capabilities: ["catalog_sync"],
    eventTypes: [],
  },
  quickbooks: {
    id: "quickbooks",
    labelKey: "integrations.quickbooks.name",
    connection: "oauth",
    capabilities: ["accounting_export"],
    eventTypes: ["order.paid", "order.refunded"],
  },
  zapier: {
    id: "zapier",
    labelKey: "integrations.zapier.name",
    connection: "webhook",
    capabilities: ["outbound_events"],
    eventTypes: ["order.created", "order.paid", "order.refunded"],
  },
} as const satisfies Record<IntegrationProvider, IntegrationProviderDefinition>;

export const INTEGRATION_PROVIDER_IDS = Object.keys(
  INTEGRATION_PROVIDER_REGISTRY,
) as IntegrationProvider[];

export function integrationProviderDefinition(provider: IntegrationProvider) {
  return INTEGRATION_PROVIDER_REGISTRY[provider];
}

export function listIntegrationProviders() {
  return INTEGRATION_PROVIDER_IDS.map((id) => INTEGRATION_PROVIDER_REGISTRY[id]);
}
