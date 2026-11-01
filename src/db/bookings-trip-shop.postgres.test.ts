import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { sqlStateOf } from "./query-helpers";
import { bookings, people, shops, trips } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **A booking's shop is its trip's shop, in the database** (issue #3285).
 *
 * `liveBookingJoin` joins a seat to its departure by `trip_id` alone, and about
 * fifteen readers (the schedule, the week board, capacity counts) trust it to
 * stay inside one shop. No writer creates a mismatched row today — each books a
 * trip it loaded for the booking's own shop — so the key
 * `bookings_trip_shop_fk` over `(shop_id, trip_id)` is what makes that true of
 * every row rather than of every writer we have audited.
 *
 * Run on a real server rather than PGlite because this is the engine the
 * migration lands on, and the refusal is the engine's, not the code's.
 */

const HOUR_MS = 60 * 60 * 1000;
const FK = "bookings_trip_shop_fk";

/** A shop with one departure tomorrow and one diver on its books. */
async function shopWithTrip(db: AppDb, label: string) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({
      name: `${label} Divers ${suffix}`,
      slug: `${label.toLowerCase()}-${suffix}`,
      timezone: "America/New_York",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const startsAt = new Date(nowDate().getTime() + 24 * HOUR_MS);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: `${label} Reef`,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 6,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: `${label} Diver`, email: `${suffix}@example.com` })
    .returning();
  if (!person) throw new Error("person insert returned no row");
  return { shopId: shop.id, tripId: trip.id, personId: person.id };
}

/** The SQLSTATE and constraint name of a refused write, read through drizzle's wrapper. */
async function refusal(write: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await write;
  } catch (error) {
    let constraint: string | undefined;
    for (let link: unknown = error; link; link = (link as { cause?: unknown }).cause) {
      const named = (link as { constraint?: unknown }).constraint;
      if (typeof named === "string") {
        constraint = named;
        break;
      }
    }
    return { code: sqlStateOf(error), constraint };
  }
  throw new Error("expected the write to be refused, and it succeeded");
}

async function bookedOn(db: AppDb, shopId: string, tripId: string): Promise<number | undefined> {
  const rows = await upcomingTripsWithCounts(db, shopId);
  return rows.find((row) => row.id === tripId)?.booked;
}

describePostgres("bookings_trip_shop_fk: a seat stays in its trip's shop", () => {
  it("refuses a new booking that names one shop and another shop's trip", async () => {
    const pg = await postgresTestDb();
    const a = await shopWithTrip(pg.db, "Alpha");
    const b = await shopWithTrip(pg.db, "Bravo");

    const failure = await refusal(
      pg.db.insert(bookings).values({
        shopId: b.shopId,
        tripId: a.tripId,
        personId: b.personId,
        bookedAs: "diver",
      }),
    );

    expect(failure).toEqual({ code: "23503", constraint: FK });
    expect(await pg.db.select().from(bookings)).toEqual([]);
    expect(await bookedOn(pg.db, a.shopId, a.tripId)).toBe(0);
    expect(await bookedOn(pg.db, b.shopId, b.tripId)).toBe(0);
  });

  it("refuses moving an existing booking onto another shop's trip, and keeps its seat where it was", async () => {
    const pg = await postgresTestDb();
    const a = await shopWithTrip(pg.db, "Alpha");
    const b = await shopWithTrip(pg.db, "Bravo");
    const booked = await createBooking(pg.db, {
      actor: "staff",
      shopId: a.shopId,
      tripId: a.tripId,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    if (!booked.ok) throw new Error(`setup booking refused: ${booked.reason}`);

    const failure = await refusal(
      pg.db.update(bookings).set({ tripId: b.tripId }).where(eq(bookings.id, booked.bookingId)),
    );

    expect(failure).toEqual({ code: "23503", constraint: FK });
    const [row] = await pg.db
      .select({ shopId: bookings.shopId, tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, booked.bookingId));
    expect(row).toEqual({ shopId: a.shopId, tripId: a.tripId });
    // The readers that join by trip alone count the seat once, on its own boat.
    expect(await bookedOn(pg.db, a.shopId, a.tripId)).toBe(1);
    expect(await bookedOn(pg.db, b.shopId, b.tripId)).toBe(0);
  });

  it("refuses re-homing an existing booking to another shop while it keeps its trip", async () => {
    const pg = await postgresTestDb();
    const a = await shopWithTrip(pg.db, "Alpha");
    const b = await shopWithTrip(pg.db, "Bravo");
    const booked = await createBooking(pg.db, {
      actor: "staff",
      shopId: a.shopId,
      tripId: a.tripId,
      fullName: "Ravi Chandra",
      email: "ravi@example.com",
    });
    if (!booked.ok) throw new Error(`setup booking refused: ${booked.reason}`);

    const failure = await refusal(
      pg.db.update(bookings).set({ shopId: b.shopId }).where(eq(bookings.id, booked.bookingId)),
    );

    expect(failure).toEqual({ code: "23503", constraint: FK });
    expect(await bookedOn(pg.db, a.shopId, a.tripId)).toBe(1);
  });

  it("still refuses a booking on a trip that does not exist, and a trip row deleted under its seats", async () => {
    // The composite key replaced the single-column `trip_id` key, so it has to
    // keep doing that key's two jobs as well.
    const pg = await postgresTestDb();
    const a = await shopWithTrip(pg.db, "Alpha");

    const orphan = await refusal(
      pg.db.insert(bookings).values({
        shopId: a.shopId,
        tripId: crypto.randomUUID(),
        personId: a.personId,
        bookedAs: "diver",
      }),
    );
    expect(orphan).toEqual({ code: "23503", constraint: FK });

    const booked = await createBooking(pg.db, {
      actor: "staff",
      shopId: a.shopId,
      tripId: a.tripId,
      fullName: "Mia Okafor",
      email: "mia@example.com",
    });
    if (!booked.ok) throw new Error(`setup booking refused: ${booked.reason}`);
    const hardDelete = await refusal(pg.db.delete(trips).where(eq(trips.id, a.tripId)));
    expect(hardDelete).toEqual({ code: "23503", constraint: FK });
    expect(await bookedOn(pg.db, a.shopId, a.tripId)).toBe(1);
  });

  it("accepts a booking whose shop and trip agree", async () => {
    const pg = await postgresTestDb();
    const a = await shopWithTrip(pg.db, "Alpha");

    await pg.db
      .insert(bookings)
      .values({ shopId: a.shopId, tripId: a.tripId, personId: a.personId, bookedAs: "diver" });

    expect(await bookedOn(pg.db, a.shopId, a.tripId)).toBe(1);
  });
});
