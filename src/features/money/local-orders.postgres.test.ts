import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createPerson } from "../../db/people";
import { activityEvents, collectionEntries, orders, shops, userAccounts } from "../../db/schema";
import {
  describePostgres,
  holdRowLock,
  postgresTestDb,
  waitForLockWaiters,
} from "../../test/postgres";
import { createLocalOrder, recordLocalOrderReceipt } from "./local-orders";

describePostgres("local ancillary receipt concurrency", () => {
  it("records one full receipt when two staff forms arrive together", async () => {
    const { pg, shop, owner, customer } = await fixture();
    const created = await createLocalOrder(pg.db, {
      shopId: shop.id,
      personId: customer.id,
      actorPersonId: owner.id,
      attemptId: randomUUID(),
      currency: "usd",
      lineItems: [{ kind: "rental", description: "Regulator", quantity: 1, unitAmountCents: 2000 }],
    });
    if (!created.ok) throw new Error("missing order");
    const input = {
      shopId: shop.id,
      orderId: created.order.id,
      actorPersonId: owner.id,
      attemptId: randomUUID(),
      currency: "usd",
      expectedTotalCents: 2000,
      collection: "cash" as const,
      tipCents: 0,
      receiptReference: null,
    };
    const results = await Promise.all([
      recordLocalOrderReceipt(pg.db, input),
      recordLocalOrderReceipt(pg.connect(), { ...input, attemptId: randomUUID() }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const [order] = await pg.db.select().from(orders).where(eq(orders.id, created.order.id));
    expect(order?.amountPaidCents).toBe(2000);
    expect(order?.bookingId).toBeNull();
    expect(
      await pg.db
        .select()
        .from(collectionEntries)
        .where(eq(collectionEntries.sourceId, created.order.id)),
    ).toHaveLength(1);
    expect(
      (
        await pg.db
          .select()
          .from(activityEvents)
          .where(eq(activityEvents.orderId, created.order.id))
      ).filter((event) => event.code === "purchase_recorded"),
    ).toHaveLength(1);
  });
});

async function fixture() {
  const pg = await postgresTestDb();
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: "Desk", slug: `desk-${randomUUID()}`, timezone: "UTC" })
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
  await pg.db.insert(userAccounts).values({
    personId: owner.id,
    email: `${randomUUID()}@example.com`,
    hashedPassword: "unused",
    status: "active",
  });
  const customer = await createPerson(pg.db, {
    shopId: shop.id,
    fullName: "Diver",
    email: null,
    phone: null,
    origin: "counter",
  });
  return { pg, shop, owner, customer };
}

for (const change of ["currency", "account"] as const) {
  describePostgres(`local amount due ${change} during payer wait`, () => {
    it("refuses a pre-wait snapshot after the blocked payer becomes available", async () => {
      const { pg, shop, owner, customer } = await fixture();
      const gate = await holdRowLock(
        pg,
        sql`select id from people where id = ${customer.id} for no key update`,
      );
      const attemptId = randomUUID();
      const pending = createLocalOrder(pg.connect(), {
        shopId: shop.id,
        personId: customer.id,
        actorPersonId: owner.id,
        attemptId,
        currency: "usd",
        lineItems: [
          { kind: "rental", description: "Regulator", quantity: 1, unitAmountCents: 2000 },
        ],
      });
      try {
        await waitForLockWaiters(pg.db, 1);
        if (change === "currency")
          await pg.db.update(shops).set({ currency: "eur" }).where(eq(shops.id, shop.id));
        else
          await pg.db
            .update(userAccounts)
            .set({ status: "disabled" })
            .where(eq(userAccounts.personId, owner.id));
      } finally {
        await gate.release();
      }
      expect(await pending).toEqual({ ok: false, reason: "invalid" });
      expect(await pg.db.select().from(orders).where(eq(orders.id, attemptId))).toHaveLength(0);
    });
  });
}
describePostgres("receipt authority after order-lock wait", () => {
  it("refuses collection when the actor account is disabled while its order lock waits", async () => {
    const { pg, shop, owner, customer } = await fixture();
    const orderId = randomUUID();
    expect(
      (
        await createLocalOrder(pg.db, {
          shopId: shop.id,
          personId: customer.id,
          actorPersonId: owner.id,
          attemptId: orderId,
          currency: "usd",
          lineItems: [{ kind: "rental", description: "Mask", quantity: 1, unitAmountCents: 2000 }],
        })
      ).ok,
    ).toBe(true);
    const gate = await holdRowLock(pg, sql`select id from orders where id = ${orderId} for update`);
    const pending = recordLocalOrderReceipt(pg.connect(), {
      shopId: shop.id,
      orderId,
      actorPersonId: owner.id,
      attemptId: randomUUID(),
      currency: "usd",
      expectedTotalCents: 2000,
      collection: "cash",
      tipCents: 0,
      receiptReference: null,
    });
    try {
      await waitForLockWaiters(pg.db, 1);
      await pg.db
        .update(userAccounts)
        .set({ status: "disabled" })
        .where(eq(userAccounts.personId, owner.id));
    } finally {
      await gate.release();
    }
    expect(await pending).toEqual({ ok: false, reason: "invalid" });
    const [saved] = await pg.db.select().from(orders).where(eq(orders.id, orderId));
    expect(saved?.amountPaidCents).toBe(0);
    expect(
      await pg.db.select().from(collectionEntries).where(eq(collectionEntries.sourceId, orderId)),
    ).toHaveLength(0);
  });
});
