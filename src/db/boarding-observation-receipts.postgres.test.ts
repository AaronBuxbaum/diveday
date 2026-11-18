import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { HOUR_MS, MINUTE_MS } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { recordBoardingObservation } from "./boarding-observations";
import { createBookingParty } from "./bookings";
import type { AppDb } from "./client";
import { boardingObservations, bookings } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { createTrip, listStaff } from "./trips";

const BASE = Date.UTC(2031, 4, 12, 13);

async function shopFixture() {
  const pg = await postgresTestDb();
  await seedDemo(pg.db, "history");
  const shop = await getShopBySlug(pg.db, "blue-mantis");
  if (!shop) throw new Error("shop missing");
  const staff = await listStaff(pg.db, shop.id);
  const [staffer, second] = staff;
  if (!staffer || !second) throw new Error("two staff needed");
  return { pg, shopId: shop.id, staffId: staffer.person.id, secondStaffId: second.person.id };
}

async function departure(db: AppDb, shopId: string, offsetHours = 0, capacity = 2) {
  const startsAt = new Date(BASE + offsetHours * HOUR_MS);
  const trip = await createTrip(db, {
    shopId,
    title: `Dock ${randomUUID().slice(0, 6)}`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity,
  });
  if (!trip) throw new Error("trip not created");
  return trip;
}

async function seats(db: AppDb, shopId: string, tripId: string, names: string[]) {
  const party = await createBookingParty(
    db,
    names.map((fullName) => ({ actor: "staff" as const, shopId, tripId, fullName })),
  );
  if (!party.ok) throw new Error(`seats refused: ${party.reason}`);
  return party.bookings.map((row) => row.bookingId);
}

/** A two-seat boat with one diver aboard and one whose seat the desk released. */
async function releasedSeat() {
  const shop = await shopFixture();
  const trip = await departure(shop.pg.db, shop.shopId);
  const [late, aboard] = await seats(shop.pg.db, shop.shopId, trip.id, ["Late Diver", "On Time"]);
  if (!late || !aboard) throw new Error("seats missing");
  await shop.pg.db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, late));
  return {
    ...shop,
    trip,
    late,
    aboard,
    now: new Date(trip.startsAt.getTime() - 10 * MINUTE_MS),
  };
}

async function observationsOf(db: AppDb, bookingId: string) {
  return db
    .select()
    .from(boardingObservations)
    .where(eq(boardingObservations.bookingId, bookingId));
}

