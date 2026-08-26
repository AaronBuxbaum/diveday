import { describe, expect, it } from "vitest";
import { INTEGRATION_PROVIDER_REGISTRY, listIntegrationProviders } from "./registry";

describe("integration provider registry", () => {
  it("keeps the three issue-958 providers in one public register", () => {
    expect(listIntegrationProviders().map((provider) => provider.id)).toEqual([
      "shopify",
      "quickbooks",
      "zapier",
    ]);
  });

  it("declares event ownership separately from connection type", () => {
    expect(INTEGRATION_PROVIDER_REGISTRY.shopify.eventTypes).toEqual([]);
    expect(INTEGRATION_PROVIDER_REGISTRY.quickbooks.eventTypes).toEqual([
      "order.paid",
      "order.refunded",
    ]);
    expect(INTEGRATION_PROVIDER_REGISTRY.zapier.eventTypes).toContain("order.created");
  });
});
