import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { enqueueIntegrationEvent } from "./integration-events";
import {
  consumeIntegrationOAuthState,
  createIntegrationOAuthState,
  disconnectShopIntegration,
  getIntegrationSyncRecord,
  getShopIntegration,
  listShopIntegrations,
  readIntegrationCredentials,
  saveShopIntegration,
  upsertIntegrationSyncRecord,
} from "./integrations";
import {
  integrationDeliveries,
  integrationOauthStates,
  integrationSyncRecords,
  people,
  shopIntegrations,
} from "./schema";

async function aPerson(db: Awaited<ReturnType<typeof seededShopContext>>["db"], shopId: string) {
  const [person] = await db.select().from(people).where(eq(people.shopId, shopId)).limit(1);
  if (!person) throw new Error("expected a seeded person");
  return person;
}

function credentials(token: string) {
  return { accessToken: token, refreshToken: "refresh", expiresAt: Date.UTC(2099, 0, 1) };
}

async function connectQuickBooks(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  token = "access-1",
) {
  return saveShopIntegration(db, {
    shopId,
    provider: "quickbooks",
    credentials: credentials(token),
    externalAccountId: "9130350000000000",
    settings: { incomeAccountId: "79", eventTypes: ["order.paid"] },
  });
}

/**
 * Issue #1015. Disconnect used to be a plain `DELETE`, and two `ON DELETE
 * CASCADE` children went with it — the undelivered outbox, and the sync records
 * that are the *only* thing stopping `ensureQuickBooksCustomer` creating a
 * second QuickBooks Customer for a diver it has already synced. A shop taps
 * Disconnect exactly when a token has errored, so the reconnect that follows is
 * the common path, not the rare one.
 */
describe("disconnect and reconnect", () => {
  it("keeps the sync map, so a reconnect does not re-create a synced customer", async () => {
    const { db, shop } = await seededShopContext();
    const first = await connectQuickBooks(db, shop.id);
    await upsertIntegrationSyncRecord(db, {
      shopId: shop.id,
      provider: "quickbooks",
      sourceType: "quickbooks_customer",
      sourceId: "person-1",
      operation: "customer",
      externalId: "7",
    });

    await disconnectShopIntegration(db, shop.id, "quickbooks");
    const second = await connectQuickBooks(db, shop.id, "access-2");

    expect(second.id).not.toBe(first.id);
    const mapped = await getIntegrationSyncRecord(db, {
      shopId: shop.id,
      provider: "quickbooks",
      sourceType: "quickbooks_customer",
      sourceId: "person-1",
      operation: "customer",
    });
    expect(mapped?.externalId).toBe("7");
  });

  it("keeps an undelivered order and hands it to the reconnected integration", async () => {
    const { db, shop } = await seededShopContext();
    const first = await connectQuickBooks(db, shop.id);
    const event = await enqueueIntegrationEvent(db, {
      shopId: shop.id,
      eventType: "order.paid",
      entityType: "order",
      entityId: "order-1",
      idempotencyKey: "order:order-1:paid",
      payload: { orderId: "order-1" },
    });
    const [queued] = await db
      .select()
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.eventId, event?.id ?? ""));
    expect(queued?.integrationId).toBe(first.id);

    await disconnectShopIntegration(db, shop.id, "quickbooks");
    const second = await connectQuickBooks(db, shop.id, "access-2");

    const [after] = await db
      .select()
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.id, queued?.id ?? ""));
    expect(after?.status).toBe("pending");
    expect(after?.integrationId).toBe(second.id);
  });

  // The record of a send stays where it was sent from; only work still owed moves.
  it("leaves an already-delivered row on the connection that sent it", async () => {
    const { db, shop } = await seededShopContext();
    const first = await connectQuickBooks(db, shop.id);
    const event = await enqueueIntegrationEvent(db, {
      shopId: shop.id,
      eventType: "order.paid",
      entityType: "order",
      entityId: "order-2",
      idempotencyKey: "order:order-2:paid",
      payload: { orderId: "order-2" },
    });
    await db
      .update(integrationDeliveries)
      .set({ status: "delivered" })
      .where(eq(integrationDeliveries.eventId, event?.id ?? ""));

    await disconnectShopIntegration(db, shop.id, "quickbooks");
    await connectQuickBooks(db, shop.id, "access-2");

    const [after] = await db
      .select()
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.eventId, event?.id ?? ""));
    expect(after?.integrationId).toBe(first.id);
  });

  it("stamps the row instead of deleting it, and empties the sealed credential", async () => {
    const { db, shop } = await seededShopContext();
    await connectQuickBooks(db, shop.id);
    await disconnectShopIntegration(db, shop.id, "quickbooks");

    const rows = await db
      .select()
      .from(shopIntegrations)
      .where(
        and(eq(shopIntegrations.shopId, shop.id), eq(shopIntegrations.provider, "quickbooks")),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).not.toBeNull();
    const row = rows[0];
    if (!row) throw new Error("expected the stamped row");
    expect(await readIntegrationCredentials(row)).toEqual({ status: "invalid_credentials" });
  });

  it("hides a disconnected provider from every active read", async () => {
    const { db, shop } = await seededShopContext();
    await connectQuickBooks(db, shop.id);
    await disconnectShopIntegration(db, shop.id, "quickbooks");

    expect(await getShopIntegration(db, shop.id, "quickbooks")).toBeNull();
    expect(await listShopIntegrations(db, shop.id)).toEqual([]);
  });

  it("queues nothing for a provider the shop disconnected", async () => {
    const { db, shop } = await seededShopContext();
    await connectQuickBooks(db, shop.id);
    await disconnectShopIntegration(db, shop.id, "quickbooks");
    const event = await enqueueIntegrationEvent(db, {
      shopId: shop.id,
      eventType: "order.paid",
      entityType: "order",
      entityId: "order-3",
      idempotencyKey: "order:order-3:paid",
      payload: { orderId: "order-3" },
    });

    const deliveries = await db
      .select()
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.eventId, event?.id ?? ""));
    expect(deliveries).toEqual([]);
  });

  // The mapping is a fact about the shop's books, not about a credential, so it
  // is no longer a child of `shop_integrations` at all — not even a hard delete
  // of the connection row reaches it. Only deleting the shop does, which is the
  // one case where losing it is right.
  it("survives even a hard delete of the connection row", async () => {
    const { db, shop } = await seededShopContext();
    await connectQuickBooks(db, shop.id);
    await upsertIntegrationSyncRecord(db, {
      shopId: shop.id,
      provider: "quickbooks",
      sourceType: "quickbooks_item",
      sourceId: "diveday-sales",
      operation: "item",
      externalId: "42",
    });

    await db.delete(shopIntegrations).where(eq(shopIntegrations.shopId, shop.id));

    expect(
      await db
        .select()
        .from(integrationSyncRecords)
        .where(eq(integrationSyncRecords.shopId, shop.id)),
    ).toHaveLength(1);
  });
});

