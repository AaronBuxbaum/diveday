// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import { getShopBySlug, upcomingTripsWithCounts } from "./queries";
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
    expect(upcoming).toHaveLength(4);

    const starts = upcoming.map((t) => t.startsAt.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));

    const bySlugishTitle = Object.fromEntries(upcoming.map((t) => [t.title, t.booked]));
    expect(bySlugishTitle["Two-Tank Reef — Molasses & French"]).toBe(9);
    expect(bySlugishTitle["Wreck Trip — Spiegel Grove"]).toBe(10);
    expect(bySlugishTitle["Two-Tank Reef — Christ of the Abyss"]).toBe(0);
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
});
