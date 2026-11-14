import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { recordBoardingObservation } from "./boarding-observations";
import { boardingObservations, bookings } from "./schema";
import { resetDemoSchedule, seedDemo } from "./seed";
import { deleteDemoShopCascade } from "./seed-demo-lifecycle";
import { getShopBySlug } from "./shops";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

describePostgres("demo reset and committed dock sightings", () => {
  it("retains an intake that commits while reset is past its empty check", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    if (!trip) throw new Error("trip missing");
    const [seat] = await getTripRoster(pg.db, shop.id, trip.id);
    const [staff] = await listStaff(pg.db, shop.id);
    if (!seat || !staff) throw new Error("seat or staff missing");
    await pg.db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, seat.booking.id));
    const [beforeBooking] = await pg.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, seat.booking.id));
    const gate = await holdRowLock(
      pg,
      sql`select id from shops where id = ${shop.id} for no key update`,
    );
    const reset = resetDemoSchedule(pg.connect(), shop.id, "history");
    void reset.catch(() => undefined);
    onTestFinished(async () => {
      await gate.release();
      await Promise.allSettled([reset]);
    });
    let observation: typeof boardingObservations.$inferSelect | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      const probe = await pg.db.execute(
        sql`select pg_try_advisory_xact_lock_shared(hashtext('boarding_certification_evidence'), hashtext(${shop.id})) as acquired`,
      );
      expect(probe.rows[0]).toMatchObject({ acquired: false });
      const waiting = await pg.db.execute(
        sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%offline_dataset_incarnation%'`,
      );
      expect(Number((waiting.rows[0] as { count: number }).count)).toBeGreaterThan(0);
      const intake = await recordBoardingObservation(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.booking.id,
        recordedByPersonId: staff.person.id,
        clientKey: crypto.randomUUID(),
      });
      if (!intake.ok) throw new Error(`intake refused: ${intake.reason}`);
      [observation] = await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, intake.observationId));
      expect(observation).toMatchObject({ tripId: trip.id, bookingId: seat.booking.id });
    } finally {
      await gate.release();
    }
    const resetOutcome = await reset.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (!observation) throw new Error("committed sighting missing");
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, observation.id)),
    ).toEqual([observation]);
    expect(await pg.db.select().from(bookings).where(eq(bookings.id, seat.booking.id))).toEqual([
      beforeBooking,
    ]);
    expect(resetOutcome).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining("unresolved safety evidence"),
      }),
    });
  });

  it("refuses a reset and keeps the sighting and key", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    if (!trip) throw new Error("trip missing");
    const [seat] = await getTripRoster(pg.db, shop.id, trip.id);
    const [staff] = await listStaff(pg.db, shop.id);
    if (!seat || !staff) throw new Error("seat or staff missing");
    const [observation] = await pg.db
      .insert(boardingObservations)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.booking.id,
        clientKey: crypto.randomUUID(),
        recordedByPersonId: staff.person.id,
      })
      .returning();
    await expect(
      pg.db.transaction((tx) => resetDemoSchedule(tx, shop.id, "history")),
    ).rejects.toThrow("unresolved safety evidence");
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, observation.id)),
    ).toEqual([observation]);
  });

  it("refuses a demo reap when a dock sighting exists", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    if (!trip) throw new Error("trip missing");
    const [seat] = await getTripRoster(pg.db, shop.id, trip.id);
    const [staff] = await listStaff(pg.db, shop.id);
    if (!seat || !staff) throw new Error("seat or staff missing");
    const [observation] = await pg.db
      .insert(boardingObservations)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.booking.id,
        clientKey: crypto.randomUUID(),
        recordedByPersonId: staff.person.id,
      })
      .returning();
    await expect(deleteDemoShopCascade(pg.db, shop.id)).rejects.toThrow(
      "unresolved safety evidence",
    );
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, observation.id)),
    ).toEqual([observation]);
    expect(await getShopBySlug(pg.db, "blue-mantis")).toMatchObject({ id: shop.id });
  });
});
