import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { settleDockObservations, undoBookingNoShow } from "@/features/no-show";
import { setStaffAccountStatus } from "@/features/staff-accounts";
import { HOUR_MS, MINUTE_MS } from "@/lib/clock";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import {
  recordBoardingObservation,
  settleBoardingObservations,
  settleOpenBoardingObservations,
} from "./boarding-observations";
import { createBookingParty, moveBooking } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { lockCrewSchedule } from "./crew-schedule-lock";
import { recordRollCall } from "./manifests";
import { personClashesByTrip } from "./person-clashes";
import { boardingObservations, bookings, people, personRoles, trips, userAccounts } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { changeTripCrewOutcome, createTrip, listStaff, moveTripCrewMember } from "./trips";
import { heldSeatCounts, seatHeld } from "./trips-queries";

/**
 * **Dock sightings and day-board moves on a real server** (issue #4474).
 *
 * The bug this exists for: the desk's "They're here" took the departure's lock,
 * so a move, a sale or a crew edit holding that departure made the tap wait,
 * and a refusal or a lock timeout lost the sighting. These pin the two-step
 * shape under real contention: intake commits past every schedule lock, the
 * seat comes back under the departure lock in either commit order, and the
 * crew writers no longer make a boarding tap anywhere in the shop wait.
 */

const BASE = Date.UTC(2031, 4, 12, 13);

type Pg = Awaited<ReturnType<typeof postgresTestDb>>;

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

/**
 * Hold whatever `work` locks on its own connection until `release` — the
 * stand-in for a schedule writer that is mid-transaction.
 */
async function holding(pg: Pg, work: (tx: DbExecutor) => Promise<void>) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired!: () => void;
  const locked = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const transaction = pg.connect().transaction(async (tx) => {
    await work(tx);
    acquired();
    await held;
  });
  await Promise.race([locked, transaction]);
  return {
    release: async () => {
      release();
      await transaction;
    },
  };
}

/** What a move or a sale holds: the departure and the seat, both `FOR UPDATE`. */
function moveLocks(tripId: string, bookingId: string) {
  return async (tx: DbExecutor) => {
    await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId)).for("update");
    await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");
  };
}

/** What a crew edit holds now: the evidence lock shared, the crew schedule, the departure. */
function crewEditLocks(shopId: string, tripId: string) {
  return async (tx: DbExecutor) => {
    await lockBoardingCertificationEvidence(tx, shopId, "boarding");
    await lockCrewSchedule(tx, shopId, "crew");
    await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId)).for("update");
  };
}

async function observationsOf(db: AppDb, bookingId: string) {
  return db
    .select()
    .from(boardingObservations)
    .where(eq(boardingObservations.bookingId, bookingId));
}

async function statusOf(db: AppDb, bookingId: string) {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.status;
}

async function timed<T>(work: Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await work;
  return { value, ms: performance.now() - started };
}

