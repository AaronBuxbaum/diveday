import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getBookingPickupTime } from "./bookings";
import { getTripManifest } from "./manifests";
import { bookings, shops } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";
import { getTripPrep } from "./trips-prep";

const ctx = fileScopedShopContext();

/**
 * **Switching hotel pickups off withdraws the offer, never a promise**
 * (safety review, 2026-10-23). A diver whose seat already holds a pickup is
 * still collected, so every place the crew accounts for divers still says it:
 * the manifest (and its print, drawn from the same rows), Prep's pickup run and
 * the diver's arrival card.
 */
describe("a pickup already set after hotel pickups are switched off", () => {
  it("stays on the manifest, Prep and the arrival card", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [seat] = await getTripRoster(db, shop.id, reef.id);
    if (!seat) throw new Error("demo booking missing");
    await db
      .update(bookings)
      .set({ hotelPickupLocation: "Harbor Inn", pickupTime: "07:15" })
      .where(eq(bookings.id, seat.booking.id));

    await db.update(shops).set({ offersHotelPickup: false }).where(eq(shops.id, shop.id));

    const manifest = await getTripManifest(db, shop.id, reef.id);
    const diver = manifest?.divers.find((entry) => entry.bookingId === seat.booking.id);
    expect([diver?.hotelPickupLocation, diver?.pickupTime]).toEqual(["Harbor Inn", "07:15"]);

    const [row] = await db.select().from(shops).where(eq(shops.id, shop.id));
    if (!row) throw new Error("shop missing");
    const prep = await getTripPrep(db, row, reef.id);
    expect(prep?.hotelPickups.map((stop) => stop.bookingId)).toContain(seat.booking.id);

    expect(await getBookingPickupTime(db, shop.id, seat.booking.id)).toBe("07:15");
  });
});
