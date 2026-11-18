import { and, eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { inspectLegacyBoardingKeys } from "@/features/boarding-receipts";
import { checkBoardingReconciliation } from "@/test/boarding-reconciliation-cases";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { recordBoardingObservation } from "./boarding-observations";
import type { AppDb } from "./client";
import { isLockWaitRefusal } from "./lock-bounds";
import { boardingObservations, bookings } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { getTripRoster, listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

describePostgres("boarding receipt reconciliation", () => {
  it("inventories only a shop's stored keys without granting cutover or changing evidence", async () => {
    await checkBoardingReconciliation((await postgresTestDb()).db);
  });

  it("blocks an old reader only while the database barrier is held", async () => {
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
    const input = {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: seat.booking.id,
      recordedByPersonId: staff.person.id,
    };
    expect(
      await recordBoardingObservation(pg.connect(), { ...input, clientKey: crypto.randomUUID() }),
    ).toMatchObject({ ok: true, replay: false });
    const before = await pg.db
      .select()
      .from(boardingObservations)
      .where(eq(boardingObservations.bookingId, seat.booking.id));
    expect(before).toHaveLength(1);
    const [canonical] = before;
    if (!canonical) throw new Error("canonical observation missing");
    const beforeBooking = await pg.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, seat.booking.id));

    let releaseReader!: () => void;
    let readerReady!: () => void;
    const readerGate = new Promise<void>((resolve) => {
      releaseReader = resolve;
    });
    const readerHeld = new Promise<void>((resolve) => {
      readerReady = resolve;
    });
    const oldConnection = pg.connect();
    const oldWriter = new Proxy(oldConnection, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              const result = await work(tx);
              readerReady();
              await readerGate;
              return result;
            });
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const joinedKey = crypto.randomUUID();
    const joined = recordBoardingObservation(oldWriter, {
      ...input,
      clientKey: joinedKey,
    });
    void joined.catch(() => undefined);
    let releaseBarrier!: () => void;
    let barrierReady!: () => void;
    const barrierGate = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const barrierHeld = new Promise<void>((resolve) => {
      barrierReady = resolve;
    });
    let barrier: Promise<void> | undefined;
    let afterBarrier: ReturnType<typeof recordBoardingObservation> | undefined;
    onTestFinished(async () => {
      releaseReader();
      releaseBarrier();
      await Promise.allSettled([
        joined,
        ...(barrier ? [barrier] : []),
        ...(afterBarrier ? [afterBarrier] : []),
      ]);
    });
    try {
      const held = await Promise.race([readerHeld.then(() => true), joined.then(() => false)]);
      if (!held) throw new Error("old writer finished before its commit gate");
      const report = await pg.db.transaction((tx) =>
        inspectLegacyBoardingKeys(tx, shop.id, [
          {
            shopId: shop.id,
            clientKey: canonical.clientKey,
            observationId: canonical.id,
            bookingId: canonical.bookingId,
            tripId: canonical.tripId,
            recordedByPersonId: canonical.recordedByPersonId,
          },
        ]),
      );
      expect(report).toMatchObject({
        matchingSelectedFields: 1,
        missing: 0,
        writerDrain: "unverified",
        priorJoinedKeyCoverage: "unknown",
        cutoverPermitted: false,
      });
      const refused = await pg
        .connect()
        .transaction(async (tx) => {
          await tx.execute(sql`lock table boarding_observations in access exclusive mode nowait`);
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(isLockWaitRefusal(refused)).toBe(true);
    } finally {
      releaseReader();
    }
    expect(await joined).toMatchObject({ ok: true, replay: true });
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(
          and(
            eq(boardingObservations.shopId, shop.id),
            eq(boardingObservations.clientKey, joinedKey),
          ),
        ),
    ).toEqual([]);
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.bookingId, seat.booking.id)),
    ).toEqual(before);
    expect(await pg.db.select().from(bookings).where(eq(bookings.id, seat.booking.id))).toEqual(
      beforeBooking,
    );

    let barrierPid = 0;
    barrier = pg.connect().transaction(async (tx) => {
      await tx.execute(sql`lock table boarding_observations in access exclusive mode nowait`);
      const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
      barrierPid = Number((pid.rows[0] as { pid: number }).pid);
      barrierReady();
      await barrierGate;
    });
    void barrier.catch(() => undefined);
    const nextKey = crypto.randomUUID();
    let identify!: (pid: number) => void;
    const contenderPid = new Promise<number>((resolve) => {
      identify = resolve;
    });
    const nextConnection = pg.connect();
    const nextWriter = new Proxy(nextConnection, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
              identify(Number((pid.rows[0] as { pid: number }).pid));
              return work(tx);
            });
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      await Promise.race([barrierHeld, barrier]);
      afterBarrier = recordBoardingObservation(nextWriter, { ...input, clientKey: nextKey });
      void afterBarrier.catch(() => undefined);
      const pid = await Promise.race([
        contenderPid,
        afterBarrier.then(() => {
          throw new Error("old writer finished before identifying its backend");
        }),
      ]);
      let finished = false;
      void afterBarrier.then(
        () => {
          finished = true;
        },
        () => {
          finished = true;
        },
      );
      const deadline = performance.now() + 4_000;
      let blocked = false;
      while (performance.now() < deadline && !finished) {
        const waiting = await pg.db.execute(
          sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and pid = ${pid} and wait_event_type = 'Lock' and ${barrierPid} = any(pg_blocking_pids(pid)) and query like '%boarding_observations%'`,
        );
        if (Number((waiting.rows[0] as { count: number }).count) > 0) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked, "old writer did not block on the held barrier").toBe(true);
    } finally {
      releaseBarrier();
    }
    await barrier;
    if (!afterBarrier) throw new Error("old writer did not start");
    expect(await afterBarrier).toMatchObject({ ok: true, replay: true });
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(
          and(
            eq(boardingObservations.shopId, shop.id),
            eq(boardingObservations.clientKey, nextKey),
          ),
        ),
    ).toEqual([]);
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.bookingId, seat.booking.id)),
    ).toEqual(before);
    expect(await pg.db.select().from(bookings).where(eq(bookings.id, seat.booking.id))).toEqual(
      beforeBooking,
    );
  });
});
