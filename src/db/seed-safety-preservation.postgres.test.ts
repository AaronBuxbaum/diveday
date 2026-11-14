import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { recordBoardingObservation } from "./boarding-observations";
import type { AppDb } from "./client";
import { boardingObservations, bookings } from "./schema";
import { resetDemoSchedule, seedDemo } from "./seed";
import { deleteDemoShopCascade } from "./seed-demo-lifecycle";
import { getShopBySlug } from "./shops";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

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
      result = await intake.catch(() => undefined);
    } finally {
      release();
    }
    await reset.catch(() => undefined);
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.clientKey, key)),
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

  it("does not finish reset when intake commits after the sighting delete", async () => {
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
    await pg.db.execute(
      sql.raw(`
      create function gate_after_sighting_delete() returns trigger language plpgsql as $$
      begin perform pg_advisory_xact_lock(73044); return null; end $$;
      create trigger gate_after_sighting_delete after delete on boarding_observations
      for each statement execute function gate_after_sighting_delete();
    `),
    );
    const gate = await holdRowLock(pg, sql`select pg_advisory_xact_lock(73044)`);
    const reset = resetDemoSchedule(pg.connect(), shop.id, "history");
    void reset.catch(() => undefined);
    onTestFinished(async () => {
      await gate.release();
      await Promise.allSettled([reset]);
    });
    let observation: typeof boardingObservations.$inferSelect | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
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
      if (!observation) throw new Error("committed sighting missing");
    } finally {
      await gate.release();
    }
    const outcome = await reset.then(
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
    expect(outcome).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining("unresolved safety evidence"),
      }),
    });
  });

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
