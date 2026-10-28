import { randomBytes } from "node:crypto";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { bookings, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";
import { updateTrip, updateTripSection } from "./trips-record";

/**
 * Staff shrinking a departure while a diver books it (A§4 item 7).
 *
 * `updateTrip` locks the trip row before it counts the seats held, the same
 * lock `createBookingRecord` takes before it counts them to sell one. Under
 * READ COMMITTED without that pairing, the edit could count two divers, the
 * booking could add a third, and the edit could then write a capacity of two
 * over a boat carrying three. The sequential version of this lives in
 * `trips-record.test.ts`; PGlite cannot run the two at once.
 *
 * Either order is a correct answer: the booking lands and the shrink is
 * refused (`capacity_below_booked`), or the shrink lands and the booking is
 * refused (`trip_full`). So the test asserts the invariant, never who won:
 * exactly one of the two succeeds, and the seats held never exceed the
 * capacity the row ends with. The gate only makes the two simultaneous
 * (docs/engineering/testing.md, "Reading a race test correctly").
 */

const HOUR_MS = 60 * 60 * 1000;

async function tripWithTwoOfThreeTaken(db: AppDb) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({ name: `Shrink ${suffix}`, slug: `shrink-${suffix}`, timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const startsAt = new Date(nowDate().getTime() + 24 * HOUR_MS);
  const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
  const [trip] = await db
    .insert(trips)
    .values({ shopId: shop.id, title: "Two-Tank Reef", startsAt, endsAt, capacity: 3 })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  for (const name of ["Nora Quinn", "Ravi Chandra"]) {
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: name,
      email: `${name.split(" ")[0]?.toLowerCase()}-${suffix}@example.com`,
    });
    if (!booked.ok) throw new Error(`setup booking failed: ${booked.reason}`);
  }
  return { shopId: shop.id, trip };
}

async function seatsAndCapacity(db: AppDb, tripId: string) {
  const [held] = await db
    .select({ seats: count(bookings.id) })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")));
  const [row] = await db
    .select({ capacity: trips.capacity })
    .from(trips)
    .where(eq(trips.id, tripId));
  return { seats: held?.seats ?? 0, capacity: row?.capacity ?? 0 };
}

const tripRowLock = (tripId: string) => sql`select id from trips where id = ${tripId} for update`;

describePostgres("updateTrip against createBooking under real concurrency", () => {
  it("never leaves more divers aboard than the capacity a simultaneous shrink writes", async () => {
    const pg = await postgresTestDb();
    const { shopId, trip } = await tripWithTwoOfThreeTaken(pg.db);

    const gate = await holdRowLock(pg, tripRowLock(trip.id));
    const shrink = updateTrip(pg.connect(), shopId, trip.id, {
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: 2,
      plannedDives: trip.plannedDives,
    });
    const book = createBooking(pg.connect(), {
      actor: "staff",
      shopId,
      tripId: trip.id,
      fullName: "Third Diver",
      email: "third@example.com",
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    const [shrunk, booked] = await Promise.all([shrink, book]);

    expect([shrunk.ok, booked.ok].filter(Boolean)).toHaveLength(1);
    if (shrunk.ok) expect(booked).toEqual({ ok: false, reason: "trip_full" });
    else expect(shrunk).toMatchObject({ ok: false, reason: "capacity_below_booked" });
    const after = await seatsAndCapacity(pg.db, trip.id);
    expect(after.seats).toBeLessThanOrEqual(after.capacity);
  });
});

describePostgres("independent departure section saves (#3141)", () => {
  it("retains both subjects when two section saves wait on the same row", async () => {
    const pg = await postgresTestDb();
    const { shopId, trip } = await tripWithTwoOfThreeTaken(pg.db);
    const gate = await holdRowLock(pg, tripRowLock(trip.id));
    const rename = updateTripSection(pg.connect(), shopId, trip.id, { title: "Renamed departure" });
    const price = updateTripSection(pg.connect(), shopId, trip.id, { priceCents: 16500 });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    expect((await Promise.all([rename, price])).every((result) => result.ok)).toBe(true);
    const [saved] = await pg.db
      .select({ title: trips.title, priceCents: trips.priceCents, startsAt: trips.startsAt })
      .from(trips)
      .where(and(eq(trips.id, trip.id), eq(trips.shopId, shopId), liveTrip()));
    expect(saved).toEqual({
      title: "Renamed departure",
      priceCents: 16500,
      startsAt: trip.startsAt,
    });
  });
});