/**
 * Issue #1020. The OAuth state is the CSRF and replay defence in front of both
 * connectors and nothing asserted any of it: delete the single-use consumption
 * and every test still passed.
 */
describe("integration OAuth state", () => {
  it("stores only a digest, never the browser's state", async () => {
    const { db, shop } = await seededShopContext();
    const person = await aPerson(db, shop.id);
    const state = await createIntegrationOAuthState(db, {
      shopId: shop.id,
      personId: person.id,
      provider: "quickbooks",
    });

    const rows = await db.select().from(integrationOauthStates);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stateHash).not.toBe(state);
    expect(rows[0]?.stateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("resolves once and refuses the replay", async () => {
    const { db, shop } = await seededShopContext();
    const person = await aPerson(db, shop.id);
    const state = await createIntegrationOAuthState(db, {
      shopId: shop.id,
      personId: person.id,
      provider: "quickbooks",
      context: { returnTo: "/shop/blue-mantis/settings/integrations" },
    });

    const first = await consumeIntegrationOAuthState(db, { state, provider: "quickbooks" });
    expect(first).toEqual({
      shopId: shop.id,
      personId: person.id,
      provider: "quickbooks",
      context: { returnTo: "/shop/blue-mantis/settings/integrations" },
    });
    expect(await consumeIntegrationOAuthState(db, { state, provider: "quickbooks" })).toBeNull();
  });

  // The callback URL names its provider; a state minted for one must not open
  // the other's, or a Shopify redirect could seal QuickBooks credentials.
  it("does not resolve against a different provider's callback", async () => {
    const { db, shop } = await seededShopContext();
    const person = await aPerson(db, shop.id);
    const state = await createIntegrationOAuthState(db, {
      shopId: shop.id,
      personId: person.id,
      provider: "quickbooks",
    });
    expect(await consumeIntegrationOAuthState(db, { state, provider: "shopify" })).toBeNull();
    expect(
      await consumeIntegrationOAuthState(db, { state, provider: "quickbooks" }),
    ).not.toBeNull();
  });

  it("does not resolve an expired state", async () => {
    const { db, shop } = await seededShopContext();
    const person = await aPerson(db, shop.id);
    const state = await createIntegrationOAuthState(db, {
      shopId: shop.id,
      personId: person.id,
      provider: "quickbooks",
    });
    await db
      .update(integrationOauthStates)
      .set({ expiresAt: new Date(Date.UTC(2020, 0, 1)) })
      .where(eq(integrationOauthStates.provider, "quickbooks"));

    expect(await consumeIntegrationOAuthState(db, { state, provider: "quickbooks" })).toBeNull();
  });

  it("does not resolve a state nobody minted", async () => {
    const { db } = await seededShopContext();
    expect(
      await consumeIntegrationOAuthState(db, { state: "made-up", provider: "quickbooks" }),
    ).toBeNull();
  });
});
