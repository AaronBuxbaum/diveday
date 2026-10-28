import { describe, expect, it, vi } from "vitest";
import { enqueueIntegrationEvent } from "@/db/integration-events";
import { saveShopIntegration, upsertIntegrationSyncRecord } from "@/db/integrations";
import { fileScopedShopContext, type seededShopContext } from "@/test/db";
import { IntegrationDeliveryDeadlineError } from "./delivery-deadline";
import { deliverQuickBooksEvent } from "./quickbooks";

const ctx = fileScopedShopContext();

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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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

  it("stops before the next QuickBooks request when a response body ignores the deadline", async () => {
    const { db, shop } = ctx;
    const integration = await connectedIntegration(db, shop.id);
    const event = await enqueueIntegrationEvent(db, {
      shopId: shop.id,
      eventType: "order.refunded",
      entityType: "order",
      entityId: "order-1",
      idempotencyKey: "order:order-1:refund:deadline",
      payload: orderPayload(1_000, 1_000),
    });
    if (!event) throw new Error("event fixture failed");

    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      setTimeout(() => controller.abort(), 5);
      return {
        ok: true,
        status: 200,
        json: () => new Promise(() => {}),
      } as Response;
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await expect(
      deliverQuickBooksEvent(db, integration, event, CONFIG, fetchImpl, controller.signal),
    ).rejects.toThrow("Integration delivery deadline exceeded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a retryable failure when token refresh hits its request timeout", async () => {
    const { db, shop } = ctx;
    const connected = await connectedIntegration(db, shop.id);
    const expired = await saveShopIntegration(db, {
      shopId: shop.id,
      provider: "quickbooks",
      credentials: { accessToken: "expired", refreshToken: "refresh", expiresAt: 0 },
      externalAccountId: connected.externalAccountId,
      externalLabel: connected.externalLabel,
      settings: connected.settings,
    });
    const event = await enqueueIntegrationEvent(db, {
      shopId: shop.id,
      eventType: "order.refunded",
      entityType: "order",
      entityId: "order-1",
      idempotencyKey: "order:order-1:refund:refresh-timeout",
      payload: orderPayload(1_000, 1_000),
    });
    if (!event) throw new Error("event fixture failed");

    const fetchMock = vi.fn(async () => {
      throw new IntegrationDeliveryDeadlineError();
    });
    const result = await deliverQuickBooksEvent(
      db,
      expired,
      event,
      CONFIG,
      fetchMock as unknown as typeof fetch,
    );

    expect(result).toEqual({
      status: "failed",
      code: "quickbooks_refresh_timeout",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * A voided order takes its sale back off the books (issue #2309). QuickBooks
 * voids a sales receipt in place: read its SyncToken, then post
 * `operation=void`.
 */
describe("deliverQuickBooksEvent — voids", () => {
  async function voidEvent(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    shopId: string,
  ) {
    const event = await enqueueIntegrationEvent(db, {
      shopId,
      eventType: "order.voided",
      entityType: "order",
      entityId: "order-1",
      idempotencyKey: "order:order-1:void",
      payload: { ...orderPayload(0, 0), status: "void" },
    });
    if (!event) throw new Error("event fixture failed");
    return event;
  }

  function recordingFetch() {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init: { method: string; body?: string }) => {
      calls.push({
        url,
        method: init.method,
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ SalesReceipt: { Id: "55", SyncToken: "3" } }),
      };
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("voids the sales receipt it booked, once", async () => {
    const { db, shop } = ctx;
    const integration = await connectedIntegration(db, shop.id);
    await upsertIntegrationSyncRecord(db, {
      shopId: shop.id,
      provider: "quickbooks",
      sourceType: "quickbooks_order",
      sourceId: "order-1",
      operation: "sales_receipt",
      externalId: "55",
    });
    const event = await voidEvent(db, shop.id);
    const { calls, fetchImpl } = recordingFetch();

    expect(await deliverQuickBooksEvent(db, integration, event, CONFIG, fetchImpl)).toEqual({
      status: "delivered",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toContain("/v3/company/9130350000000000/salesreceipt/55?");
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.url).toContain("/salesreceipt?operation=void&");
    expect(calls[1]?.body).toEqual({ Id: "55", SyncToken: "3", sparse: true });

    // A redelivered void is a no-op.
    await deliverQuickBooksEvent(db, integration, event, CONFIG, fetchImpl);
    expect(calls).toHaveLength(2);
  });

  it("does nothing for an order it never booked", async () => {
    const { db, shop } = ctx;
    const integration = await connectedIntegration(db, shop.id);
    const { calls, fetchImpl } = recordingFetch();
    expect(
      await deliverQuickBooksEvent(
        db,
        integration,
        await voidEvent(db, shop.id),
        CONFIG,
        fetchImpl,
      ),
    ).toEqual({ status: "delivered" });
    expect(calls).toHaveLength(0);
  });

  it("does not book a sale whose void is already queued", async () => {
    const { db, shop } = ctx;
    const integration = await connectedIntegration(db, shop.id);
    const paid = await enqueueIntegrationEvent(db, {
      shopId: shop.id,
      eventType: "order.paid",
      entityType: "order",
      entityId: "order-1",
      idempotencyKey: "order:order-1:paid",
      payload: orderPayload(0, 0),
    });
    if (!paid) throw new Error("event fixture failed");
    const voided = await voidEvent(db, shop.id);
    const { calls, fetchImpl } = recordingFetch();

    // The void delivered first (the paid one was still retrying): nothing booked, nothing to undo.
    await deliverQuickBooksEvent(db, integration, voided, CONFIG, fetchImpl);
    expect(await deliverQuickBooksEvent(db, integration, paid, CONFIG, fetchImpl)).toEqual({
      status: "delivered",
    });
    expect(calls).toHaveLength(0);
  });
});
