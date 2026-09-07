import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { enqueueIntegrationEvent } from "@/db/integration-events";
import {
  consumeIntegrationOAuthState,
  createIntegrationOAuthState,
  readIntegrationCredentials,
  saveShopIntegration,
  upsertIntegrationSyncRecord,
} from "@/db/integrations";
import { people, shopIntegrations } from "@/db/schema";
import { seededShopContext } from "@/test/db";
import { deliverXeroEvent } from "./xero";

const CONFIG = { clientId: "client", clientSecret: "secret" };

type Ctx = Awaited<ReturnType<typeof seededShopContext>>["db"];

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

/** Pre-seeds the contact lookup so the only call left is the bank transaction. */
async function connectedIntegration(
  db: Ctx,
  shopId: string,
  settings: Record<string, unknown> = { salesAccountCode: "200", bankAccountCode: "090" },
) {
  const integration = await saveShopIntegration(db, {
    shopId,
    provider: "xero",
    credentials: {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.UTC(2099, 0, 1),
    },
    externalAccountId: "tenant-1",
    externalLabel: "Blue Mantis Diving",
    settings: { eventTypes: ["order.paid", "order.refunded"], ...settings },
  });
  await upsertIntegrationSyncRecord(db, {
    shopId: integration.shopId,
    provider: integration.provider,
    sourceType: "xero_contact",
    sourceId: "person-1",
    operation: "contact",
    externalId: "contact-1",
  });
  return integration;
}

async function refundEvent(
  db: Ctx,
  shopId: string,
  key: string,
  refundCents: number,
  total: number,
) {
  const event = await enqueueIntegrationEvent(db, {
    shopId,
    eventType: "order.refunded",
    entityType: "order",
    entityId: "order-1",
    idempotencyKey: key,
    payload: orderPayload(refundCents, total),
  });
  if (!event) throw new Error("event fixture failed");
  return event;
}

async function paidEvent(db: Ctx, shopId: string) {
  const event = await enqueueIntegrationEvent(db, {
    shopId,
    eventType: "order.paid",
    entityType: "order",
    entityId: "order-1",
    idempotencyKey: "order:order-1:paid",
    payload: orderPayload(0, 0),
  });
  if (!event) throw new Error("event fixture failed");
  return event;
}

function okResponse(body: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => body };
}

