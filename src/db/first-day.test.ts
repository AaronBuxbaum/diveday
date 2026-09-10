import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FIRST_BOAT_CAPACITY } from "@/lib/try-it";
import { seededShopContext } from "@/test/db";
import { listBoats } from "./boats";
import { createFirstDay, type FirstDayShop } from "./first-day";
import { boats, trips } from "./schema";

/** The shape `tripDetailsPatch` reads, off a real seeded shop row. */
function asFirstDayShop(shop: {
  id: string;
  timezone: string;
  currency: string;
  hasBoatDiving: boolean;
  hasShoreDiving: boolean;
  hasPoolDiving: boolean;
}): FirstDayShop {
  return {
    id: shop.id,
    timezone: shop.timezone,
    currency: shop.currency,
    hasBoatDiving: shop.hasBoatDiving,
    hasShoreDiving: shop.hasShoreDiving,
    hasPoolDiving: shop.hasPoolDiving,
  };
}

describe("createFirstDay", () => {
  it("writes the boat and one departure on tomorrow, at the typed time in the shop's zone", async () => {
    const { db, shop } = await seededShopContext();
    // 9 PM on the 1st in UTC is 5 PM on the 1st in Key Largo, so tomorrow is
    // the 2nd there and the boat leaves at 07:30 local — 11:30 UTC.
    const now = new Date("2026-09-01T21:00:00Z");

    const created = await createFirstDay(db, asFirstDayShop(shop), {
      boatName: "Reef Runner",
      departure: "07:30",
      now,
    });
    expect(created).not.toBeNull();
    if (!created) throw new Error("createFirstDay refused a well-formed first day");

    const [boat] = await db.select().from(boats).where(eq(boats.id, created.boatId));
    expect(boat?.name).toBe("Reef Runner");
    expect(boat?.capacity).toBe(FIRST_BOAT_CAPACITY);
    expect(boat?.shopId).toBe(shop.id);

    const [trip] = await db.select().from(trips).where(eq(trips.id, created.tripId));
    expect(trip?.boatId).toBe(created.boatId);
    expect(trip?.diveMode).toBe("boat");
    expect(trip?.capacity).toBe(FIRST_BOAT_CAPACITY);
    // The shop's own word for the day, never DiveDay's.
    expect(trip?.title).toBe("Reef Runner");
    expect(trip?.startsAt.toISOString()).toBe("2026-09-02T11:30:00.000Z");
    // Four hours, the same run the schedule builder's blank form opens with.
    expect(trip?.endsAt.toISOString()).toBe("2026-09-02T15:30:00.000Z");
  });

  it("puts the departure on the shop's tomorrow, not the server's", async () => {
    const { db, shop } = await seededShopContext();
    // 03:00 UTC on the 2nd is still 11 PM on the 1st in Key Largo.
    const created = await createFirstDay(db, asFirstDayShop(shop), {
      boatName: "Night Owl",
      departure: "08:00",
      now: new Date("2026-09-02T03:00:00Z"),
    });
    if (!created) throw new Error("createFirstDay refused a well-formed first day");
    const [trip] = await db.select().from(trips).where(eq(trips.id, created.tripId));
    expect(trip?.startsAt.toISOString()).toBe("2026-09-02T12:00:00.000Z");
  });

  it("keeps a late boat inside its own day rather than refusing it", async () => {
    const { db, shop } = await seededShopContext();
    const created = await createFirstDay(db, asFirstDayShop(shop), {
      boatName: "Last Light",
      departure: "22:00",
      now: new Date("2026-09-01T15:00:00Z"),
    });
    if (!created) throw new Error("a late departure should still be created");
    const [trip] = await db.select().from(trips).where(eq(trips.id, created.tripId));
    expect(trip?.startsAt.toISOString()).toBe("2026-09-03T02:00:00.000Z");
    expect(trip?.endsAt.toISOString()).toBe("2026-09-03T03:59:00.000Z");
  });

  it("refuses a time it cannot read, and writes no boat for it", async () => {
    const { db, shop } = await seededShopContext();
    const before = await listBoats(db, shop.id);

    expect(
      await createFirstDay(db, asFirstDayShop(shop), {
        boatName: "Ghost Ship",
        departure: "half past seven",
        now: new Date("2026-09-01T15:00:00Z"),
      }),
    ).toBeNull();

    expect(await listBoats(db, shop.id)).toHaveLength(before.length);
    expect(
      await db
        .select()
        .from(boats)
        .where(and(eq(boats.shopId, shop.id), eq(boats.name, "Ghost Ship"))),
    ).toHaveLength(0);
  });
});
