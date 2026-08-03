import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { rollCallEvents } from "./schema";
import {
  createTrip,
  getTripRoster,
  getTripWithBooked,
  listStaff,
  listTripDives,
  upcomingTripsWithCounts,
  updateTrip,
} from "./trips";

describe("trip records (in-memory PGlite)", () => {
  it("stores an optional per-diver price and lets staff update or clear it", async () => {
    const { db, shop } = await seededShopContext();

    const unpriced = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef — no price yet",
      startsAt: new Date("2030-08-01T13:00:00.000Z"),
      endsAt: new Date("2030-08-01T17:00:00.000Z"),
      capacity: 10,
    });
    if (!unpriced) throw new Error("trip not created");
    expect(unpriced.priceCents).toBeNull();

    const priced = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef — priced",
      startsAt: new Date("2030-08-02T13:00:00.000Z"),
      endsAt: new Date("2030-08-02T17:00:00.000Z"),
      capacity: 10,
      priceCents: 18_000,
    });
    if (!priced) throw new Error("trip not created");
    expect(priced.priceCents).toBe(18_000);

    await updateTrip(db, shop.id, priced.id, {
      title: priced.title,
      startsAt: priced.startsAt,
      endsAt: priced.endsAt,
      capacity: priced.capacity,
      plannedDives: priced.plannedDives,
      priceCents: 20_000,
    });
    expect((await getTripWithBooked(db, shop.id, priced.id))?.priceCents).toBe(20_000);

    await updateTrip(db, shop.id, priced.id, {
      title: priced.title,
      startsAt: priced.startsAt,
      endsAt: priced.endsAt,
      capacity: priced.capacity,
      plannedDives: priced.plannedDives,
      priceCents: null,
    });
    expect((await getTripWithBooked(db, shop.id, priced.id))?.priceCents).toBeNull();
  });

  it("refuses to shrink capacity below the trip's active booking count", async () => {
    const { db, shop } = await seededShopContext();
    const upcoming = await upcomingTripsWithCounts(db, shop.id);
    // 9 of 12 booked in the seed.
    const reef = upcoming.find((t) => t.title === "Two-Tank Reef — Molasses & French");
    if (!reef) throw new Error("expected seeded reef trip missing");
    expect(reef.booked).toBe(9);

    const refused = await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: 8,
      plannedDives: reef.plannedDives,
    });
    expect(refused).toEqual({
      ok: false,
      reason: "capacity_below_booked",
      detail: { bookedCount: 9 },
    });
    // Untouched — the capacity in the database still reads the original value.
    expect((await getTripWithBooked(db, shop.id, reef.id))?.capacity).toBe(reef.capacity);

    const accepted = await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: 9,
      plannedDives: reef.plannedDives,
    });
    expect(accepted.ok).toBe(true);
    expect((await getTripWithBooked(db, shop.id, reef.id))?.capacity).toBe(9);
  });

  it("refuses to drop planned dives below a checkpoint staff already recorded a roll call against", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((t) => t.title === "Two-Tank Reef — Molasses & French");
    if (!reef) throw new Error("expected seeded reef trip missing");
    expect(reef.plannedDives).toBeGreaterThanOrEqual(2);

    const [entry] = await getTripRoster(db, shop.id, reef.id);
    if (!entry) throw new Error("expected a booking to record a roll call against");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("expected seeded staff missing");
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: reef.id,
      bookingId: entry.booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "after_dive_2",
      occurredAt: nowDate(),
    });

    const refused = await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: 1,
    });
    expect(refused).toEqual({
      ok: false,
      reason: "planned_dives_below_history",
      detail: { recordedDiveCount: 2 },
    });
    expect((await getTripWithBooked(db, shop.id, reef.id))?.plannedDives).toBe(reef.plannedDives);

    // Equal to the recorded history is fine; only going below it is refused.
    const accepted = await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: 2,
    });
    expect(accepted.ok).toBe(true);
  });

  it("stores up to four ordered dives while allowing blank dive details", async () => {
    const { db, shop } = await seededShopContext();
    const existing = (await upcomingTripsWithCounts(db, shop.id)).find((trip) => trip.diveSiteId);
    if (!existing) throw new Error("seeded dive site missing");

    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Four-dive weekend",
      startsAt: new Date("2030-08-03T13:00:00.000Z"),
      endsAt: new Date("2030-08-03T21:00:00.000Z"),
      capacity: 10,
      plannedDives: 4,
      dives: [
        { title: "Morning reef", diveSiteId: existing.diveSiteId },
        { title: "Second tank", description: "A relaxed second site." },
        {},
        { title: "Sunset drift" },
      ],
    });
    if (!trip) throw new Error("trip not created");

    const dives = await listTripDives(db, shop.id, trip.id);
    expect(dives).toHaveLength(4);
    expect(dives.map(({ dive }) => dive.diveNumber)).toEqual([1, 2, 3, 4]);
    expect(dives[0]?.dive.title).toBe("Morning reef");
    expect(dives[0]?.diveSite?.id).toBe(existing.diveSiteId);
    expect(dives[1]?.dive.description).toBe("A relaxed second site.");
    expect(dives[2]?.dive.title).toBeNull();
    expect(
      await createTrip(db, {
        shopId: shop.id,
        title: "Too many dives",
        startsAt: new Date("2030-08-04T13:00:00.000Z"),
        endsAt: new Date("2030-08-04T21:00:00.000Z"),
        capacity: 10,
        plannedDives: 5,
      }),
    ).toBeNull();
  });
});