describe("deliverXeroEvent", () => {
  it("posts one bank transaction per refund slice, not only the first", async () => {
    const { db, shop } = await seededShopContext();
    const integration = await connectedIntegration(db, shop.id);

    const bodies: Array<{ BankTransactions: Array<{ LineItems: Array<{ UnitAmount: number }> }> }> =
      [];
    let nextId = 100;
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      nextId += 1;
      return okResponse({ BankTransactions: [{ BankTransactionID: `txn-${nextId}` }] });
    }) as unknown as typeof fetch;

    const first = await refundEvent(db, shop.id, "order:order-1:refund:5000", 5_000, 5_000);
    const second = await refundEvent(db, shop.id, "order:order-1:refund:8000", 3_000, 8_000);

    expect(await deliverXeroEvent(db, integration, first, CONFIG, fetchImpl)).toEqual({
      status: "delivered",
    });
    expect(await deliverXeroEvent(db, integration, second, CONFIG, fetchImpl)).toEqual({
      status: "delivered",
    });

    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.BankTransactions[0]?.LineItems[0]?.UnitAmount).toBe(50);
    expect(bodies[1]?.BankTransactions[0]?.LineItems[0]?.UnitAmount).toBe(30);
  });

  it("does not post twice when one event is retried", async () => {
    const { db, shop } = await seededShopContext();
    const integration = await connectedIntegration(db, shop.id);

    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return okResponse({ BankTransactions: [{ BankTransactionID: "txn-1" }] });
    }) as unknown as typeof fetch;

    const event = await paidEvent(db, shop.id);
    await deliverXeroEvent(db, integration, event, CONFIG, fetchImpl);
    await deliverXeroEvent(db, integration, event, CONFIG, fetchImpl);

    expect(calls).toBe(1);
  });

  it("sends the tenant and an idempotency key with every write", async () => {
    const { db, shop } = await seededShopContext();
    const integration = await connectedIntegration(db, shop.id);

    const headers: Array<Record<string, string>> = [];
    const fetchImpl = (async (_url: string, init: { headers: Record<string, string> }) => {
      headers.push(init.headers);
      return okResponse({ BankTransactions: [{ BankTransactionID: "txn-1" }] });
    }) as unknown as typeof fetch;

    const event = await paidEvent(db, shop.id);
    await deliverXeroEvent(db, integration, event, CONFIG, fetchImpl);

    expect(headers[0]?.["xero-tenant-id"]).toBe("tenant-1");
    expect(headers[0]?.["Idempotency-Key"]).toBe(event.id);
    expect(headers[0]?.authorization).toBe("Bearer access");
  });

  /** Settings the shop has not filled in are a refusal, never a guessed account. */
  it("refuses before calling Xero when either account code is missing", async () => {
    const { db, shop } = await seededShopContext();
    const integration = await connectedIntegration(db, shop.id, { salesAccountCode: "200" });

    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return okResponse({});
    }) as unknown as typeof fetch;

    expect(
      await deliverXeroEvent(db, integration, await paidEvent(db, shop.id), CONFIG, fetchImpl),
    ).toEqual({ status: "failed", code: "xero_account_codes_missing", retryable: false });
    expect(calls).toBe(0);
  });

  it("retries a Xero outage and gives up on a refusal", async () => {
    const { db, shop } = await seededShopContext();
    const integration = await connectedIntegration(db, shop.id);
    const event = await paidEvent(db, shop.id);

    const outage = (async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    expect(await deliverXeroEvent(db, integration, event, CONFIG, outage)).toEqual({
      status: "failed",
      code: "xero_api_unavailable",
      retryable: true,
    });

    const refused = (async () => ({
      ok: false,
      status: 400,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    expect(await deliverXeroEvent(db, integration, event, CONFIG, refused)).toEqual({
      status: "failed",
      code: "xero_api_refused",
      retryable: false,
    });
  });

  /**
   * A shop that revoked DiveDay's access in Xero, or left the connection unused
   * past its sixty-day refresh window. The 401 buys one refresh attempt; when
   * that is refused too there is nothing to retry, so the delivery fails closed
   * and the dispatcher parks the connection in `error` rather than burning
   * eight attempts against a grant that is gone.
   */
  it("stops on a revoked grant instead of retrying forever", async () => {
    const { db, shop } = await seededShopContext();
    const integration = await connectedIntegration(db, shop.id);
    const event = await paidEvent(db, shop.id);

    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      if (url.includes("identity.xero.com"))
        return { ok: false, status: 400, json: async () => ({}) };
      return { ok: false, status: 401, json: async () => ({}) };
    }) as unknown as typeof fetch;

    expect(await deliverXeroEvent(db, integration, event, CONFIG, fetchImpl)).toEqual({
      status: "failed",
      code: "xero_refresh_failed",
      retryable: false,
    });
    expect(seen.filter((url) => url.includes("identity.xero.com"))).toHaveLength(1);
  });

  /** Xero rotates the refresh token, so the rotated one has to reach the row. */
  it("stores the rotated refresh token before it retries the write", async () => {
    const { db, shop } = await seededShopContext();
    const integration = await saveShopIntegration(db, {
      shopId: shop.id,
      provider: "xero",
      credentials: { accessToken: "stale", refreshToken: "refresh-1", expiresAt: 0 },
      externalAccountId: "tenant-1",
      externalLabel: "Blue Mantis Diving",
      settings: {
        eventTypes: ["order.paid"],
        salesAccountCode: "200",
        bankAccountCode: "090",
      },
    });
    await upsertIntegrationSyncRecord(db, {
      shopId: shop.id,
      provider: "xero",
      sourceType: "xero_contact",
      sourceId: "person-1",
      operation: "contact",
      externalId: "contact-1",
    });

    const fetchImpl = (async (url: string) => {
      if (url.includes("identity.xero.com")) {
        return okResponse({
          access_token: "fresh",
          refresh_token: "refresh-2",
          expires_in: 1800,
        });
      }
      return okResponse({ BankTransactions: [{ BankTransactionID: "txn-1" }] });
    }) as unknown as typeof fetch;

    expect(
      await deliverXeroEvent(db, integration, await paidEvent(db, shop.id), CONFIG, fetchImpl),
    ).toEqual({ status: "delivered" });

    const [row] = await db
      .select()
      .from(shopIntegrations)
      .where(eq(shopIntegrations.shopId, shop.id));
    if (!row) throw new Error("expected the connection row");
    const stored = await readIntegrationCredentials(row);
    expect(stored.status).toBe("ok");
    if (stored.status !== "ok") return;
    expect(stored.credentials.refreshToken).toBe("refresh-2");
    expect(stored.credentials.accessToken).toBe("fresh");
  });
});

describe("Xero OAuth state", () => {
  it("resolves once and refuses the replay", async () => {
    const { db, shop } = await seededShopContext();
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("expected a seeded person");
    const state = await createIntegrationOAuthState(db, {
      shopId: shop.id,
      personId: person.id,
      provider: "xero",
    });

    expect(await consumeIntegrationOAuthState(db, { state, provider: "xero" })).toMatchObject({
      shopId: shop.id,
      personId: person.id,
      provider: "xero",
    });
    expect(await consumeIntegrationOAuthState(db, { state, provider: "xero" })).toBeNull();
  });

  /** The callback URL names its provider; one provider's state must not open another's. */
  it("does not resolve against the QuickBooks callback", async () => {
    const { db, shop } = await seededShopContext();
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("expected a seeded person");
    const state = await createIntegrationOAuthState(db, {
      shopId: shop.id,
      personId: person.id,
      provider: "xero",
    });
    expect(await consumeIntegrationOAuthState(db, { state, provider: "quickbooks" })).toBeNull();
    expect(await consumeIntegrationOAuthState(db, { state, provider: "xero" })).not.toBeNull();
  });
});
