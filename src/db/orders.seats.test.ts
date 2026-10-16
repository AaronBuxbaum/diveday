import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { countOpenTripOrders, countShopOrders, listShopOrders } from "./orders";
import { bookings, orders } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/** An open invoice against one seat of the seeded reef trip. */
async function openOrderOnASeat() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (t) => t.booked > 0 && t.title.startsWith("Two-Tank Reef"),
  );
  if (!trip) throw new Error("seeded reef trip missing");
  const [booking] = await db
    .select({ id: bookings.id, personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.tripId, trip.id))
    .limit(1);
  if (!booking) throw new Error("seeded reef trip has no bookings");
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      bookingId: booking.id,
      personId: booking.personId,
      createdByPersonId: booking.personId,
      status: "open",
      currency: "usd",
      totalCents: 12_000,
      amountPaidCents: 0,
      description: "Balance",
      stripeAccountId: "acct_test",
      stripeCustomerId: `cus_${booking.id}`,
      stripeInvoiceId: `in_${booking.id}`,
      createdAt: nowDate(),
      updatedAt: nowDate(),
    })
    .returning();
  if (!order) throw new Error("order not written");
  return { db, shop, tripId: trip.id, bookingId: booking.id, orderId: order.id };
}

/**
 * Issue #2550: the trip pulse's "N orders awaiting payment" counts the boat's
 * live seats, so the Orders list it opens reads the same seats. An order left
 * on a canceled seat may still need a refund or a void, so it is never dropped
 * from the ledger: it is one filter away, and the unfiltered ledger has it.
 */
describe("orders on a departure's live and canceled seats", () => {
  it("counts and lists a seat's open order on the live view while the seat is booked", async () => {
    const { db, shop, tripId, orderId } = await openOrderOnASeat();
    const base = { tripId, status: "open" as const };
    expect(await countOpenTripOrders(db, shop.id, tripId)).toBe(1);
    expect(await countOpenTripOrders(db, shop.id, tripId, "cancelled")).toBe(0);
    const live = await listShopOrders(db, shop.id, { ...base, seats: "live" });
    expect(live.rows.map((row) => row.order.id)).toEqual([orderId]);
    expect((await listShopOrders(db, shop.id, { ...base, seats: "cancelled" })).total).toBe(0);
  });

  it("moves the order off the live count when its seat is canceled, and keeps it reachable", async () => {
    const { db, shop, tripId, bookingId, orderId } = await openOrderOnASeat();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));

    const base = { tripId, status: "open" as const };
    expect(await countOpenTripOrders(db, shop.id, tripId)).toBe(0);
    expect(await countOpenTripOrders(db, shop.id, tripId, "cancelled")).toBe(1);
    // The live list agrees with the count the pulse states.
    expect((await listShopOrders(db, shop.id, { ...base, seats: "live" })).total).toBe(0);
    const left = await listShopOrders(db, shop.id, { ...base, seats: "cancelled" });
    expect(left.rows.map((row) => row.order.id)).toEqual([orderId]);
    // No seat filter is the shop's complete ledger: nothing is deleted from it.
    expect((await listShopOrders(db, shop.id, base)).total).toBe(1);
    expect(await countShopOrders(db, shop.id, { ...base, seats: "cancelled" })).toBe(1);
    expect(await countShopOrders(db, shop.id, { ...base, seats: "live" })).toBe(0);
  });

  it("reads another shop's orders as none", async () => {
    const { db, tripId } = await openOrderOnASeat();
    const otherShop = "00000000-0000-4000-8000-000000000000";
    expect(await countShopOrders(db, otherShop, { tripId, seats: "live" })).toBe(0);
    expect(await countOpenTripOrders(db, otherShop, tripId)).toBe(0);
  });
});
