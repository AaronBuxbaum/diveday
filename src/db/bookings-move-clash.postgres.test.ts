import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { createBooking, moveBooking } from "./bookings";
import { personRoles, trips } from "./schema";
import { createTrip, moveTrip, reinstateTrip, setTripCrew, setTripStatus } from "./trips";

describePostgres("concurrent checked diver moves", () => {
  it("waits for a reinstatement before checking a diver move", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const make = (title: string, start: string, end: string) =>
      createTrip(pg.db, {
        shopId: shop.id,
        title,
        startsAt: new Date(start),
        endsAt: new Date(end),
        capacity: 8,
      });
    const source = await make("Source", "2035-08-04T05:00:00Z", "2035-08-04T06:00:00Z");
    const target = await make("Target", "2035-08-04T08:00:00Z", "2035-08-04T10:00:00Z");
    const other = await make("Other", "2035-08-04T09:00:00Z", "2035-08-04T11:00:00Z");
    if (!source || !target || !other) throw new Error("expected trips");
    const booking = await createBooking(pg.db, {
      shopId: shop.id,
      tripId: source.id,
      actor: "staff",
      fullName: "Race Diver",
      email: "race@example.test",
    });
    if (!booking.ok) throw new Error(booking.reason);
    const otherBooking = await createBooking(pg.db, {
      shopId: shop.id,
      tripId: other.id,
      actor: "staff",
      personId: booking.personId,
    });
    if (!otherBooking.ok) throw new Error(otherBooking.reason);
    await setTripStatus(pg.db, shop.id, other.id, "cancelled");
    let ready!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = pg.connect().transaction(async (tx) => {
      await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, other.id)).for("update");
      ready();
      await proceed;
    });
    await held;
    const reinstating = reinstateTrip(pg.connect(), shop.id, other.id);
    let moving: ReturnType<typeof moveBooking> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      moving = moveBooking(pg.connect(), {
        shopId: shop.id,
        fromTripId: source.id,
        toTripId: target.id,
        bookingId: booking.bookingId,
        rejectScheduleClashes: true,
      });
      await waitForLockWaiters(pg.db, 2);
    } finally {
      release();
    }
    await blocker;
    expect((await reinstating).ok).toBe(true);
    if (!moving) throw new Error("move did not start");
    expect(await moving).toEqual({ ok: false, reason: "schedule_clash" });
  });

  it("names a clash when a called-off departure is reinstated after a person move", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const make = (title: string, start: string, end: string) =>
      createTrip(pg.db, {
        shopId: shop.id,
        title,
        startsAt: new Date(start),
        endsAt: new Date(end),
        capacity: 8,
      });
    const source = await make("Source", "2035-08-04T05:00:00Z", "2035-08-04T06:00:00Z");
    const target = await make("Target", "2035-08-04T08:00:00Z", "2035-08-04T10:00:00Z");
    const other = await make("Other", "2035-08-04T09:00:00Z", "2035-08-04T11:00:00Z");
    if (!source || !target || !other) throw new Error("expected trips");
    const booking = await createBooking(pg.db, {
      shopId: shop.id,
      tripId: source.id,
      actor: "staff",
      fullName: "Race Diver",
      email: "race@example.test",
    });
    if (!booking.ok) throw new Error(booking.reason);
    const otherBooking = await createBooking(pg.db, {
      shopId: shop.id,
      tripId: other.id,
      actor: "staff",
      personId: booking.personId,
    });
    if (!otherBooking.ok) throw new Error(otherBooking.reason);
    await setTripStatus(pg.db, shop.id, other.id, "cancelled");
    expect(
      (
        await moveBooking(pg.db, {
          shopId: shop.id,
          fromTripId: source.id,
          toTripId: target.id,
          bookingId: booking.bookingId,
          rejectScheduleClashes: true,
        })
      ).ok,
    ).toBe(true);
    const outcome = await reinstateTrip(pg.db, shop.id, other.id);
    expect(outcome).toMatchObject({
      ok: true,
      scheduleClashes: [{ personName: "Race Diver", otherTitle: "Target" }],
    });
  });

  it.each(["diver", "crew"] as const)(
    "does not silently reschedule a %s onto a person move that won the lock",
    async (role) => {
      const pg = await postgresTestDb();
      const shop = await raceShop(pg.db);
      const make = (title: string, start: string, end: string) =>
        createTrip(pg.db, {
          shopId: shop.id,
          title,
          startsAt: new Date(start),
          endsAt: new Date(end),
          capacity: 8,
        });
      const source = await make("Source", "2035-08-04T05:00:00Z", "2035-08-04T06:00:00Z");
      const target = await make("Target", "2035-08-04T08:00:00Z", "2035-08-04T10:00:00Z");
      const other = await make("Other", "2035-08-04T12:00:00Z", "2035-08-04T14:00:00Z");
      if (!source || !target || !other) throw new Error("expected trips");
      const booking = await createBooking(pg.db, {
        shopId: shop.id,
        tripId: source.id,
        actor: "staff",
        fullName: "Race Diver",
        email: "race@example.test",
      });
      if (!booking.ok) throw new Error(booking.reason);
      if (role === "crew") {
        await pg.db.insert(personRoles).values({ personId: booking.personId, role: "divemaster" });
        expect(await setTripCrew(pg.db, shop.id, other.id, [booking.personId])).toBe(true);
      } else {
        const otherBooking = await createBooking(pg.db, {
          shopId: shop.id,
          tripId: other.id,
          actor: "staff",
          personId: booking.personId,
        });
        if (!otherBooking.ok) throw new Error(otherBooking.reason);
      }
      let ready!: () => void;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const proceed = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocker = pg.connect().transaction(async (tx) => {
        await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, source.id)).for("update");
        ready();
        await proceed;
      });
      await held;
      const moving = moveBooking(pg.connect(), {
        shopId: shop.id,
        fromTripId: source.id,
        toTripId: target.id,
        bookingId: booking.bookingId,
        rejectScheduleClashes: true,
      });
      let reschedule: ReturnType<typeof moveTrip> | undefined;
      try {
        await waitForLockWaiters(pg.db, 1);
        reschedule = moveTrip(pg.connect(), shop.id, other.id, new Date("2035-08-04T09:00:00Z"));
        await waitForLockWaiters(pg.db, 2);
      } finally {
        release();
      }
      await blocker;
      expect((await moving).ok).toBe(true);
      if (!reschedule) throw new Error("reschedule did not start");
      const outcome = await reschedule;
      if (outcome.ok) {
        expect(outcome).toHaveProperty(
          "scheduleClashes",
          expect.arrayContaining([
            expect.objectContaining({ personName: "Race Diver", otherTitle: "Target" }),
          ]),
        );
      } else {
        expect(outcome).toMatchObject({ reason: "schedule_clash" });
      }
    },
  );

  it("does not miss a crew assignment on a concurrently rescheduled departure", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const make = (title: string, start: string, end: string) =>
      createTrip(pg.db, {
        shopId: shop.id,
        title,
        startsAt: new Date(start),
        endsAt: new Date(end),
        capacity: 8,
      });
    const source = await make("Source", "2035-08-04T05:00:00Z", "2035-08-04T06:00:00Z");
    const target = await make("Target", "2035-08-04T08:00:00Z", "2035-08-04T10:00:00Z");
    const other = await make("Other", "2035-08-04T12:00:00Z", "2035-08-04T14:00:00Z");
    if (!source || !target || !other) throw new Error("expected trips");
    const booking = await createBooking(pg.db, {
      shopId: shop.id,
      tripId: source.id,
      actor: "staff",
      fullName: "Dual role",
      email: "dual@example.test",
    });
    if (!booking.ok) throw new Error(booking.reason);
    await pg.db.insert(personRoles).values({ personId: booking.personId, role: "divemaster" });
    expect(await setTripCrew(pg.db, shop.id, other.id, [booking.personId])).toBe(true);
    let ready!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reschedule = moveTrip(pg.connect(), shop.id, other.id, new Date("2035-08-04T09:00:00Z"), {
      beforeMove: async () => {
        ready();
        await proceed;
      },
    });
    await held;
    const moving = moveBooking(pg.connect(), {
      shopId: shop.id,
      fromTripId: source.id,
      toTripId: target.id,
      bookingId: booking.bookingId,
      rejectScheduleClashes: true,
    });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
    }
    expect((await reschedule).ok).toBe(true);
    expect(await moving).toEqual({ ok: false, reason: "schedule_clash" });
  });

  it("does not miss a concurrent reschedule of another booked departure", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const make = (title: string, start: string, end: string) =>
      createTrip(pg.db, {
        shopId: shop.id,
        title,
        startsAt: new Date(start),
        endsAt: new Date(end),
        capacity: 8,
      });
    const source = await make("Source", "2035-08-04T05:00:00Z", "2035-08-04T06:00:00Z");
    const target = await make("Target", "2035-08-04T08:00:00Z", "2035-08-04T10:00:00Z");
    const other = await make("Other", "2035-08-04T12:00:00Z", "2035-08-04T14:00:00Z");
    if (!source || !target || !other) throw new Error("expected trips");
    const booking = await createBooking(pg.db, {
      shopId: shop.id,
      tripId: source.id,
      actor: "staff",
      fullName: "Race Diver",
      email: "race@example.test",
    });
    if (!booking.ok) throw new Error(booking.reason);
    const otherBooking = await createBooking(pg.db, {
      shopId: shop.id,
      tripId: other.id,
      actor: "staff",
      personId: booking.personId,
    });
    if (!otherBooking.ok) throw new Error(otherBooking.reason);
    let started!: () => void;
    let release!: () => void;
    const atWrite = new Promise<void>((resolve) => {
      started = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reschedule = moveTrip(pg.connect(), shop.id, other.id, new Date("2035-08-04T09:00:00Z"), {
      beforeMove: async () => {
        started();
        await proceed;
      },
    });
    await atWrite;
    const moving = moveBooking(pg.connect(), {
      shopId: shop.id,
      fromTripId: source.id,
      toTripId: target.id,
      bookingId: booking.bookingId,
      rejectScheduleClashes: true,
    });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
    }
    expect((await reschedule).ok).toBe(true);
    expect(await moving).toEqual({ ok: false, reason: "schedule_clash" });
  });

  it("accepts at most one move onto overlapping targets", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const make = (title: string, start: string, end: string) =>
      createTrip(pg.db, {
        shopId: shop.id,
        title,
        startsAt: new Date(start),
        endsAt: new Date(end),
        capacity: 8,
      });
    const sourceA = await make("Source A", "2035-08-04T05:00:00Z", "2035-08-04T06:00:00Z");
    const sourceB = await make("Source B", "2035-08-04T06:00:00Z", "2035-08-04T07:00:00Z");
    const targetA = await make("Target A", "2035-08-04T08:00:00Z", "2035-08-04T12:00:00Z");
    const targetB = await make("Target B", "2035-08-04T09:00:00Z", "2035-08-04T13:00:00Z");
    if (!sourceA || !sourceB || !targetA || !targetB) throw new Error("expected trips");
    const a = await createBooking(pg.db, {
      shopId: shop.id,
      tripId: sourceA.id,
      actor: "staff",
      fullName: "Race Diver",
      email: "race@example.test",
    });
    if (!a.ok) throw new Error(a.reason);
    const b = await createBooking(pg.db, {
      shopId: shop.id,
      tripId: sourceB.id,
      actor: "staff",
      personId: a.personId,
    });
    if (!b.ok) throw new Error(b.reason);
    const outcomes = await Promise.all([
      moveBooking(pg.connect(), {
        shopId: shop.id,
        fromTripId: sourceA.id,
        toTripId: targetA.id,
        bookingId: a.bookingId,
        rejectScheduleClashes: true,
      }),
      moveBooking(pg.connect(), {
        shopId: shop.id,
        fromTripId: sourceB.id,
        toTripId: targetB.id,
        bookingId: b.bookingId,
        rejectScheduleClashes: true,
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, reason: "schedule_clash" },
    ]);
  });
});
