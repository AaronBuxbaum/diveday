import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createPerson } from "../../db/people";
import { activityEvents, collectionEntries, orders, shops } from "../../db/schema";
import { describePostgres, postgresTestDb } from "../../test/postgres";
import { recordPurchase, recordPurchaseRefund } from "./store";

async function fixture() {
  const pg = await postgresTestDb();
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: "Counter", slug: `counter-${randomUUID()}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("missing shop");
  const owner = await createPerson(pg.db, {
    shopId: shop.id,
    fullName: "Owner",
    email: null,
    phone: null,
    origin: "counter",
    roles: ["owner"],
  });
  const customer = await createPerson(pg.db, {
    shopId: shop.id,
    fullName: "Customer",
    email: null,
    phone: null,
    origin: "counter",
  });
  const input = {
    shopId: shop.id,
    personId: customer.id,
    createdByPersonId: owner.id,
    attemptId: randomUUID(),
    currency: "usd",
    collection: "cash" as const,
    lineItems: [
      { kind: "merchandise" as const, description: "Shirt", quantity: 1, unitAmountCents: 10000 },
    ],
  };
  return { pg, input, owner };
}
describePostgres("recorded purchase concurrency", () => {
  it("creates one receipt, one integration event and one fee lot for simultaneous retries", async () => {
    const { pg, input } = await fixture();
    const results = await Promise.all([
      recordPurchase(pg.db, input),
      recordPurchase(pg.connect(), input),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await pg.db.select().from(orders).where(eq(orders.id, input.attemptId))).toHaveLength(1);
    expect(
      await pg.db
        .select()
        .from(collectionEntries)
        .where(eq(collectionEntries.sourceId, input.attemptId)),
    ).toHaveLength(1);
  });
  it("serializes partial returns and refuses the stale second form", async () => {
    const { pg, input, owner } = await fixture();
    const sale = await recordPurchase(pg.db, input);
    if (!sale.ok) throw new Error("sale failed");
    const base = {
      shopId: input.shopId,
      orderId: sale.order.id,
      actorPersonId: owner.id,
      currency: input.currency,
      amountCents: 6000,
      expectedRefundedCents: 0,
      reason: "Returned",
    };
    const results = await Promise.all([
      recordPurchaseRefund(pg.db, { ...base, attemptId: randomUUID() }),
      recordPurchaseRefund(pg.connect(), { ...base, attemptId: randomUUID() }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const [order] = await pg.db.select().from(orders).where(eq(orders.id, sale.order.id));
    expect(order?.amountPaidCents).toBe(4000);
    const history = await pg.db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.orderId, sale.order.id));
    expect(history.filter((row) => row.code === "order_refunded")).toHaveLength(1);
  });
});
