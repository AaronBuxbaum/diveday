import { eq, inArray, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { undoBookingNoShow } from "@/features/no-show";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { isLockWaitRefusal } from "./lock-bounds";
import { recordCrewRollCall, recordRollCall } from "./manifests";
import { lockShopSchedule } from "./person-schedule-lock";
import { bookings, people, personRoles, rollCallEvents, tripAssignments, userAccounts } from "./schema";
import { createTrip } from "./trips";

describePostgres("reopening a released seat", () => {
  it("releases the trip before retrying a no-show mark behind a schedule writer", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const trip = await createTrip(pg.db, { shopId: shop.id, title: "Lock order", startsAt: new Date("2035-08-04T08:00:00Z"), endsAt: new Date("2035-08-04T12:00:00Z"), capacity: 8, plannedDives: 1 });
    if (!trip) throw new Error("expected trip");
    const [staff, diver] = await pg.db.insert(people).values([{ shopId: shop.id, fullName: "Staff" }, { shopId: shop.id, fullName: "Diver" }]).returning();
    if (!staff || !diver) throw new Error("expected people");
    await pg.db.insert(personRoles).values([{ personId: staff.id, role: "divemaster" }, { personId: diver.id, role: "diver" }]);
    await pg.db.insert(userAccounts).values({ personId: staff.id, email: "staff@example.test", hashedPassword: "x", status: "active" });
    const [seat] = await pg.db.insert(bookings).values({ shopId: shop.id, tripId: trip.id, personId: diver.id, bookedAs: "diver", status: "no_show" }).returning();
    if (!seat) throw new Error("expected seat");
    const gate = await holdRowLock(pg, sql`select id from bookings where id = ${seat.id} for update`);
    let ready!: () => void;
    let proceed!: () => void;
    const held = new Promise<void>((resolve) => { ready = resolve; });
    const startTripLock = new Promise<void>((resolve) => { proceed = resolve; });
    const schedule = pg.connect().transaction(async (tx) => {
      await lockShopSchedule(tx, shop.id);
      ready();
      await startTripLock;
      await tx.execute(sql`select id from trips where id = ${trip.id} for update`);
    });
    await held;
    const rail = recordRollCall(pg.connect(), { shopId: shop.id, tripId: trip.id, bookingId: seat.id, recordedByPersonId: staff.id, status: "not_boarded", checkpoint: "after_dive_1", occurredAt: new Date("2035-08-04T10:00:00Z") });
    let contentionFailure: unknown;
    try {
      await waitForLockWaiters(pg.db, 1);
      proceed();
      await waitForLockWaiters(pg.db, 2, 3000);
    } catch (error) {
      contentionFailure = error;
    } finally {
      proceed();
      await gate.release();
    }
    await schedule;
    const result = await rail;
    if (contentionFailure) throw contentionFailure;
    expect(result.ok).toBe(true);
    const [after] = await pg.db.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, seat.id));
    expect(after?.status).toBe("booked");
    const events = await pg.db.select().from(rollCallEvents).where(eq(rollCallEvents.bookingId, seat.id));
    expect(events).toHaveLength(1);
  });

  it("records already-booked diver and crew evidence while another schedule write is held", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const trip = await createTrip(pg.db, { shopId: shop.id, title: "Booked", startsAt: new Date("2035-08-04T08:00:00Z"), endsAt: new Date("2035-08-04T12:00:00Z"), capacity: 8, plannedDives: 1 });
    if (!trip) throw new Error("expected trip");
    const [staff, diver] = await pg.db.insert(people).values([{ shopId: shop.id, fullName: "Staff" }, { shopId: shop.id, fullName: "Diver" }]).returning();
    if (!staff || !diver) throw new Error("expected people");
    await pg.db.insert(personRoles).values([{ personId: staff.id, role: "divemaster" }, { personId: diver.id, role: "diver" }]);
    await pg.db.insert(userAccounts).values({ personId: staff.id, email: "staff@example.test", hashedPassword: "x", status: "active" });
    await pg.db.insert(tripAssignments).values({ tripId: trip.id, personId: staff.id });
    const seats = await pg.db.insert(bookings).values([diver, staff].map((person) => ({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" as const, status: "booked" as const }))).returning();
    const [diverSeat, crewSeat] = seats;
    if (!diverSeat || !crewSeat) throw new Error("expected seats");
    let ready!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { ready = resolve; });
    const proceed = new Promise<void>((resolve) => { release = resolve; });
    const holder = pg.connect().transaction(async (tx) => { await lockShopSchedule(tx, shop.id); ready(); await proceed; });
    await held;
    const rail = recordRollCall(pg.connect(), { shopId: shop.id, tripId: trip.id, bookingId: diverSeat.id, recordedByPersonId: staff.id, status: "not_boarded", checkpoint: "after_dive_1", occurredAt: new Date("2035-08-04T10:00:00Z") });
    const crew = recordCrewRollCall(pg.connect(), { shopId: shop.id, tripId: trip.id, personId: staff.id, recordedByPersonId: staff.id, status: "not_boarded", checkpoint: "after_dive_1", occurredAt: new Date("2035-08-04T10:00:00Z") });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observed: [{ ok: boolean }, { ok: boolean }] | "parked";
    try {
      observed = await Promise.race([Promise.all([rail, crew]), new Promise<"parked">((resolve) => { timer = setTimeout(() => resolve("parked"), 3000); })]);
    } finally { if (timer) clearTimeout(timer); release(); await holder; }
    await Promise.all([rail, crew]);
    expect(observed).not.toBe("parked");
    if (observed !== "parked") expect(observed.every((result) => result.ok)).toBe(true);
    const events = await pg.db.select().from(rollCallEvents).where(eq(rollCallEvents.tripId, trip.id));
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.subjectKind).sort()).toEqual(["crew", "seat"]);
  });

  it("makes a rail tap wait at most five seconds for a stuck schedule writer", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const id = "00000000-0000-4000-8000-000000000001";
    const [staff] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Staff" })
      .returning();
    if (!staff) throw new Error("expected staff");
    await pg.db.insert(personRoles).values({ personId: staff.id, role: "divemaster" });
    await pg.db.insert(userAccounts).values({
      personId: staff.id,
      email: "rail@example.test",
      hashedPassword: "x",
      status: "active",
    });
    let ready!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = pg.connect().transaction(async (tx) => {
      await lockShopSchedule(tx, shop.id);
      ready();
      await proceed;
    });
    await held;
    try {
      const started = performance.now();
      const failure = await recordRollCall(pg.connect(), {
        shopId: shop.id,
        tripId: id,
        bookingId: id,
        recordedByPersonId: staff.id,
        status: "boarded",
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(isLockWaitRefusal(failure)).toBe(true);
      expect(performance.now() - started).toBeGreaterThanOrEqual(4500);
    } finally {
      release();
      await holder;
    }
  });

  it("serializes undo and both kinds of boarding evidence before reopening seats", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const trip = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Reopen",
      startsAt: new Date("2035-08-04T08:00:00Z"),
      endsAt: new Date("2035-08-04T12:00:00Z"),
      capacity: 8,
      plannedDives: 1,
    });
    if (!trip) throw new Error("expected trip");
    const [staff, first, second] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Staff" },
        { shopId: shop.id, fullName: "Undo Diver" },
        { shopId: shop.id, fullName: "Rail Diver" },
      ])
      .returning();
    if (!staff || !first || !second) throw new Error("expected people");
    await pg.db.insert(personRoles).values([
      { personId: staff.id, role: "divemaster" },
      { personId: first.id, role: "diver" },
      { personId: second.id, role: "diver" },
    ]);
    await pg.db.insert(userAccounts).values({
      personId: staff.id,
      email: "staff@example.test",
      hashedPassword: "x",
      status: "active",
    });
    await pg.db.insert(tripAssignments).values({ tripId: trip.id, personId: staff.id });
    const rows = await pg.db
      .insert(bookings)
      .values(
        [first, second, staff].map((person) => ({
          shopId: shop.id,
          tripId: trip.id,
          personId: person.id,
          bookedAs: "diver" as const,
          status: "no_show" as const,
        })),
      )
      .returning();
    const [undo, rail, crew] = rows;
    if (!undo || !rail || !crew) throw new Error("expected seats");
    let ready!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = pg.connect().transaction(async (tx) => {
      await lockShopSchedule(tx, shop.id);
      ready();
      await proceed;
    });
    await held;
    const noShow = undoBookingNoShow(pg.connect(), {
      shopId: shop.id,
      bookingId: undo.id,
      recordedByPersonId: staff.id,
      now: new Date("2035-08-04T07:00:00Z"),
    });
    const diver = recordRollCall(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: rail.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      occurredAt: new Date("2035-08-04T10:00:00Z"),
    });
    const crewMark = recordCrewRollCall(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      personId: staff.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      occurredAt: new Date("2035-08-04T10:00:00Z"),
    });
    try {
      await waitForLockWaiters(pg.db, 3);
    } finally {
      release();
    }
    await holder;
    expect((await noShow).ok).toBe(true);
    expect((await diver).ok).toBe(true);
    expect((await crewMark).ok).toBe(true);
    const after = await pg.db
      .select({ status: bookings.status })
      .from(bookings)
      .where(inArray(bookings.id, [undo.id, rail.id, crew.id]));
    expect(after.map((seat) => seat.status)).toEqual(["booked", "booked", "booked"]);
  });
});
