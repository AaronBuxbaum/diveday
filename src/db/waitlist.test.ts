// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import {
  getShopBySlug,
  getTripRoster,
  getTripWithBooked,
  upcomingTripsWithCounts,
} from "./queries";
import { seedDemo } from "./seed";
import { joinTripWaitlist } from "./waitlist";

async function seededContext() {
  const db = await createTestDb();
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const fullTrip = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
  const openTrip = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  if (!fullTrip || !openTrip) throw new Error("expected seeded trips missing");
  return { db, shop, fullTrip, openTrip };
}

const visitor = { fullName: "Nora Quinn", email: "nora@example.com", phone: "+1-305-555-0199" };

describe("joinTripWaitlist (in-memory PGlite)", () => {
  it("adds a new diver to a full trip without consuming a seat", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const outcome = await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
    });

    expect(outcome).toMatchObject({ ok: true, personName: "Nora Quinn" });
    expect(await getTripRoster(db, fullTrip.id)).toHaveLength(fullTrip.capacity);
  });

  it("keeps one first-come entry per diver and trip", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const first = await joinTripWaitlist(db, { shopId: shop.id, tripId: fullTrip.id, ...visitor });
    const again = await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      ...visitor,
      email: "NORA@example.com",
    });

    expect(first).toMatchObject({ ok: true });
    expect(again).toMatchObject({
      ok: false,
      reason: "already_waitlisted",
      entryId: first.entryId,
    });
  });

  it("refuses a wait-list entry while a spot is available", async () => {
    const { db, shop, openTrip } = await seededContext();
    await expect(
      joinTripWaitlist(db, { shopId: shop.id, tripId: openTrip.id, ...visitor }),
    ).resolves.toEqual({ ok: false, reason: "trip_available" });
    const trip = await getTripWithBooked(db, shop.id, openTrip.id);
    expect(trip?.booked).toBe(openTrip.booked);
  });
});
