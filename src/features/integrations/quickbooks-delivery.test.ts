import { describe, expect, it } from "vitest";
import { enqueueIntegrationEvent } from "@/db/integration-events";
import { saveShopIntegration, upsertIntegrationSyncRecord } from "@/db/integrations";
import { seededShopContext } from "@/test/db";
import { deliverQuickBooksEvent } from "./quickbooks";

const CONFIG = {
  clientId: "client",
  clientSecret: "secret",
  environment: "sandbox" as const,
};

function orderPayload(refundCents: number, refundedCents: number) {
  return {
    orderId: "order-1",
    customer: { id: "person-1", name: "Diver One", email: "diver@example.test" },
    currency: "usd",
    totalCents: 20_000,
    refundedCents,
    refundCents,
    createdAt: "2026-08-25T12:00:00.000Z",
    lineItems: [{ description: "Two-tank reef", quantity: 1, unitAmountCents: 20_000 }],
  };
}

/** Pre-seeds the customer and item lookups so the only call left is the receipt. */
async function connectedIntegration(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
) {
  const integration = await saveShopIntegration(db, {
    shopId,
    provider: "quickbooks",
    credentials: {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.UTC(2099, 0, 1),
    },
    externalAccountId: "9130350000000000",
    externalLabel: "QuickBooks 9130350000000000",
    settings: { environment: "sandbox", incomeAccountId: "79", eventTypes: ["order.refunded"] },
  });
  for (const [sourceType, sourceId, operation, externalId] of [
    ["quickbooks_customer", "person-1", "customer", "7"],
    ["quickbooks_item", "diveday-sales", "item", "42"],
  ] as const) {
    await upsertIntegrationSyncRecord(db, {
      shopId: integration.shopId,
      provider: integration.provider,
      sourceType,
      sourceId,
      operation,
      externalId,
    });
  }
  return integration;
}

describe("deliverQuickBooksEvent — refund receipts", () => {
  /**
   * `partly_refunded -> partly_refunded` is a supported transition (issue
   * #699), so an order can be refunded in slices, and `refundOrder` emits one
   * event per slice carrying that slice's delta. The delivery guard used to be
   * keyed on the order, so the second slice matched the first slice's sync
   * record and was closed as "delivered" with no API call and no error --
   * QuickBooks kept $50 of an $80 refund and nothing in the app said so.
   */
  it("posts a receipt for every refund slice, not only the first", async () => {
    const { db, shop } = await seededShopContext();
    const integration = await connectedIntegration(db, shop.id);

    const bodies: unknown[] = [];
    let nextId = 100;
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      nextId += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ RefundReceipt: { Id: String(nextId) } }),
      };
    }) as unknown as typeof fetch;

    const first = await enqueueIntegrationEvent(db, {
      shopId: shop.id,
      eventType: "order.refunded",
      entityType: "order",
      entityId: "order-1",
      idempotencyKey: "order:order-1:refund:5000",
      payload: orderPayload(5_000, 5_000),
    });
    const second = await enqueueIntegrationEvent(db, {
      shopId: shop.id,
      eventType: "order.refunded",
      entityType: "order",
      entityId: "order-1",
      idempotencyKey: "order:order-1:refund:8000",
      payload: orderPayload(3_000, 8_000),
    });
    if (!first || !second) throw new Error("event fixture failed");

    expect(await deliverQuickBooksEvent(db, integration, first, CONFIG, fetchImpl)).toEqual({
      status: "delivered",
    });
    expect(await deliverQuickBooksEvent(db, integration, second, CONFIG, fetchImpl)).toEqual({
      status: "delivered",
    });

    // Two receipts, each for its own slice: $50 then $30, never $50 then nothing.
    expect(bodies).toHaveLength(2);
    expect((bodies[0] as { Line: Array<{ Amount: number }> }).Line[0]?.Amount).toBe(50);
    expect((bodies[1] as { Line: Array<{ Amount: number }> }).Line[0]?.Amount).toBe(30);
  });

  /** The same event redelivered is still exactly one receipt. */
  it("does not post twice when one refund event is retried", async () => {
    const { db, shop } = await seededShopContext();
    const integration = await connectedIntegration(db, shop.id);

    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ RefundReceipt: { Id: "101" } }) };
    }) as unknown as typeof fetch;

    const event = await enqueueIntegrationEvent(db, {
      shopId: shop.id,
      eventType: "order.refunded",
      entityType: "order",
      entityId: "order-1",
      idempotencyKey: "order:order-1:refund:5000",
      payload: orderPayload(5_000, 5_000),
    });
    if (!event) throw new Error("event fixture failed");

    await deliverQuickBooksEvent(db, integration, event, CONFIG, fetchImpl);
    await deliverQuickBooksEvent(db, integration, event, CONFIG, fetchImpl);

    expect(calls).toBe(1);
  });

  /** A sales receipt is genuinely once per order, and stays that way. */
  it("still posts one sales receipt per order", async () => {
    const { db, shop } = await seededShopContext();
    const integration = await connectedIntegration(db, shop.id);

    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ SalesReceipt: { Id: "201" } }) };
    }) as unknown as typeof fetch;

    const event = await enqueueIntegrationEvent(db, {
      shopId: shop.id,
      eventType: "order.paid",
      entityType: "order",
      entityId: "order-1",
      idempotencyKey: "order:order-1:paid",
      payload: orderPayload(0, 0),
    });
    if (!event) throw new Error("event fixture failed");

    await deliverQuickBooksEvent(db, integration, event, CONFIG, fetchImpl);
    await deliverQuickBooksEvent(db, integration, event, CONFIG, fetchImpl);

    expect(calls).toBe(1);
  });
});
