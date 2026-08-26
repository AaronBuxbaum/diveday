import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededTestDb } from "@/test/db";
import { enqueueIntegrationEvent, listDueIntegrationDeliveries } from "./integration-events";
import { integrationDeliveries, integrationEvents, shopIntegrations, shops } from "./schema";

describe("integration outbox", () => {
  it("fans out one idempotent event to connected subscribers only", async () => {
    const db = await seededTestDb();
    const [shop] = await db.select().from(shops).limit(1);
    if (!shop) throw new Error("expected a seeded shop");
    const [connected] = await db
      .insert(shopIntegrations)
      .values({
        shopId: shop.id,
        provider: "zapier",
        credentialsSealed: "sealed",
        settings: { eventTypes: ["order.paid"] },
      })
      .returning({ id: shopIntegrations.id });
    await db.insert(shopIntegrations).values({
      shopId: shop.id,
      provider: "quickbooks",
      status: "error",
      credentialsSealed: "sealed",
      settings: { eventTypes: ["order.paid"] },
    });
    if (!connected) throw new Error("expected a connected integration");

    const input = {
      shopId: shop.id,
      eventType: "order.paid",
      entityType: "order",
      entityId: "order-1",
      idempotencyKey: "order:order-1:paid",
      payload: { orderId: "order-1", totalCents: 12_500 },
    };
    const first = await enqueueIntegrationEvent(db, input);
    const replay = await enqueueIntegrationEvent(db, input);
    const deliveries = await db
      .select()
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.eventId, first?.id ?? ""));

    expect(first?.id).toBe(replay?.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.integrationId).toBe(connected.id);
  });

  it("does not schedule a delivery after the retry cap", async () => {
    const db = await seededTestDb();
    const [shop] = await db.select().from(shops).limit(1);
    if (!shop) throw new Error("expected a seeded shop");
    const [integration] = await db
      .insert(shopIntegrations)
      .values({
        shopId: shop.id,
        provider: "zapier",
        credentialsSealed: "sealed",
        settings: { eventTypes: ["order.paid"] },
      })
      .returning({ id: shopIntegrations.id });
    if (!integration) throw new Error("expected a connected integration");
    const [event] = await db
      .insert(integrationEvents)
      .values({
        shopId: shop.id,
        eventType: "order.paid",
        entityType: "order",
        entityId: "order-2",
        idempotencyKey: "order:order-2:paid",
        payload: { orderId: "order-2" },
      })
      .returning({ id: integrationEvents.id });
    if (!event) throw new Error("expected an integration event");
    await db.insert(integrationDeliveries).values({
      shopId: shop.id,
      integrationId: integration.id,
      eventId: event.id,
      status: "failed",
      attemptCount: 8,
      nextAttemptAt: new Date(0),
    });

    expect(
      await listDueIntegrationDeliveries(db, 10).then((rows) =>
        rows.filter(
          (row) => row.delivery.integrationId === integration.id && row.event.id === event.id,
        ),
      ),
    ).toEqual([]);
  });
});
