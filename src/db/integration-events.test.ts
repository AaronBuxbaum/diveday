import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  claimIntegrationDelivery,
  enqueueIntegrationEvent,
  listDueIntegrationDeliveries,
} from "./integration-events";
import { integrationDeliveries, integrationEvents, shopIntegrations, shops } from "./schema";

const ctx = fileScopedShopContext();

describe("integration outbox", () => {
  it("fans out one idempotent event to connected subscribers only", async () => {
    const db = ctx.db;
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
    const db = ctx.db;
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

  it("lists and claims exactly the same delivery states", async () => {
    const db = ctx.db;
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
    const past = new Date(nowMs() - 60_000);
    const future = new Date(nowMs() + 60 * 60_000);
    const cases = [
      {
        name: "pending-due",
        status: "pending",
        attemptCount: 0,
        at: past,
        updatedAt: past,
        ok: true,
      },
      {
        name: "failed-due",
        status: "failed",
        attemptCount: 7,
        at: past,
        updatedAt: past,
        ok: true,
      },
      {
        name: "failed-capped",
        status: "failed",
        attemptCount: 8,
        at: past,
        updatedAt: past,
        ok: false,
      },
      {
        name: "pending-future",
        status: "pending",
        attemptCount: 0,
        at: future,
        updatedAt: past,
        ok: false,
      },
      {
        name: "processing-fresh",
        status: "processing",
        attemptCount: 1,
        at: past,
        updatedAt: new Date(nowMs() - 5 * 60_000),
        ok: false,
      },
      {
        name: "processing-stale",
        status: "processing",
        attemptCount: 1,
        at: past,
        updatedAt: new Date(nowMs() - 20 * 60_000),
        ok: true,
      },
    ] as const;
    const ids = new Map<string, boolean>();
    for (const c of cases) {
      const [event] = await db
        .insert(integrationEvents)
        .values({
          shopId: shop.id,
          eventType: "order.paid",
          entityType: "order",
          entityId: c.name,
          idempotencyKey: `eligibility:${c.name}`,
          payload: {},
        })
        .returning({ id: integrationEvents.id });
      if (!event) throw new Error("expected an integration event");
      const [delivery] = await db
        .insert(integrationDeliveries)
        .values({
          shopId: shop.id,
          integrationId: integration.id,
          eventId: event.id,
          status: c.status,
          attemptCount: c.attemptCount,
          nextAttemptAt: c.at,
          updatedAt: c.updatedAt,
        })
        .returning({ id: integrationDeliveries.id });
      if (!delivery) throw new Error("expected a delivery");
      ids.set(delivery.id, c.ok);
    }

    const listed = new Set(
      (await listDueIntegrationDeliveries(db, 100))
        .filter((row) => ids.has(row.delivery.id))
        .map((row) => row.delivery.id),
    );
    for (const [id, ok] of ids) {
      expect(listed.has(id)).toBe(ok);
      expect((await claimIntegrationDelivery(db, id)) !== null).toBe(ok);
    }
  });
});
