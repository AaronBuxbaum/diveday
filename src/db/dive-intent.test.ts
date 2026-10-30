import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTrip } from "@/db/trips";
import { diveIntentTally } from "@/lib/dive-intent";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { diveIntentTallyForTrip, diveIntentTallyForTrips } from "./dive-intent";
import { bookings, people, shops, trips } from "./schema";

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

/**
 * Two seeded departures that carry no answers of their own.
 *
 * The exclusion is the whole point: the demo seeds intents onto today's reef
 * boat so the aggregate line has a visual baseline (issue #1413), and a fixture
 * that took the first two rows would sometimes take that one — making "a silent
 * departure is left out of the map" fail on seed colour rather than on the
 * behaviour it names.
 */
async function twoTrips(db: AppDb, shopId: string) {
  const answered = db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), isNotNull(bookings.diveIntent)));
  const rows = await db
    .select({ id: trips.id })
    .from(trips) // diveday:allow-deleted-trips: fixture lookup — any two silent departures will do
    .where(and(eq(trips.shopId, shopId), notInArray(trips.id, answered)))
    .limit(2);
  const [a, b] = rows;
  if (!a || !b) throw new Error("expected the seeded shop to have two departures with no answers");
  return [a.id, b.id] as const;
}

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

describe("diveIntentTallyForTrip", () => {
  it("counts an answer once per seat that gave one", async () => {
    const { db, shop } = ctx;
    const [trip] = await twoTrips(db, shop.id);
    const answers = ["small_life", "small_life", "easing_back", "good_day", "easing_back"] as const;
    for (const intent of answers) {
      await db.insert(bookings).values({
        bookedAs: "diver",
        shopId: shop.id,
        tripId: trip,
        personId: await makeDiver(db, shop.id),
        diveIntent: intent,
      });
    }
    expect(await diveIntentTallyForTrip(db, shop.id, trip)).toEqual(diveIntentTally(answers));
    expect(await diveIntentTallyForTrip(db, shop.id, trip)).toEqual([
      { intent: "easing_back", count: 2 },
      { intent: "small_life", count: 2 },
      { intent: "good_day", count: 1 },
    ]);
  });

  it("says nothing at all for a departure nobody answered on", async () => {
    // Which is most departures for a long while. An empty tally is what lets
    // the buddy panel render no line rather than a heading over nothing.
    const { db, shop } = ctx;
    const [trip] = await twoTrips(db, shop.id);
    await db.insert(bookings).values({
      bookedAs: "diver",
      shopId: shop.id,
      tripId: trip,
      personId: await makeDiver(db, shop.id),
    });
    expect(await diveIntentTallyForTrip(db, shop.id, trip)).toEqual([]);
  });

  it("does not count a canceled seat", async () => {
    const { db, shop } = ctx;
    const [trip] = await twoTrips(db, shop.id);
    await db.insert(bookings).values({
      bookedAs: "diver",
      shopId: shop.id,
      tripId: trip,
      personId: await makeDiver(db, shop.id),
      diveIntent: "a_wreck",
      status: "cancelled",
    });
    await db.insert(bookings).values({
      bookedAs: "diver",
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
    const { db, shop } = ctx;
    const [trip] = await twoTrips(db, shop.id);
    await db.insert(bookings).values({
      bookedAs: "diver",
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
    const { db, shop } = ctx;
    const [trip] = await twoTrips(db, shop.id);
    await db.insert(bookings).values({
      bookedAs: "diver",
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
    const { db, shop } = ctx;
    const [answered, silent] = await twoTrips(db, shop.id);
    const answers = ["small_life", "easing_back", "good_day", "small_life", "easing_back"] as const;
    for (const intent of answers) {
      await db.insert(bookings).values({
        bookedAs: "diver",
        shopId: shop.id,
        tripId: answered,
        personId: await makeDiver(db, shop.id),
        diveIntent: intent,
      });
    }
    await db.insert(bookings).values({
      bookedAs: "diver",
      shopId: shop.id,
      tripId: silent,
      personId: await makeDiver(db, shop.id),
    });

    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "intent-rival-reef", timezone: "America/New_York" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    const rivalTrip = await createTrip(db, {
      shopId: rival.id,
      title: "Rival Reef morning dive",
      startsAt: new Date("2030-09-01T12:00:00Z"),
      endsAt: new Date("2030-09-01T16:00:00Z"),
      capacity: 6,
      plannedDives: 2,
      diveMode: "shore",
    });
    if (!rivalTrip) throw new Error("rival trip creation failed");
    await db.insert(bookings).values({
      bookedAs: "diver",
      shopId: rival.id,
      tripId: rivalTrip.id,
      personId: await makeDiver(db, rival.id),
      diveIntent: "a_wreck",
    });

    const byTrip = await diveIntentTallyForTrips(db, shop.id, [answered, silent, rivalTrip.id]);
    expect(byTrip.get(answered)).toEqual(diveIntentTally(answers));
    expect(byTrip.get(answered)).toEqual([
      { intent: "easing_back", count: 2 },
      { intent: "small_life", count: 2 },
      { intent: "good_day", count: 1 },
    ]);
    expect(byTrip.has(silent)).toBe(false);
    expect(byTrip.has(rivalTrip.id)).toBe(false);
  });

  it("asks nothing of the database for an empty day", async () => {
    const { db, shop } = ctx;
    expect(await diveIntentTallyForTrips(db, shop.id, [])).toEqual(new Map());
  });
});