describePostgres("a dock sighting is never held behind a schedule edit", () => {
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

  it("keeps a replay tied to its original departure after a real booking move", async () => {
    const shop = await shopFixture();
    const trip = await departure(shop.pg.db, shop.shopId);
    const [late] = await seats(shop.pg.db, shop.shopId, trip.id, ["Late solo diver"]);
    if (!late) throw new Error("seat missing");
    const ctx = {
      ...shop,
      trip,
      late,
      now: new Date(trip.startsAt.getTime() - 10 * MINUTE_MS),
    };
    const target = await departure(ctx.pg.db, ctx.shopId, 24);
    await ctx.pg.db
      .update(bookings)
      .set({ status: "no_show", turnedAwayAt: ctx.now, turnedAwayReason: "waiver" })
      .where(eq(bookings.id, ctx.late));
    const input = {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      bookingId: ctx.late,
      recordedByPersonId: ctx.staffId,
      clientKey: randomUUID(),
    };
    expect(await recordBoardingObservation(ctx.pg.connect(), input)).toMatchObject({
      ok: true,
      replay: false,
    });
    const before = await ctx.pg.db
      .select()
      .from(boardingObservations)
      .where(eq(boardingObservations.clientKey, input.clientKey));
    expect(before).toHaveLength(1);
    expect(
      await moveBooking(ctx.pg.connect(), {
        shopId: ctx.shopId,
        fromTripId: ctx.trip.id,
        toTripId: target.id,
        bookingId: ctx.late,
        actorPersonId: ctx.staffId,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true });
    const [moved] = await ctx.pg.db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, ctx.late));
    expect(moved?.tripId).toBe(target.id);
    expect(await recordBoardingObservation(ctx.pg.connect(), input)).toMatchObject({
      ok: true,
      replay: true,
      tripId: ctx.trip.id,
    });
    expect(
      await recordBoardingObservation(ctx.pg.connect(), { ...input, tripId: target.id }),
    ).toEqual({ ok: false, reason: "key_reused" });
    expect(
      await ctx.pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.bookingId, ctx.late)),
    ).toEqual(before);
  });

  it("refuses a replay after staff revocation while retaining the committed sighting", async () => {
    const ctx = await releasedSeat();
    const [captain] = await ctx.pg.db
      .select({ personId: people.id, accountId: userAccounts.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
      .where(
        and(
          eq(people.shopId, ctx.shopId),
          eq(personRoles.role, "captain"),
          eq(userAccounts.status, "active"),
        ),
      )
      .limit(1);
    const [owner] = await ctx.pg.db
      .select({ personId: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
      .where(
        and(
          eq(people.shopId, ctx.shopId),
          eq(personRoles.role, "owner"),
          eq(userAccounts.status, "active"),
        ),
      )
      .limit(1);
    if (!captain || !owner || captain.personId === owner.personId) {
      throw new Error("distinct active captain and owner required");
    }
    const input = {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      bookingId: ctx.late,
      recordedByPersonId: captain.personId,
      clientKey: randomUUID(),
    };
    expect(await recordBoardingObservation(ctx.pg.connect(), input)).toMatchObject({
      ok: true,
      replay: false,
    });
    const before = await ctx.pg.db
      .select()
      .from(boardingObservations)
      .where(eq(boardingObservations.clientKey, input.clientKey));
    expect(before).toHaveLength(1);
    expect(
      await setStaffAccountStatus(ctx.pg.connect(), {
        shopId: ctx.shopId,
        personId: captain.personId,
        userAccountId: captain.accountId,
        status: "disabled",
      }),
    ).toEqual({ ok: true });
    expect(await recordBoardingObservation(ctx.pg.connect(), input)).toEqual({
      ok: false,
      reason: "staff_not_found",
    });
    expect(
      await recordBoardingObservation(ctx.pg.connect(), {
        ...input,
        recordedByPersonId: owner.personId,
      }),
    ).toMatchObject({ ok: true, replay: true });
    expect(
      await ctx.pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.clientKey, input.clientKey)),
    ).toEqual(before);
  });

  it("commits while a move holds the departure and the seat for update", async () => {
    const ctx = await releasedSeat();
    const move = await holding(ctx.pg, moveLocks(ctx.trip.id, ctx.late));
    try {
      const { value, ms } = await timed(
        recordBoardingObservation(ctx.pg.connect(), {
          shopId: ctx.shopId,
          tripId: ctx.trip.id,
          bookingId: ctx.late,
          recordedByPersonId: ctx.staffId,
          clientKey: randomUUID(),
        }),
      );
      expect(value).toMatchObject({ ok: true, replay: false });
      expect(ms).toBeLessThan(2_000);
      expect(await observationsOf(ctx.pg.db, ctx.late)).toHaveLength(1);
    } finally {
      await move.release();
    }
  });

  it("commits while a crew edit holds its locks", async () => {
    const ctx = await releasedSeat();
    const crew = await holding(ctx.pg, crewEditLocks(ctx.shopId, ctx.trip.id));
    try {
      const recorded = await recordBoardingObservation(ctx.pg.connect(), {
        shopId: ctx.shopId,
        tripId: ctx.trip.id,
        bookingId: ctx.late,
        recordedByPersonId: ctx.staffId,
      });
      expect(recorded).toMatchObject({ ok: true });
    } finally {
      await crew.release();
    }
  });

  it("answers the desk at once as pending when the departure is busy, and the retry applies it", async () => {
    const ctx = await releasedSeat();
    const move = await holding(ctx.pg, moveLocks(ctx.trip.id, ctx.aboard));
    let undo: Awaited<ReturnType<typeof undoBookingNoShow>>;
    try {
      const { value, ms } = await timed(
        undoBookingNoShow(ctx.pg.connect(), {
          shopId: ctx.shopId,
          tripId: ctx.trip.id,
          bookingId: ctx.late,
          recordedByPersonId: ctx.staffId,
          clientKey: randomUUID(),
          now: ctx.now,
        }),
      );
      undo = value;
      // The brief wait is a second; the bounded one would have been five.
      expect(ms).toBeLessThan(4_000);
      expect(undo).toMatchObject({ ok: true, state: "pending" });
      expect((await observationsOf(ctx.pg.db, ctx.late))[0]?.state).toBe("pending");
      expect(await statusOf(ctx.pg.db, ctx.late)).toBe("no_show");
    } finally {
      await move.release();
    }
    // The after-response retry.
    await settleDockObservations(ctx.pg.connect(), {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      by: "automatic",
    });
    expect((await observationsOf(ctx.pg.db, ctx.late))[0]?.state).toBe("applied");
    expect(await statusOf(ctx.pg.db, ctx.late)).toBe("booked");
  });

  it("leaves a pending sighting for the sweep when the worker stops after intake", async () => {
    const ctx = await releasedSeat();
    // One process records and goes away before settling.
    const lost = ctx.pg.connect();
    await recordBoardingObservation(lost, {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      bookingId: ctx.late,
      recordedByPersonId: ctx.staffId,
    });
    // The next process's shop tick.
    const swept = await settleOpenBoardingObservations(ctx.pg.connect(), { now: ctx.now });
    expect(swept).toMatchObject({ applied: 1, busy: 0 });
    expect(await statusOf(ctx.pg.db, ctx.late)).toBe("booked");
  });

  it("writes one row for a live tap and its offline replay racing on one key", async () => {
    const ctx = await releasedSeat();
    const key = randomUUID();
    const tap = () =>
      recordBoardingObservation(ctx.pg.connect(), {
        shopId: ctx.shopId,
        tripId: ctx.trip.id,
        bookingId: ctx.late,
        recordedByPersonId: ctx.staffId,
        clientKey: key,
      });
    const outcomes = await Promise.all([tap(), tap(), tap()]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const ids = new Set(outcomes.map((outcome) => (outcome.ok ? outcome.observationId : "")));
    expect(ids.size).toBe(1);
    expect(await observationsOf(ctx.pg.db, ctx.late)).toHaveLength(1);
  });

  it("joins two staffers' taps for one seat into one open sighting", async () => {
    const ctx = await releasedSeat();
    const tap = (personId: string) =>
      recordBoardingObservation(ctx.pg.connect(), {
        shopId: ctx.shopId,
        tripId: ctx.trip.id,
        bookingId: ctx.late,
        recordedByPersonId: personId,
        clientKey: randomUUID(),
      });
    const outcomes = await Promise.all([tap(ctx.staffId), tap(ctx.secondStaffId)]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const open = (await observationsOf(ctx.pg.db, ctx.late)).filter(
      (row) => row.state === "pending" || row.state === "conflict",
    );
    expect(open).toHaveLength(1);
  });

  it("refuses a spent key sent about another seat", async () => {
    const ctx = await releasedSeat();
    const key = randomUUID();
    await recordBoardingObservation(ctx.pg.db, {
      shopId: ctx.shopId,
      bookingId: ctx.late,
      recordedByPersonId: ctx.staffId,
      clientKey: key,
    });
    await ctx.pg.db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, ctx.aboard));
    expect(
      await recordBoardingObservation(ctx.pg.db, {
        shopId: ctx.shopId,
        bookingId: ctx.aboard,
        recordedByPersonId: ctx.staffId,
        clientKey: key,
      }),
    ).toEqual({ ok: false, reason: "key_reused" });
  });
});