describePostgres("boarding observation receipt keys", () => {
  it("does not retarget a joined key while its transaction is uncommitted", async () => {
    const ctx = await releasedSeat();
    await ctx.pg.db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, ctx.aboard));
    const input = { shopId: ctx.shopId, tripId: ctx.trip.id, recordedByPersonId: ctx.staffId };
    const original = await recordBoardingObservation(ctx.pg.connect(), {
      ...input,
      bookingId: ctx.late,
      clientKey: randomUUID(),
    });
    if (!original.ok) throw new Error(`original sighting refused: ${original.reason}`);
    const before = await observationsOf(ctx.pg.db, ctx.late);
    const seatsBefore = await ctx.pg.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.shopId, ctx.shopId), eq(bookings.tripId, ctx.trip.id)));
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const joinedReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let heldPid = 0;
    const heldConnection = ctx.pg.connect();
    const held = new Proxy(heldConnection, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
              heldPid = Number((pid.rows[0] as { pid: number }).pid);
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
    let identify!: (pid: number) => void;
    const contenderPid = new Promise<number>((resolve) => {
      identify = resolve;
    });
    const contenderConnection = ctx.pg.connect();
    const contender = new Proxy(contenderConnection, {
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
    const key = randomUUID();
    const joined = recordBoardingObservation(held, {
      ...input,
      bookingId: ctx.late,
      clientKey: key,
    });
    void joined.catch(() => undefined);
    let competing: ReturnType<typeof recordBoardingObservation> | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([joined, ...(competing ? [competing] : [])]);
    });
    try {
      const reachedGate = await Promise.race([
        joinedReady.then(() => true),
        joined.then(() => false),
      ]);
      if (!reachedGate) throw new Error("joined transaction finished before commit gate");
      competing = recordBoardingObservation(contender, {
        ...input,
        bookingId: ctx.aboard,
        clientKey: key,
      });
      void competing.catch(() => undefined);
      const pid = await Promise.race([
        contenderPid,
        competing.then(() => {
          throw new Error("contender not identified");
        }),
      ]);
      let finished = false;
      void competing.then(
        () => {
          finished = true;
        },
        () => {
          finished = true;
        },
      );
      let blocked = false;
      const deadline = performance.now() + 4_000;
      while (performance.now() < deadline && !finished) {
        const waiting = await ctx.pg.db.execute(sql`
          select count(*)::int as count from pg_stat_activity
          where datname = current_database() and pid = ${pid} and wait_event_type = 'Lock'
            and ${heldPid} = any(pg_blocking_pids(pid))
        `);
        if (Number((waiting.rows[0] as { count: number }).count) > 0) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(
        blocked || finished,
        "contender neither refused nor blocked on joined transaction",
      ).toBe(true);
    } finally {
      release();
    }
    expect(await joined).toMatchObject({
      ok: true,
      replay: true,
      observationId: original.observationId,
    });
    if (!competing) throw new Error("contender did not start");
    expect(await competing).toEqual({ ok: false, reason: "key_reused" });
    expect(
      await recordBoardingObservation(ctx.pg.connect(), {
        ...input,
        bookingId: ctx.late,
        clientKey: key,
      }),
    ).toMatchObject({
      ok: true,
      replay: true,
      observationId: original.observationId,
    });
    expect(await observationsOf(ctx.pg.db, ctx.late)).toEqual(before);
    expect(await observationsOf(ctx.pg.db, ctx.aboard)).toEqual([]);
    const seatsAfter = await ctx.pg.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.shopId, ctx.shopId), eq(bookings.tripId, ctx.trip.id)));
    expect(seatsAfter.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      seatsBefore.sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it("does not retarget an original key while its first receipt is uncommitted", async () => {
    const ctx = await releasedSeat();
    await ctx.pg.db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, ctx.aboard));
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inserted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const connection = ctx.pg.connect();
    let firstPid = 0;
    const delayed = new Proxy(connection, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
              firstPid = Number((pid.rows[0] as { pid: number }).pid);
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
    const input = {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      recordedByPersonId: ctx.staffId,
      clientKey: randomUUID(),
    };
    const first = recordBoardingObservation(delayed, { ...input, bookingId: ctx.late });
    void first.catch(() => undefined);
    let identifyContender!: (pid: number) => void;
    const contenderPid = new Promise<number>((resolve) => {
      identifyContender = resolve;
    });
    const contenderConnection = ctx.pg.connect();
    const contender = new Proxy(contenderConnection, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              const result = await tx.execute(sql`select pg_backend_pid() as pid`);
              identifyContender(Number((result.rows[0] as { pid: number }).pid));
              return work(tx);
            });
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    let second: ReturnType<typeof recordBoardingObservation> | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    });
    try {
      const held = await Promise.race([inserted.then(() => true), first.then(() => false)]);
      if (!held) throw new Error("first transaction finished before its commit gate");
      second = recordBoardingObservation(contender, { ...input, bookingId: ctx.aboard });
      void second.catch(() => undefined);
      const pid = await Promise.race([
        contenderPid,
        second.then(() => {
          throw new Error("second transaction finished before identifying its connection");
        }),
      ]);
      let contenderFinished = false;
      void second.then(
        () => {
          contenderFinished = true;
        },
        () => {
          contenderFinished = true;
        },
      );
      const deadline = performance.now() + 4_000;
      let blocked = false;
      while (performance.now() < deadline && !contenderFinished) {
        const waiting = await ctx.pg.db.execute(sql`
          select count(*)::int as count from pg_stat_activity
          where datname = current_database() and pid = ${pid} and wait_event_type = 'Lock'
            and ${firstPid} = any(pg_blocking_pids(pid)) and query like '%boarding_%'
        `);
        if (Number((waiting.rows[0] as { count: number }).count) > 0) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked, "second transaction did not block on the first boarding write").toBe(true);
    } finally {
      release();
    }
    const original = await first;
    expect(original).toMatchObject({ ok: true, replay: false, bookingId: ctx.late });
    if (!original.ok || !second) throw new Error("initial sighting was not committed");
    expect(await second).toEqual({ ok: false, reason: "key_reused" });
    expect(await observationsOf(ctx.pg.db, ctx.aboard)).toEqual([]);
    const rows = await observationsOf(ctx.pg.db, ctx.late);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ id: original.observationId, clientKey: input.clientKey });
    expect(
      await recordBoardingObservation(ctx.pg.connect(), { ...input, bookingId: ctx.late }),
    ).toMatchObject({
      ok: true,
      replay: true,
      observationId: original.observationId,
    });
  });

  it("reserves a joined tap's key when two different seats request it", async () => {
    const ctx = await releasedSeat();
    await ctx.pg.db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, ctx.aboard));
    const input = {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      recordedByPersonId: ctx.staffId,
    };
    const first = await recordBoardingObservation(ctx.pg.connect(), {
      ...input,
      bookingId: ctx.late,
      clientKey: randomUUID(),
    });
    const second = await recordBoardingObservation(ctx.pg.connect(), {
      ...input,
      bookingId: ctx.aboard,
      clientKey: randomUUID(),
    });
    expect(first).toMatchObject({ ok: true, replay: false });
    expect(second).toMatchObject({ ok: true, replay: false });
    const beforeLate = await observationsOf(ctx.pg.db, ctx.late);
    const beforeAboard = await observationsOf(ctx.pg.db, ctx.aboard);
    expect(beforeLate).toHaveLength(1);
    expect(beforeAboard).toHaveLength(1);

    const key = randomUUID();
    const results = await Promise.all([
      recordBoardingObservation(ctx.pg.connect(), {
        ...input,
        bookingId: ctx.late,
        clientKey: key,
      }),
      recordBoardingObservation(ctx.pg.connect(), {
        ...input,
        bookingId: ctx.aboard,
        clientKey: key,
      }),
    ]);
    const accepted = results.filter((result) => result.ok);
    const refused = results.filter((result) => !result.ok);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ replay: true });
    expect(refused).toEqual([{ ok: false, reason: "key_reused" }]);
    const winner = accepted[0];
    if (!winner?.ok) throw new Error("joined tap was not acknowledged");
    const original = winner.bookingId === ctx.late ? first : second;
    if (!original.ok) throw new Error("original sighting missing");
    expect(winner.observationId).toBe(original.observationId);
    expect(
      await recordBoardingObservation(ctx.pg.connect(), {
        ...input,
        bookingId: winner.bookingId,
        clientKey: key,
      }),
    ).toMatchObject({ ok: true, replay: true, observationId: original.observationId });
    expect(await observationsOf(ctx.pg.db, ctx.late)).toEqual(beforeLate);
    expect(await observationsOf(ctx.pg.db, ctx.aboard)).toEqual(beforeAboard);
  });

  it("does not spend an acknowledged joined key on two other seats", async () => {
    const ctx = await shopFixture();
    const trip = await departure(ctx.pg.db, ctx.shopId, 0, 3);
    const [firstSeat, secondSeat, thirdSeat] = await seats(ctx.pg.db, ctx.shopId, trip.id, [
      "Original",
      "Second",
      "Third",
    ]);
    if (!firstSeat || !secondSeat || !thirdSeat) throw new Error("three seats needed");
    for (const bookingId of [firstSeat, secondSeat, thirdSeat]) {
      await ctx.pg.db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingId));
    }
    const input = { shopId: ctx.shopId, tripId: trip.id, recordedByPersonId: ctx.staffId };
    const original = await recordBoardingObservation(ctx.pg.connect(), {
      ...input,
      bookingId: firstSeat,
      clientKey: randomUUID(),
    });
    if (!original.ok) throw new Error(`original sighting refused: ${original.reason}`);
    const joinedKey = randomUUID();
    expect(
      await recordBoardingObservation(ctx.pg.connect(), {
        ...input,
        bookingId: firstSeat,
        recordedByPersonId: ctx.secondStaffId,
        clientKey: joinedKey,
      }),
    ).toMatchObject({ ok: true, replay: true, observationId: original.observationId });
    const before = await observationsOf(ctx.pg.db, firstSeat);
    const results = await Promise.all(
      [secondSeat, thirdSeat].map((bookingId) =>
        recordBoardingObservation(ctx.pg.connect(), {
          ...input,
          bookingId,
          recordedByPersonId: ctx.secondStaffId,
          clientKey: joinedKey,
        }),
      ),
    );
    expect(results).toEqual([
      { ok: false, reason: "key_reused" },
      { ok: false, reason: "key_reused" },
    ]);
    expect(await observationsOf(ctx.pg.db, firstSeat)).toEqual(before);
    expect(await observationsOf(ctx.pg.db, secondSeat)).toEqual([]);
    expect(await observationsOf(ctx.pg.db, thirdSeat)).toEqual([]);
  });
});
