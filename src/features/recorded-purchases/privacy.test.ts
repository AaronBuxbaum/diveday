import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createPerson } from "../../db/people";
import { collectionEntries, orders } from "../../db/schema";
import { fileScopedShopContext } from "../../test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "../../test/staff-session";
import { anonymizeDiver } from "../anonymize";
import { recordPurchase } from "./store";

const context = fileScopedShopContext();
it("erases identifying receipt reference but preserves numerical fee evidence", async () => {
  const { db, shop } = context;
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const payer = await createPerson(db, {
    shopId: shop.id,
    fullName: "Kwame Mensah",
    email: "kwame-private@mail.example",
    phone: null,
    origin: "counter",
  });
  const sale = await recordPurchase(db, {
    shopId: shop.id,
    personId: payer.id,
    createdByPersonId: owner,
    attemptId: randomUUID(),
    currency: "usd",
    collection: "cash",
    taxCents: 700,
    tipCents: 300,
    receiptReference: "Kwame Mensah receipt",
    lineItems: [{ kind: "merchandise", description: "Shirt", quantity: 1, unitAmountCents: 11000 }],
  });
  if (!sale.ok) throw new Error("receipt failed");
  const before = await db
    .select()
    .from(collectionEntries)
    .where(eq(collectionEntries.sourceId, sale.order.id));
  expect(
    (await anonymizeDiver(db, { shopId: shop.id, personId: payer.id, actorPersonId: owner })).ok,
  ).toBe(true);
  const [order] = await db.select().from(orders).where(eq(orders.id, sale.order.id));
  expect(order?.counterReceipt).toEqual({
    taxCents: 700,
    taxKnown: true,
    tipCents: 300,
    passThroughCents: 0,
    reference: null,
  });
  expect(
    await db.select().from(collectionEntries).where(eq(collectionEntries.sourceId, sale.order.id)),
  ).toEqual(before);
});
