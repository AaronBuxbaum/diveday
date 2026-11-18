import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { recordBoardingObservation } from "./boarding-observations";
import type { AppDb } from "./client";
import { boardingObservations, bookings } from "./schema";
import { resetDemoSchedule, seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { getTripRoster, listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

describePostgres("demo reset and committed dock sightings", () => {
  it("commits a sighting before a held reset can commit", async () => {
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
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resetReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const connection = pg.connect();
    const delayed = new Proxy(connection, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              const result = await work(tx);
              ready();
              await gate;
              return result;
            });
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const reset = resetDemoSchedule(delayed, shop.id, "history");
    void reset.catch(() => undefined);
    let intake: ReturnType<typeof recordBoardingObservation> | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([reset, ...(intake ? [intake] : [])]);
    });
    const key = crypto.randomUUID();
    let result: Awaited<ReturnType<typeof recordBoardingObservation>> | undefined;
    let intakeError: unknown;
    try {
      await Promise.race([resetReady, reset]);
      intake = recordBoardingObservation(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.booking.id,
        recordedByPersonId: staff.person.id,
        clientKey: key,
      });
      void intake.catch(() => undefined);
      result = await intake.catch((error: unknown) => {
        intakeError = error;
        return undefined;
      });
    } finally {
      release();
    }
    await reset.catch(() => undefined);
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.clientKey, key)),
      `intake error: ${String(intakeError)}; cause: ${String(intakeError instanceof Error ? intakeError.cause : undefined)}`,
    ).toHaveLength(1);
    expect(await pg.db.select().from(bookings).where(eq(bookings.id, seat.booking.id))).toEqual([
      beforeBooking,
    ]);
    expect(result).toMatchObject({ ok: true });
  });

  it("rolls back reset when an intake remains uncommitted", async () => {
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
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inserted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const connection = pg.connect();
    // Pause the real intake transaction after its callback, just before commit.
    const delayed = new Proxy(connection, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              const result = await work(tx);
              ready();
              await gate;
              return result;
            });
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const key = crypto.randomUUID();
    const intake = recordBoardingObservation(delayed, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: seat.booking.id,
      recordedByPersonId: staff.person.id,
      clientKey: key,
    });
    void intake.catch(() => undefined);
    let reset: ReturnType<typeof resetDemoSchedule> | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([intake, ...(reset ? [reset] : [])]);
    });
    try {
      await Promise.race([inserted, intake]);
      reset = resetDemoSchedule(pg.connect(), shop.id, "history");
      void reset.catch(() => undefined);
      await waitForLockWaiters(pg.db, 1);
      const blocked = await pg.db.execute(
        sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%person_roles%for update%'`,
      );
      expect(Number((blocked.rows[0] as { count: number }).count)).toBeGreaterThan(0);
      // Reset must finish or refuse while the independent intake is paused.
      await reset.catch(() => undefined);
    } finally {
      release();
    }
    const recorded = await intake;
    expect(recorded).toMatchObject({ ok: true });
    if (!recorded.ok) throw new Error("intake was not retained");
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, recorded.observationId)),
    ).toMatchObject([{ clientKey: key, bookingId: seat.booking.id, tripId: trip.id }]);
    expect(await pg.db.select().from(bookings).where(eq(bookings.id, seat.booking.id))).toEqual([
      beforeBooking,
    ]);
    if (!reset) throw new Error("reset did not start");
    // The paused writer holds a person FK lock; the reset currently times out
    // trying to lock that staff row and rolls back rather than committing.
    await expect(reset).rejects.toMatchObject({ cause: { code: "55P03" } });
  });
});
