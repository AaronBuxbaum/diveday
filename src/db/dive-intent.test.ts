import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { diveIntentTallyForTrip, diveIntentTallyForTrips } from "./dive-intent";
import { bookings, people, trips } from "./schema";

let seq = 0;

async function makeDiver(db: AppDb, shopId: string) {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: `Diver ${seq}`, email: `intent.${seq}@bluemantis.dive` })
    .returning({ id: people.id });
  if (!person) throw new Error("failed to insert diver");
  return person.id;
}

/** Two seeded departures. Which two does not matter — every seat asserted here is inserted below. */
async function twoTrips(db: AppDb, shopId: string) {
  const rows = await db
    .select({ id: trips.id })
    .from(trips) // diveday:allow-deleted-trips: fixture lookup — any two departures will do
    .where(eq(trips.shopId, shopId))
    .limit(2);
  const [a, b] = rows;
  if (!a || !b) throw new Error("expected the seeded shop to have two departures");
  return [a.id, b.id] as const;
}

describe("diveIntentTallyForTrip", () => {
  it("counts an answer once per seat that gave one", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await twoTrips(db, shop.id);
    for (const intent of ["small_life", "small_life", "easing_back"] as const) {
      await db.insert(bookings).values({
        shopId: shop.id,
        tripId: trip,
        personId: await makeDiver(db, shop.id),
        diveIntent: intent,
      });
    }
    expect(await diveIntentTallyForTrip(db, shop.id, trip)).toEqual([
      { intent: "easing_back", count: 1 },
      { intent: "small_life", count: 2 },
    ]);
  });

  it("says nothing at all for a departure nobody answered on", async () => {
    // Which is most departures for a long while. An empty tally is what lets
    // the buddy panel render no line rather than a heading over nothing.
    const { db, shop } = await seededShopContext();
    const [trip] = await twoTrips(db, shop.id);
    await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip, personId: await makeDiver(db, shop.id) });
    expect(await diveIntentTallyForTrip(db, shop.id, trip)).toEqual([]);
  });

  it("does not count a cancelled seat", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await twoTrips(db, shop.id);
    await db.insert(bookings).values({
      shopId: shop.id,
      tripId: trip,
      personId: await makeDiver(db, shop.id),
      diveIntent: "a_wreck",
      status: "cancelled",
    });
    await db.insert(bookings).values({
      shopId: shop.id,
      tripId: trip,
      personId: await makeDiver(db, shop.id),
      diveIntent: "a_wreck",
    });
    expect(await diveIntentTallyForTrip(db, shop.id, trip)).toEqual([
      { intent: "a_wreck", count: 1 },
    ]);
  });

  it("does not count a seat on a departure the shop took off the board", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await twoTrips(db, shop.id);
    await db.insert(bookings).values({
      shopId: shop.id,
      tripId: trip,
      personId: await makeDiver(db, shop.id),
      diveIntent: "skills",
    });
    await db
      .update(trips)
      .set({ deletedAt: new Date("2026-06-01T00:00:00Z") })
      .where(eq(trips.id, trip));
    expect(await diveIntentTallyForTrip(db, shop.id, trip)).toEqual([]);
  });

  it("refuses to answer for another shop's departure", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await twoTrips(db, shop.id);
    await db.insert(bookings).values({
      shopId: shop.id,
      tripId: trip,
      personId: await makeDiver(db, shop.id),
      diveIntent: "good_day",
    });
    expect(await diveIntentTallyForTrip(db, "00000000-0000-0000-0000-000000000000", trip)).toEqual(
      [],
    );
  });
});

describe("diveIntentTallyForTrips", () => {
  it("answers a whole day in one read, and leaves silent departures out", async () => {
    const { db, shop } = await seededShopContext();
    const [answered, silent] = await twoTrips(db, shop.id);
    await db.insert(bookings).values({
      shopId: shop.id,
      tripId: answered,
      personId: await makeDiver(db, shop.id),
      diveIntent: "easing_back",
    });
    await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: silent, personId: await makeDiver(db, shop.id) });
    const byTrip = await diveIntentTallyForTrips(db, shop.id, [answered, silent]);
    expect(byTrip.get(answered)).toEqual([{ intent: "easing_back", count: 1 }]);
    expect(byTrip.has(silent)).toBe(false);
  });

  it("asks nothing of the database for an empty day", async () => {
    const { db, shop } = await seededShopContext();
    expect(await diveIntentTallyForTrips(db, shop.id, [])).toEqual(new Map());
  });
});
