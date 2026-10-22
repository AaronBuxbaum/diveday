import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { claimIntegrationDelivery, enqueueIntegrationEvent } from "./integration-events";
import { integrationDeliveries, shopIntegrations, shops } from "./schema";

describePostgres("integration delivery claims across independent sessions", () => {
  it("awards one claim and spends one attempt when workers select the same delivery", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Delivery contention", slug: "delivery-contention", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop missing");
    await pg.db.insert(shopIntegrations).values({
      shopId: shop.id,
      provider: "zapier",
      credentialsSealed: "sealed",
      settings: { eventTypes: ["order.paid"] },
    });
    await enqueueIntegrationEvent(pg.db, {
      shopId: shop.id,
      eventType: "order.paid",
      entityType: "order",
      entityId: "order-1",
      idempotencyKey: "order:1:paid",
      payload: { orderId: "order-1" },
    });
    const [delivery] = await pg.db.select().from(integrationDeliveries);
    if (!delivery) throw new Error("delivery missing");
    const gate = await holdRowLock(
      pg,
      sql`select id from integration_deliveries where id = ${delivery.id} for update`,
    );
    const claims = Array.from({ length: 2 }, () =>
      claimIntegrationDelivery(pg.connect(), delivery.id),
    );
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    const results = await Promise.all(claims);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((row) => row === null)).toHaveLength(1);
    expect(
      await pg.db
        .select()
        .from(integrationDeliveries)
        .where(eq(integrationDeliveries.id, delivery.id)),
    ).toMatchObject([{ status: "processing", attemptCount: 1, deliveredAt: null }]);
    expect(await claimIntegrationDelivery(pg.connect(), delivery.id)).toBeNull();
  });
});
