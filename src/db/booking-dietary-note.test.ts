import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { setBookingDietaryNote } from "./bookings";
import { bookings, trips } from "./schema";

/**
 * The lunch note's one writer refuses a departure that does not serve lunch
 * aboard (dive-domain second pass, N-a), so the roster's hand-posted form and
 * the Day-of form are held to the same rule the UI shows.
 */
describe("setBookingDietaryNote", () => {
  async function liveBooking() {
    const { db, shop } = await seededShopContext();
    const [booking] = await db
      .select({ id: bookings.id, tripId: bookings.tripId })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
      .orderBy(bookings.id)
      .limit(1);
    if (!booking) throw new Error("expected a seeded booking");
    const read = async () =>
      (
        await db
          .select({ note: bookings.dietaryNote })
          .from(bookings)
          .where(eq(bookings.id, booking.id))
      )[0]?.note;
    return { db, shop, booking, read };
  }

  it("refuses a departure that does not serve lunch aboard", async () => {
    const { db, shop, booking, read } = await liveBooking();
    await db.update(trips).set({ lunchAboard: false }).where(eq(trips.id, booking.tripId));
    const saved = await setBookingDietaryNote(db, {
      shopId: shop.id,
      bookingId: booking.id,
      note: "vegetarian",
    });
    expect(saved).toBe(false);
    expect(await read()).toBeNull();
  });

  it("writes the trimmed note on a departure that serves lunch aboard", async () => {
    const { db, shop, booking, read } = await liveBooking();
    await db.update(trips).set({ lunchAboard: true }).where(eq(trips.id, booking.tripId));
    const saved = await setBookingDietaryNote(db, {
      shopId: shop.id,
      bookingId: booking.id,
      note: "  vegetarian  ",
    });
    expect(saved).toBe(true);
    expect(await read()).toBe("vegetarian");
  });
});
