import { describe, expect, it } from "vitest";
import { people, shops, tripAssignments } from "@/db/schema";
import { createTrip } from "@/db/trips";
import { createBoat } from "@/features/crew-and-boats/boats";
import { fileScopedShopContext } from "@/test/db";
import { getBoatDay } from "./index";

const ctx = fileScopedShopContext();

describe("getBoatDay (in-memory PGlite)", () => {
  it("lists one shop day across boats, names a person crewing two overlapping departures, and stays in its shop", async () => {
    const { db } = ctx;
    const [shop] = await db
      .insert(shops)
      .values({ name: "Two Boats", slug: "two-boats-day", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop fixture missing");
    const boat = async (name: string) => {
      const created = await createBoat(db, shop.id, name, 12);
      if (!created) throw new Error("boat fixture missing");
      return created;
    };
    const [one, two] = [await boat("Mantis I"), await boat("Mantis II")];
    const depart = async (title: string, start: string, end: string, boatId: string, day = 21) => {
      const trip = await createTrip(db, {
        shopId: shop.id,
        title,
        startsAt: new Date(`2026-11-${day}T${start}:00Z`),
        endsAt: new Date(`2026-11-${day}T${end}:00Z`),
        capacity: 8,
        plannedDives: 2,
        boatId,
      });
      if (!trip) throw new Error("trip fixture missing");
      return trip;
    };
    const morning = await depart("Morning reef", "08:00", "12:00", one.id);
    const late = await depart("Late reef", "10:00", "14:00", two.id);
    await depart("Next day", "08:00", "12:00", one.id, 22);
    const [ana] = await db.insert(people).values({ shopId: shop.id, fullName: "Ana" }).returning();
    if (!ana) throw new Error("crew fixture missing");
    // Direct inserts: `setTripCrew` would refuse the overlap, which is what this reader reports.
    await db.insert(tripAssignments).values([
      { tripId: morning.id, personId: ana.id },
      { tripId: late.id, personId: ana.id },
    ]);

    const day = await getBoatDay(db, { shopId: shop.id, date: "2026-11-21", timeZone: "UTC" });
    expect(day.departures.map((d) => [d.title, d.boatName])).toEqual([
      ["Morning reef", "Mantis I"],
      ["Late reef", "Mantis II"],
    ]);
    expect(day.collisions).toEqual([
      { kind: "crew", personId: ana.id, tripIds: [morning.id, late.id] },
    ]);
    const elsewhere = await getBoatDay(db, {
      shopId: ctx.shop.id,
      date: "2026-11-21",
      timeZone: "UTC",
    });
    expect(elsewhere.departures).toEqual([]);
  });
});
