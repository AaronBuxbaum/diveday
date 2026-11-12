import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { signDayWindows } from "@/lib/schedule-day-proof";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { people, personRoles, tripScheduleDays, trips } from "./schema";
import { createTrip, getTripCrewIds, setTripCrew } from "./trips";
import { moveTripCrew } from "./trips-crew";

describePostgres("concurrent crew transfers", () => {
  it("allows one of two simultaneous moves from the same source", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Crew" })
      .returning();
    if (!person) throw new Error("expected person");
    await pg.db.insert(personRoles).values({ personId: person.id, role: "divemaster" });
    const make = (title: string) =>
      createTrip(pg.db, {
        shopId: shop.id,
        title,
        startsAt: new Date("2035-08-04T08:00:00Z"),
        endsAt: new Date("2035-08-04T12:00:00Z"),
        capacity: 8,
      });
    const [source, one, two] = await Promise.all([make("Source"), make("One"), make("Two")]);
    if (!source || !one || !two) throw new Error("expected trips");
    expect(await setTripCrew(pg.db, shop.id, source.id, [person.id])).toBe(true);
    const input = { shopId: shop.id, fromTripId: source.id, personId: person.id };
    const outcomes = await Promise.all([
      moveTripCrew(pg.connect(), { ...input, toTripId: one.id }),
      moveTripCrew(pg.connect(), { ...input, toTripId: two.id }),
    ]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const crews = await Promise.all(
      [source, one, two].map((trip) => getTripCrewIds(pg.db, shop.id, trip.id)),
    );
    expect(crews[0]).not.toContain(person.id);
    expect(crews.flat().filter((id) => id === person.id)).toHaveLength(1);
  });

  it("serializes a crew move against a diver move for the same person", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Dual role", email: "dual@example.test" })
      .returning();
    if (!person) throw new Error("expected person");
    await pg.db.insert(personRoles).values([
      { personId: person.id, role: "divemaster" },
      { personId: person.id, role: "diver" },
    ]);
    const make = (title: string, start: string, end: string) =>
      createTrip(pg.db, {
        shopId: shop.id,
        title,
        startsAt: new Date(start),
        endsAt: new Date(end),
        capacity: 8,
      });
    const crewSource = await make("Crew source", "2035-08-04T05:00:00Z", "2035-08-04T06:00:00Z");
    const diverSource = await make("Diver source", "2035-08-04T06:00:00Z", "2035-08-04T07:00:00Z");
    const crewTarget = await make("Crew target", "2035-08-04T08:00:00Z", "2035-08-04T12:00:00Z");
    const diverTarget = await make("Diver target", "2035-08-04T09:00:00Z", "2035-08-04T13:00:00Z");
    if (!crewSource || !diverSource || !crewTarget || !diverTarget)
      throw new Error("expected trips");
    expect(await setTripCrew(pg.db, shop.id, crewSource.id, [person.id])).toBe(true);
    const { createBooking, moveBooking } = await import("./bookings");
    const seat = await createBooking(pg.db, {
      shopId: shop.id,
      tripId: diverSource.id,
      actor: "staff",
      personId: person.id,
    });
    if (!seat.ok) throw new Error(seat.reason);
    const outcomes = await Promise.all([
      moveTripCrew(pg.connect(), {
        shopId: shop.id,
        fromTripId: crewSource.id,
        toTripId: crewTarget.id,
        personId: person.id,
      }),
      moveBooking(pg.connect(), {
        shopId: shop.id,
        fromTripId: diverSource.id,
        toTripId: diverTarget.id,
        bookingId: seat.bookingId,
        rejectScheduleClashes: true,
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toHaveLength(1);
  });
  it("rechecks the selected day after waiting for a concurrent reschedule", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Stale crew" })
      .returning();
    if (!person) throw new Error("expected person");
    await pg.db.insert(personRoles).values({ personId: person.id, role: "divemaster" });
    const make = (title: string) =>
      createTrip(pg.db, {
        shopId: shop.id,
        title,
        startsAt: new Date("2035-08-04T08:00:00Z"),
        endsAt: new Date("2035-08-04T12:00:00Z"),
        capacity: 8,
      });
    const source = await make("Source");
    const target = await make("Target");
    if (!source || !target) throw new Error("expected trips");
    expect(await setTripCrew(pg.db, shop.id, source.id, [person.id])).toBe(true);
    const fromProof = signDayWindows(shop.id, source.id, "2035-08-04", "UTC", [source]);
    const toProof = signDayWindows(shop.id, target.id, "2035-08-04", "UTC", [target]);
    let ready!: () => void;
    let release!: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const changing = pg.connect().transaction(async (tx) => {
      await tx
        .update(trips)
        .set({
          startsAt: new Date("2035-08-04T15:00:00Z"),
          endsAt: new Date("2035-08-04T19:00:00Z"),
          revision: sql`${trips.revision} + 1`,
        })
        .where(eq(trips.id, target.id));
      await tx
        .update(tripScheduleDays)
        .set({
          startsAt: new Date("2035-08-04T15:00:00Z"),
          endsAt: new Date("2035-08-04T19:00:00Z"),
        })
        .where(eq(tripScheduleDays.tripId, target.id));
      ready();
      await releasePromise;
    });
    await readyPromise;
    const move = moveTripCrew(pg.connect(), {
      shopId: shop.id,
      fromTripId: source.id,
      toTripId: target.id,
      personId: person.id,
      expectedDay: { day: "2035-08-04", timeZone: "UTC", fromProof, toProof },
    });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
    }
    await changing;
    expect((await move).ok).toBe(false);
    expect(await getTripCrewIds(pg.db, shop.id, source.id)).toContain(person.id);
  });
});
