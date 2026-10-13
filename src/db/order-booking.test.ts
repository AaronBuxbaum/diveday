import { and, eq, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getOrderBookingContext } from "./order-booking";
import { bookingPayments, bookings, shops, trips } from "./schema";

const ctx = fileScopedShopContext();

/** A seeded booking on a priced diver seat that paid a deposit. */
async function depositSeat() {
  const { db, shop } = ctx;
  const [row] = await db
    .select({
      bookingId: bookings.id,
      tripTitle: trips.title,
      tripId: trips.id,
      priceCents: trips.priceCents,
      collected: bookingPayments.amountCents,
    })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookingPayments.shopId, shop.id),
        eq(bookingPayments.status, "deposit_paid"),
        eq(bookings.participantType, "diver"),
        isNotNull(trips.priceCents),
      ),
    )
    .limit(1);
  if (!row) throw new Error("the demo seeds a deposit-paid seat");
  return row;
}

describe("getOrderBookingContext", () => {
  it("names the departure and what the seat still owes after its deposit", async () => {
    const seat = await depositSeat();
    const context = await getOrderBookingContext(ctx.db, ctx.shop.id, seat.bookingId);
    expect(context).toMatchObject({
      bookingId: seat.bookingId,
      tripId: seat.tripId,
      tripTitle: seat.tripTitle,
    });
    expect(context?.balanceOwedCents).toBe((seat.priceCents ?? 0) - (seat.collected ?? 0));
  });

  it("owes nothing once the seat is paid", async () => {
    const seat = await depositSeat();
    await ctx.db
      .update(bookingPayments)
      .set({ status: "paid", amountCents: seat.priceCents })
      .where(eq(bookingPayments.bookingId, seat.bookingId));
    const context = await getOrderBookingContext(ctx.db, ctx.shop.id, seat.bookingId);
    expect(context?.balanceOwedCents).toBeNull();
  });

  it("resolves nothing for another shop's booking", async () => {
    const seat = await depositSeat();
    const [other] = await ctx.db
      .insert(shops)
      .values({ name: "Elsewhere Diving", slug: `elsewhere-${Date.now()}`, timezone: "UTC" })
      .returning({ id: shops.id });
    if (!other) throw new Error("shop insert failed");
    expect(await getOrderBookingContext(ctx.db, other.id, seat.bookingId)).toBeNull();
  });
});