describePostgres("the freed seat, in either commit order", () => {
  it("refuses the sale that queued behind a sighting's intake", async () => {
    const ctx = await releasedSeat();
    // A move holds the departure; the desk taps; a walk-up sale queues.
    const move = await holding(ctx.pg, moveLocks(ctx.trip.id, ctx.aboard));
    const recorded = await recordBoardingObservation(ctx.pg.connect(), {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      bookingId: ctx.late,
      recordedByPersonId: ctx.staffId,
    });
    expect(recorded).toMatchObject({ ok: true });
    const sale = createBookingParty(ctx.pg.connect(), [
      { actor: "staff", shopId: ctx.shopId, tripId: ctx.trip.id, fullName: "Walk Up" },
    ]);
    const settle = settleBoardingObservations(ctx.pg.connect(), {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      now: ctx.now,
    });
    try {
      await waitForLockWaiters(ctx.pg.db, 2);
    } finally {
      await move.release();
    }
    const [sold, settled] = await Promise.all([sale, settle]);
    // Whichever of the two took the departure first, the sighting held the place.
    expect(sold).toMatchObject({ ok: false, reason: "trip_full" });
    expect(settled).toMatchObject({ ok: true, settled: [{ state: "applied" }] });
    const held = await heldSeatCounts(ctx.pg.db, ctx.shopId, ctx.trip.id);
    expect(held.aboard).toBe(2);
  });

  it("keeps a sighting whose seat was sold first open and counting, and seats it when a place opens", async () => {
    const ctx = await releasedSeat();
    const [walkUp] = await seats(ctx.pg.db, ctx.shopId, ctx.trip.id, ["Walk Up"]);
    if (!walkUp) throw new Error("walk-up refused");
    const undo = await undoBookingNoShow(ctx.pg.db, {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      bookingId: ctx.late,
      recordedByPersonId: ctx.staffId,
      now: ctx.now,
    });
    expect(undo).toMatchObject({ ok: true, state: "conflict", conflict: "trip_full" });
    // The sighting stands, and it is the next seat to open.
    expect((await observationsOf(ctx.pg.db, ctx.late))[0]).toMatchObject({
      state: "conflict",
      conflictCode: "trip_full",
    });
    await ctx.pg.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, walkUp));
    const resale = await createBookingParty(ctx.pg.db, [
      { actor: "staff", shopId: ctx.shopId, tripId: ctx.trip.id, fullName: "Second Walk Up" },
    ]);
    expect(resale).toMatchObject({ ok: false, reason: "trip_full" });
    await settleOpenBoardingObservations(ctx.pg.db, { now: ctx.now });
    expect(await statusOf(ctx.pg.db, ctx.late)).toBe("booked");
  });

  it("reads a seat moved away before the allocation as moved, and the seat it left is free", async () => {
    const ctx = await releasedSeat();
    const elsewhere = await departure(ctx.pg.db, ctx.shopId, 24);
    await recordBoardingObservation(ctx.pg.db, {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      bookingId: ctx.late,
      recordedByPersonId: ctx.staffId,
    });
    await ctx.pg.db.update(bookings).set({ tripId: elsewhere.id }).where(eq(bookings.id, ctx.late));
    expect(
      await settleBoardingObservations(ctx.pg.db, {
        shopId: ctx.shopId,
        tripId: ctx.trip.id,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true, settled: [{ state: "conflict", conflict: "seat_moved" }] });
    expect((await heldSeatCounts(ctx.pg.db, ctx.shopId, ctx.trip.id)).aboard).toBe(1);
  });

  it("reads a called-off departure as cancelled and holds nothing", async () => {
    const ctx = await releasedSeat();
    await recordBoardingObservation(ctx.pg.db, {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      bookingId: ctx.late,
      recordedByPersonId: ctx.staffId,
    });
    await ctx.pg.db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, ctx.trip.id));
    expect(
      await settleBoardingObservations(ctx.pg.db, {
        shopId: ctx.shopId,
        tripId: ctx.trip.id,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true, settled: [{ state: "conflict", conflict: "trip_cancelled" }] });
    expect(await statusOf(ctx.pg.db, ctx.late)).toBe("no_show");
  });
});

