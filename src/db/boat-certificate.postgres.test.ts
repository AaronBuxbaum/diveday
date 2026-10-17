import { randomBytes } from "node:crypto";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBoat, updateBoatWithinCertificate } from "./boats";
import { createBooking } from "./bookings";
import { boats, bookings, shops, trips } from "./schema";

/**
 * **A certificate edit and a booking on the hull's departure, at once** (#2396).
 *
 * `updateBoatWithinCertificate` locks the hull and then its upcoming
 * departures; `createBookingRecord` locks the departure and reads the hull's
 * certificate under that lock. Both take the trip `FOR NO KEY UPDATE`, so they
 * queue rather than deadlock, and whichever goes second sees the other's
 * committed state. The gate holds the departure so both are parked inside
 * their transactions before either runs (PGlite is single-connection and
 * cannot show this; `@/test/postgres`).
 */
describePostgres("a hull's certificate edit against a booking on its departure", () => {
  it("both return, the seat is sold within the certificate, and the edit lands", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: `Cert Race ${suffix}`,
        slug: `cert-race-${suffix}`,
        timezone: "America/New_York",
      })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const boat = await createBoat(pg.db, shop.id, "Certified Hull", 6);
    const startsAt = new Date(nowDate().getTime() + 24 * 3_600_000);
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "On the hull",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        capacity: 2,
        boatId: boat.id,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const first = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    expect(first.ok).toBe(true);

    const gate = await holdRowLock(pg, sql`select id from trips where id = ${trip.id} for update`);
    const edit = updateBoatWithinCertificate(pg.connect(), {
      shopId: shop.id,
      boatId: boat.id,
      name: "Certified Hull",
      capacity: 2,
      description: null,
      papers: {
        certifiedPassengers: 2,
        certifiedTotalPersons: null,
        coiExpiresOn: null,
        inspectionDueOn: null,
        registrationExpiresOn: null,
        insuranceExpiresOn: null,
      },
      timeZone: "America/New_York",
    });
    await waitForLockWaiters(pg.db, 1);
    const booking = createBooking(pg.connect(), {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Ravi Chandra",
      email: "ravi@example.com",
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    const [edited, booked] = await Promise.allSettled([edit, booking]);
    expect(edited).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(booked).toMatchObject({ status: "fulfilled", value: { ok: true } });
    const [{ seats } = { seats: 0 }] = await pg.db
      .select({ seats: count(bookings.id) })
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), ne(bookings.status, "cancelled")));
    expect(seats).toBe(2);
    const [saved] = await pg.db.select().from(boats).where(eq(boats.id, boat.id));
    expect(saved?.certifiedPassengers).toBe(2);
  });
});
