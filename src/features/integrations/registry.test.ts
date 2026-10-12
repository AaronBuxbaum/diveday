import { describe, expect, it } from "vitest";
import { INTEGRATION_PROVIDER_REGISTRY, listIntegrationProviders } from "./registry";

describe("integration provider registry", () => {
  it("keeps every provider in one public register", () => {
    expect(listIntegrationProviders().map((provider) => provider.id)).toEqual([
      "shopify",
      "quickbooks",
      "xero",
      "zapier",
    ]);
  });

  it("declares event ownership separately from connection type", () => {
    expect(INTEGRATION_PROVIDER_REGISTRY.shopify.eventTypes).toEqual([]);
    for (const provider of ["quickbooks", "xero"] as const) {
      expect(INTEGRATION_PROVIDER_REGISTRY[provider].eventTypes).toEqual([
        "order.paid",
        "order.refunded",
        "order.voided",
      ]);
    }
    expect(INTEGRATION_PROVIDER_REGISTRY.zapier.eventTypes).toContain("order.created");
  });
});
