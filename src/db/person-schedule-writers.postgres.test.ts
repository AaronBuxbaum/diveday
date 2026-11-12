import { expect, it } from "vitest";
import { repointHeldBooking } from "@/features/identity-repoint";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import {
  addPartySeat,
  confirmBookingIdentity,
  createBooking,
  createBookingParty,
  moveBooking,
  restoreBooking,
  splitBookingIdentity,
} from "./bookings";
import { isLockWaitRefusal } from "./lock-bounds";
import { lockShopSchedule } from "./person-schedule-lock";
import { people, personRoles } from "./schema";
import { changeTripCrewOutcome, createTrip, setTripCrew } from "./trips";

describePostgres("ordinary roster writes and schedule lock", () => {
  it("returns a retryable result when identity resolution cannot acquire the fence", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const bookingId = "00000000-0000-4000-8000-000000000001";
    const actorPersonId = "00000000-0000-4000-8000-000000000002";
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
      const [confirm, split, repoint] = await Promise.all([
        confirmBookingIdentity(pg.connect(), { shopId: shop.id, bookingId, actorPersonId }),
        splitBookingIdentity(pg.connect(), {
          shopId: shop.id,
          bookingId,
          actorPersonId,
          fullName: "Diver",
          adultAttested: true,
        }),
        repointHeldBooking(pg.connect(), {
          shopId: shop.id,
          bookingId,
          actorPersonId,
          toPersonId: "00000000-0000-4000-8000-000000000003",
        }),
      ]);
      expect(confirm).toBe("busy");
      expect(split).toEqual({ ok: false, reason: "busy" });
      expect(repoint).toEqual({ ok: false, reason: "busy" });
    } finally {
      release();
      await holder;
    }
  });

  it("takes the fence before restoring or resolving a held identity", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const bookingId = "00000000-0000-4000-8000-000000000001";
    const actorPersonId = "00000000-0000-4000-8000-000000000002";
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
    const restoring = restoreBooking(pg.connect(), shop.id, bookingId);
    const confirming = confirmBookingIdentity(pg.connect(), {
      shopId: shop.id,
      bookingId,
      actorPersonId,
    });
    const splitting = splitBookingIdentity(pg.connect(), {
      shopId: shop.id,
      bookingId,
      actorPersonId,
      fullName: "Diver",
      adultAttested: true,
    });
    const repointing = repointHeldBooking(pg.connect(), {
      shopId: shop.id,
      bookingId,
      actorPersonId,
      toPersonId: "00000000-0000-4000-8000-000000000003",
    });
    try {
      await waitForLockWaiters(pg.db, 4, 2000);
    } finally {
      release();
    }
    await holder;
    expect(await restoring).toBe("not_found");
    expect(await confirming).toBe(false);
    expect(await splitting).toMatchObject({ ok: false, reason: "not_held" });
    expect(await repointing).toMatchObject({ ok: false, reason: "not_held" });
  });

  it("takes the schedule fence before booking, party, and crew locks", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const trip = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Test",
      startsAt: new Date("2035-08-04T08:00:00Z"),
      endsAt: new Date("2035-08-04T10:00:00Z"),
      capacity: 12,
    });
    if (!trip) throw new Error("expected trip");
    const destination = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Destination",
      startsAt: new Date("2035-08-04T12:00:00Z"),
      endsAt: new Date("2035-08-04T14:00:00Z"),
      capacity: 12,
    });
    if (!destination) throw new Error("expected destination");
    const [member, secondMember] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Crew" },
        { shopId: shop.id, fullName: "Other crew" },
      ])
      .returning();
    if (!member || !secondMember) throw new Error("expected people");
    await pg.db.insert(personRoles).values([
      { personId: member.id, role: "divemaster" },
      { personId: secondMember.id, role: "divemaster" },
    ]);
    const lead = await createBooking(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      actor: "staff",
      fullName: "Lead",
      email: "lead@example.test",
    });
    const moving = await createBooking(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      actor: "staff",
      fullName: "Moving",
      email: "moving@example.test",
    });
    if (!lead.ok || !moving.ok) throw new Error("expected bookings");
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
    const one = createBooking(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      actor: "staff",
      fullName: "Diver",
      email: "one@example.test",
    });
    const party = createBookingParty(pg.connect(), [
      {
        shopId: shop.id,
        tripId: trip.id,
        actor: "staff",
        fullName: "Party",
        email: "party@example.test",
      },
    ]);
    const crew = setTripCrew(pg.connect(), shop.id, trip.id, [member.id]);
    const individual = changeTripCrewOutcome(pg.connect(), shop.id, destination.id, {
      personId: secondMember.id,
      operation: "assign",
    });
    const unchecked = moveBooking(pg.connect(), {
      shopId: shop.id,
      fromTripId: trip.id,
      toTripId: destination.id,
      bookingId: moving.bookingId,
    });
    const additional = addPartySeat(pg.connect(), {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
      seatName: "Guest",
    });
    try {
      await waitForLockWaiters(pg.db, 6);
    } finally {
      release();
    }
    await holder;
    expect((await one).ok).toBe(true);
    expect((await party).ok).toBe(true);
    expect(await crew).toBe(true);
    expect((await individual).ok).toBe(true);
    expect((await unchecked).ok).toBe(true);
    expect((await additional).ok).toBe(true);
  });

  it("bounds a held shop fence and identifies the retryable refusal", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
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
      const start = performance.now();
      const failure = await pg
        .connect()
        .transaction(async (tx) => lockShopSchedule(tx, shop.id))
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(isLockWaitRefusal(failure)).toBe(true);
      expect(performance.now() - start).toBeGreaterThanOrEqual(4500);
    } finally {
      release();
      await holder;
    }
  });
});