describePostgres("crew edits and boarding taps", () => {
  it("lets a boarding tap elsewhere in the shop through while a crew edit is open", async () => {
    const ctx = await releasedSeat();
    const other = await departure(ctx.pg.db, ctx.shopId, 48);
    const crew = await holding(ctx.pg, crewEditLocks(ctx.shopId, other.id));
    try {
      const { ms } = await timed(
        recordRollCall(ctx.pg.connect(), {
          shopId: ctx.shopId,
          tripId: ctx.trip.id,
          bookingId: ctx.aboard,
          recordedByPersonId: ctx.staffId,
          status: "boarded",
        }),
      );
      // Before #4474 the crew edit held the evidence lock exclusively and this
      // waited the full five seconds, then failed.
      expect(ms).toBeLessThan(2_000);
    } finally {
      await crew.release();
    }
  });

  it("refuses the second of two concurrent assignments of one person to overlapping boats", async () => {
    const ctx = await shopFixture();
    const morning = await departure(ctx.pg.db, ctx.shopId, 0);
    const overlapping = await departure(ctx.pg.db, ctx.shopId, 1);
    const assign = (tripId: string) =>
      changeTripCrewOutcome(ctx.pg.connect(), ctx.shopId, tripId, {
        operation: "assign",
        personId: ctx.staffId,
      });
    const outcomes = await Promise.all([assign(morning.id), assign(overlapping.id)]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, refusal: "crew_clash" },
    ]);
  });

  it("refuses one of a crew move and an assignment racing onto overlapping boats", async () => {
    const ctx = await shopFixture();
    const from = await departure(ctx.pg.db, ctx.shopId, 72);
    const to = await departure(ctx.pg.db, ctx.shopId, 0);
    const overlapping = await departure(ctx.pg.db, ctx.shopId, 1);
    expect(
      await changeTripCrewOutcome(ctx.pg.db, ctx.shopId, from.id, {
        operation: "assign",
        personId: ctx.staffId,
      }),
    ).toEqual({ ok: true });
    const [moved, assigned] = await Promise.all([
      moveTripCrewMember(ctx.pg.connect(), ctx.shopId, {
        personId: ctx.staffId,
        fromTripId: from.id,
        toTripId: to.id,
      }),
      changeTripCrewOutcome(ctx.pg.connect(), ctx.shopId, overlapping.id, {
        operation: "assign",
        personId: ctx.staffId,
      }),
    ]);
    expect([moved.ok, assigned.ok].filter(Boolean)).toHaveLength(1);
    const refused = moved.ok ? assigned : moved;
    expect(refused).toEqual({ ok: false, refusal: "crew_clash" });
  });

  it("warns, never refuses, a crew member booked as a diver on an overlapping boat, whichever committed last", async () => {
    const ctx = await shopFixture();
    const crewed = await departure(ctx.pg.db, ctx.shopId, 0, 6);
    const diving = await departure(ctx.pg.db, ctx.shopId, 2, 6);
    const [crewOutcome, seat] = await Promise.all([
      changeTripCrewOutcome(ctx.pg.connect(), ctx.shopId, crewed.id, {
        operation: "assign",
        personId: ctx.staffId,
      }),
      createBookingParty(ctx.pg.connect(), [
        { actor: "staff", shopId: ctx.shopId, tripId: diving.id, personId: ctx.staffId },
      ]),
    ]);
    expect(crewOutcome).toEqual({ ok: true });
    expect(seat).toMatchObject({ ok: true });
    // Read after both commits: the warning is a projection, so no commit order hides it.
    const clashes = await personClashesByTrip(
      ctx.pg.db,
      ctx.shopId,
      [crewed.id, diving.id],
      new Date(BASE - HOUR_MS),
    );
    expect(clashes.get(crewed.id)).toEqual([
      expect.objectContaining({
        personId: ctx.staffId,
        here: "crew",
        there: "diver",
        otherTripId: diving.id,
      }),
    ]);
    expect(clashes.get(diving.id)).toEqual([
      expect.objectContaining({
        personId: ctx.staffId,
        here: "diver",
        there: "crew",
        otherTripId: crewed.id,
      }),
    ]);
    // The crew roster still holds them: a warning, not a refusal.
    const open = await ctx.pg.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, diving.id), seatHeld));
    expect(open.length).toBeGreaterThan(0);
  });
});
