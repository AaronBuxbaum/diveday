// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import {
  createTrip,
  getShopBySlug,
  getTripWithBooked,
  upcomingTripsWithCounts,
  updateTrip,
} from "./queries";
import { bookings } from "./schema";
import { seedDemo } from "./seed";

describe("demo seed + schedule queries (in-memory PGlite)", () => {
  it("seeds a shop retrievable by slug", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    expect(shop?.name).toBe("Blue Mantis Divers");
    expect(shop?.timezone).toBe("America/New_York");
  });

  it("returns upcoming trips ordered by start with correct booked counts", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("demo shop missing");

    const upcoming = await upcomingTripsWithCounts(db, shop.id);
    expect(upcoming).toHaveLength(5);

    const starts = upcoming.map((t) => t.startsAt.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));

    const bySlugishTitle = Object.fromEntries(upcoming.map((t) => [t.title, t.booked]));
    expect(bySlugishTitle["Two-Tank Reef — Molasses & French"]).toBe(9);
    expect(bySlugishTitle["Wreck Trip — Spiegel Grove"]).toBe(10);
    expect(bySlugishTitle["Two-Tank Reef — Christ of the Abyss"]).toBe(0);
    expect(
      upcoming.find((trip) => trip.title === "Discover Scuba — Pool & Reef")?.course?.title,
    ).toBe("Discover Scuba Diving");
  });

  it("frees the spot when a booking is cancelled", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("demo shop missing");

    const before = await upcomingTripsWithCounts(db, shop.id);
    const wreck = before.find((t) => t.title === "Wreck Trip — Spiegel Grove");
    if (!wreck) throw new Error("wreck trip missing");
    expect(wreck.booked).toBe(wreck.capacity); // seeded sold out

    const [first] = await db.select().from(bookings).limit(1);
    if (!first) throw new Error("no bookings seeded");
    const { eq } = await import("drizzle-orm");
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, first.id));

    const after = await upcomingTripsWithCounts(db, shop.id);
    const total = (rows: typeof after) => rows.reduce((sum, t) => sum + t.booked, 0);
    expect(total(after)).toBe(total(before) - 1);
  });

  it("stores an optional per-diver price and lets staff update or clear it", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("demo shop missing");

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
});
