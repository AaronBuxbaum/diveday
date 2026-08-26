import { describe, expect, it } from "vitest";
import {
  buildShopifyCatalog,
  normalizeShopifyDomain,
  shopifyAuthorizationUrl,
  shopifyProductSetVariables,
} from "./shopify";

describe("Shopify integration", () => {
  it("accepts only canonical myshopify domains", () => {
    expect(normalizeShopifyDomain("https://reef-shop.myshopify.com/")).toBe(
      "reef-shop.myshopify.com",
    );
    expect(normalizeShopifyDomain("https://127.0.0.1/admin")).toBeNull();
    expect(normalizeShopifyDomain("evil.myshopify.com.attacker.test")).toBeNull();
  });

  it("builds a state-bearing OAuth URL", () => {
    const url = new URL(
      shopifyAuthorizationUrl({
        config: { clientId: "client", clientSecret: "secret", apiVersion: "2026-07" },
        shopDomain: "reef-shop.myshopify.com",
        state: "opaque-state",
        redirectUri: "https://dive.day/api/integrations/shopify/callback",
      }),
    );
    expect(url.hostname).toBe("reef-shop.myshopify.com");
    expect(url.searchParams.get("state")).toBe("opaque-state");
    expect(url.searchParams.get("scope")).toBe("write_products");
  });

  it("maps only priced rentals and active packages into managed products", () => {
    const catalog = buildShopifyCatalog({
      rentalItems: ["bcd", "gopro", "nitrox"],
      rentalPricing: { setCents: null, perItemCents: { bcd: 2500, gopro: 1000 }, nitroxCents: 800 },
      packages: [{ id: "pkg-1", name: "Ten dives", priceCents: 90000, diveCount: 10 }],
    });
    expect(catalog.map((item) => `${item.sourceType}:${item.sourceId}`)).toEqual([
      "rental:bcd",
      "rental:gopro",
      "rental:nitrox",
      "package:pkg-1",
    ]);
  });

  it("uses currency-aware major units and escapes descriptions", () => {
    const variables = shopifyProductSetVariables(
      {
        sourceType: "package",
        sourceId: "pkg-1",
        title: "Ten dives",
        description: "<unsafe>",
        priceCents: 5000,
      },
      "jpy",
      "gid://shopify/Product/1",
    );
    expect(variables.identifier).toEqual({ id: "gid://shopify/Product/1" });
    expect(
      (variables.productSet as { variants: Array<{ price: number }>; descriptionHtml: string })
        .variants[0]?.price,
    ).toBe(5000);
    expect((variables.productSet as { descriptionHtml: string }).descriptionHtml).toContain(
      "&lt;unsafe&gt;",
    );
  });
});
