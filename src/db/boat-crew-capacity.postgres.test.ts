import { randomBytes } from "node:crypto";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBoat } from "./boats";
import { createBooking } from "./bookings";
import { bookings, people, personRoles, shops, tripAssignments } from "./schema";
import { createTrip } from "./trips-create";
import { setTripCrew } from "./trips-crew";

describePostgres("assigned crew reserves boat capacity against concurrent bookings", () => {
  it("serializes crew assignment before a new booking without removing existing seats", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: `Crew Capacity Race ${suffix}`,
        slug: `crew-capacity-race-${suffix}`,
        timezone: "America/New_York",
      })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");

    const boat = await createBoat(pg.db, shop.id, "Two aboard", 2);
    const startsAt = new Date(nowDate().getTime() + 24 * 3_600_000);
    const trip = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Crew assignment race",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 4,
      boatId: boat.id,
    });
    if (!trip) throw new Error("trip insert returned no row");

    const existing = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Existing passenger",
    });
    expect(existing.ok).toBe(true);

    const [crew] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "New assigned crew" })
      .returning();
    if (!crew) throw new Error("crew insert returned no row");
    await pg.db.insert(personRoles).values({ personId: crew.id, role: "captain" });

    // Park both writers behind one trip-row lock. The crew edit queues first;
    // the booking must then read its committed assignment and the new ceiling.
    const gate = await holdRowLock(pg, sql`select id from trips where id = ${trip.id} for update`);
    const assignCrew = setTripCrew(pg.connect(), shop.id, trip.id, [crew.id]);
    let addPassenger: ReturnType<typeof createBooking> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      addPassenger = createBooking(pg.connect(), {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Concurrent passenger",
      });
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    if (!addPassenger) throw new Error("booking did not start");
    const [crewResult, bookingResult] = await Promise.all([assignCrew, addPassenger]);
    expect(crewResult).toBe(true);
    expect(bookingResult).toMatchObject({ ok: false, reason: "trip_full" });

    const [held] = await pg.db
      .select({ total: count(bookings.id) })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shop.id),
          eq(bookings.tripId, trip.id),
          ne(bookings.status, "cancelled"),
        ),
      );
    const [assigned] = await pg.db
      .select({ total: count(tripAssignments.personId) })
      .from(tripAssignments)
      .where(eq(tripAssignments.tripId, trip.id));
    expect(held?.total).toBe(1);
    expect(assigned?.total).toBe(1);
  });
});
