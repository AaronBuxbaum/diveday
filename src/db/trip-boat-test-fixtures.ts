import { createBoat } from "./boats";
import type { AppDb } from "./client";
import { createTrip } from "./trips";

export async function boatTripFixture(db: AppDb, shop: { id: string }) {
  const hull = await createBoat(db, shop.id, "Reef Runner", 12);
  const spare = await createBoat(db, shop.id, "Blue Horizon", 12);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Two-Tank Reef",
    startsAt: new Date("2030-08-03T13:00:00.000Z"),
    endsAt: new Date("2030-08-03T17:00:00.000Z"),
    capacity: 10,
    plannedDives: 2,
    diveMode: "boat",
    boatId: hull.id,
    isPrivate: false,
  });
  if (!trip) throw new Error("trip not created");
  return { db, shop, trip, hull, spare };
}

export const tripBoatPatch = (trip: { title: string; startsAt: Date; endsAt: Date }) => ({
  title: trip.title,
  startsAt: trip.startsAt,
  endsAt: trip.endsAt,
  capacity: 10,
  plannedDives: 2,
});
