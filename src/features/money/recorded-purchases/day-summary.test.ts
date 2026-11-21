import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPerson } from "../../../db/people";
import { collectionEntries, orders } from "../../../db/schema";
import { calendarDateInTimezone } from "../../../lib/calendar-date";
import { nowDate } from "../../../lib/clock";
import { shopDaysBounds } from "../../../lib/zoned";
import { fileScopedShopContext } from "../../../test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "../../../test/staff-session";
import { anonymizeDiver } from "../../records/anonymize";
import { recordedPurchaseDay } from "./day-summary";
import { recordPurchase, recordPurchaseRefund } from "./store";

const context = fileScopedShopContext();
async function sale() {
  const { db, shop } = context;
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const payer = await createPerson(db, {
    shopId: shop.id,
    fullName: "Day receipt diver",
    email: null,
    phone: null,
    origin: "counter",
  });
  const result = await recordPurchase(db, {
    shopId: shop.id,
    personId: payer.id,
    createdByPersonId: owner,
    attemptId: randomUUID(),
    currency: "usd",
    collection: "cash",
    taxCents: 10000,
    tipCents: 0,
    lineItems: [
      { kind: "rental", description: "Receipt including tax", quantity: 1, unitAmountCents: 10000 },
    ],
  });
  if (!result.ok) throw new Error("sale failed");
  return {
    db,
    shop,
    owner,
    payer,
    order: result.order,
    day: calendarDateInTimezone(nowDate(), shop.timezone),
  };
}
describe("recorded purchase day", () => {
  it("counts original gross receipts even when fee basis is zero, with returns kept separate", async () => {
    const { db, shop, owner, order, day } = await sale();
    expect(
      await db.select().from(collectionEntries).where(eq(collectionEntries.sourceId, order.id)),
    ).toEqual([]);
    expect(
      (await recordedPurchaseDay(db, shop, owner, day))?.receipts.find(
        (row) => row.currency === "usd" && row.method === "cash",
      ),
    ).toMatchObject({ grossCents: 10000, taxCents: 10000, count: 1 });
    expect(
      (
        await recordPurchaseRefund(db, {
          shopId: shop.id,
          orderId: order.id,
          actorPersonId: owner,
          attemptId: randomUUID(),
          amountCents: 3000,
          expectedRefundedCents: 0,
          currency: "usd",
          reason: "External return",
        })
      ).ok,
    ).toBe(true);
    const summary = await recordedPurchaseDay(db, shop, owner, day);
    expect(summary?.receipts.find((row) => row.method === "cash")?.grossCents).toBe(10000);
    expect(summary?.returns).toContainEqual({
      currency: "usd",
      count: 1,
      amountCents: 3000,
      unknownAmount: 0,
    });
  });
  it("marks a redacted return amount incomplete rather than zero or an assumed original-method outflow", async () => {
    const { db, shop, owner, payer, order, day } = await sale();
    await recordPurchaseRefund(db, {
      shopId: shop.id,
      orderId: order.id,
      actorPersonId: owner,
      attemptId: randomUUID(),
      amountCents: 3000,
      expectedRefundedCents: 0,
      currency: "usd",
      reason: "External return",
    });
    expect(
      (await anonymizeDiver(db, { shopId: shop.id, personId: payer.id, actorPersonId: owner })).ok,
    ).toBe(true);
    const summary = await recordedPurchaseDay(db, shop, owner, day);
    expect(summary?.receipts.find((row) => row.method === "cash")?.grossCents).toBe(10000);
    expect(summary?.returns).toContainEqual({
      currency: "usd",
      count: 1,
      amountCents: null,
      unknownAmount: 1,
    });
  });
  it("uses the shop's day boundary and exposes retention uncertainty for old return dates", async () => {
    const { db, shop, owner, order, day } = await sale();
    const { from } = shopDaysBounds(day, day, shop.timezone);
    await db
      .update(orders)
      .set({ paidAt: new Date(from.getTime() - 1) })
      .where(eq(orders.id, order.id));
    expect(
      (await recordedPurchaseDay(db, shop, owner, day))?.receipts.find(
        (row) => row.method === "cash",
      ),
    ).toBeUndefined();
    const old = calendarDateInTimezone(
      new Date(nowDate().getTime() - 1100 * 86400000),
      shop.timezone,
    );
    expect((await recordedPurchaseDay(db, shop, owner, old))?.historyMayBePruned).toBe(true);
  });
  it("requires live staff authorization in the same shop", async () => {
    const { db, shop, payer, owner, day } = await sale();
    expect(await recordedPurchaseDay(db, shop, payer.id, day)).toBeNull();
    expect(await recordedPurchaseDay(db, { ...shop, id: randomUUID() }, owner, day)).toBeNull();
  });
});
