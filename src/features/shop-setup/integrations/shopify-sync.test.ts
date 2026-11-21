import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { shops } from "../../../db/schema/index";
import { fileScopedShopContext } from "../../../test/db";
import { syncShopifyCatalog } from "./shopify";
import {
  getIntegrationSyncRecord,
  getShopIntegration,
  recordShopIntegration,
  upsertIntegrationSyncRecord,
} from "./store";

const ctx = fileScopedShopContext();
const config = { clientId: "client", clientSecret: "secret", apiVersion: "2026-07" };
const KINDS = ["bcd", "regulator", "wetsuit", "fins", "mask"] as const;

async function connectedShop() {
  const { db, shop } = ctx;
  await db
    .update(shops)
    .set({
      rentalItems: [...KINDS],
      rentalPricing: {
        setCents: null,
        nitroxCents: null,
        perItemCents: Object.fromEntries(KINDS.map((kind) => [kind, 1000])),
      },
    })
    .where(eq(shops.id, shop.id));
  await recordShopIntegration(db, {
    shopId: shop.id,
    provider: "shopify",
    credentials: { accessToken: "token", shopDomain: "reef.myshopify.com" },
  });
  return { db, shop };
}

/** Answers every productSet; the nth call (1-based) in `failing` is refused. */
function shopifyFetch(failing: Record<number, "refused" | "user_errors">) {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    const mode = failing[call];
    if (mode === "refused") return new Response("nope", { status: 500 });
    const body = {
      data: {
        productSet: {
          product: { id: `gid://shopify/Product/${call}` },
          userErrors: mode === "user_errors" ? [{ message: "bad" }] : [],
        },
      },
    };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("syncing the Shopify catalog", () => {
  it("keeps syncing after one item fails and reports the partial result", async () => {
    const { db, shop } = await connectedShop();
    const fetchImpl = shopifyFetch({ 2: "refused" });

    const result = await syncShopifyCatalog(db, shop.id, config, fetchImpl);

    const total = vi.mocked(fetchImpl).mock.calls.length;
    expect(total).toBeGreaterThanOrEqual(5);
    expect(result).toEqual({ synced: total - 1, failed: 1, firstError: "shopify_api_refused" });
    const stored = await Promise.all(
      KINDS.map((kind) =>
        getIntegrationSyncRecord(db, {
          shopId: shop.id,
          provider: "shopify",
          sourceType: "rental",
          sourceId: kind,
          operation: "catalog_product",
        }),
      ),
    );
    expect(stored.map((row) => row !== null)).toEqual([true, false, true, true, true]);
    expect(await getShopIntegration(db, shop.id, "shopify")).toMatchObject({
      status: "error",
      lastError: `shopify_partial_sync: 1 of ${total} failed, first shopify_api_refused`,
    });
  });

  it("marks the integration healthy when every item syncs", async () => {
    const { db, shop } = await connectedShop();
    const fetchImpl = shopifyFetch({});
    const result = await syncShopifyCatalog(db, shop.id, config, fetchImpl);
    expect(result).toEqual({
      synced: vi.mocked(fetchImpl).mock.calls.length,
      failed: 0,
      firstError: null,
    });
    expect(await getShopIntegration(db, shop.id, "shopify")).toMatchObject({
      status: "connected",
      lastError: null,
    });
  });

  it("counts a product the shop refused with user errors as failed, not synced", async () => {
    const { db, shop } = await connectedShop();
    const fetchImpl = shopifyFetch({ 1: "user_errors" });
    const result = await syncShopifyCatalog(db, shop.id, config, fetchImpl);
    expect(result).toMatchObject({
      synced: vi.mocked(fetchImpl).mock.calls.length - 1,
      failed: 1,
      firstError: "shopify_product_sync_failed",
    });
  });

  it("updates a mapped product in place, reading the mappings once", async () => {
    const { db, shop } = await connectedShop();
    await upsertIntegrationSyncRecord(db, {
      shopId: shop.id,
      provider: "shopify",
      sourceType: "rental",
      sourceId: "bcd",
      operation: "catalog_product",
      externalId: "gid://shopify/Product/existing",
    });
    const fetchImpl = shopifyFetch({});
    await syncShopifyCatalog(db, shop.id, config, fetchImpl);
    const first = vi.mocked(fetchImpl).mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(first.body).variables.identifier).toEqual({
      id: "gid://shopify/Product/existing",
    });
  });
});
