import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { setStaffAccountStatus } from "@/features/staff-accounts";
import { anonymizeDiver } from "../features/anonymize/store";
import { markBookingNoShow, undoBookingNoShow } from "../features/no-show/store";
import { MINUTE_MS } from "../lib/clock";
import { isolatedShopContext } from "../test/db";
import {
  dismissBoardingObservation,
  openBoardingObservationsByTrip,
  recordBoardingObservation,
  settleBoardingObservations,
  settleOpenBoardingObservations,
} from "./boarding-observations";
import { createBooking, moveBooking } from "./bookings";
import {
  boardingObservations,
  bookings,
  people,
  personRoles,
  shops,
  trips,
  userAccounts,
} from "./schema/index";
import { createTrip, getTripRoster, listStaff } from "./trips";
import { heldSeatCounts } from "./trips-queries";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

// A fresh root database per test lets erasure reach its real commit boundary.
const fileCtx = isolatedShopContext();

/**
 * **A diver seen at the dock** (issue #4474): the desk's sighting is recorded
 * first, with no departure lock, and the seat comes back in a second step. These
 * pin the single-connection half (idempotency, what counts, what each later
 * edit turns the sighting into); contention is `boarding-observations.postgres.test.ts`.
 */
async function released() {
  const { db, shop } = fileCtx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id);
  const trip = upcoming.find(
    (candidate) => candidate.title === "Two-Tank Reef — Molasses & French",
  );
  const other = upcoming.find((candidate) => candidate.id !== trip?.id);
  if (!trip || !other) throw new Error("seeded trips missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("seeded staff missing");
  const [seat] = await getTripRoster(db, shop.id, trip.id);
  if (!seat) throw new Error("seeded booking missing");
  const now = new Date(trip.startsAt.getTime() + 10 * MINUTE_MS);
  const marked = await markBookingNoShow(db, {
    shopId: shop.id,
    bookingId: seat.booking.id,
    recordedByPersonId: staff.person.id,
    now,
  });
  if (!marked.ok) throw new Error(`mark refused: ${marked.reason}`);
  return {
    db,
    shopId: shop.id,
    trip,
    otherTripId: other.id,
    staffId: staff.person.id,
    bookingId: seat.booking.id,
    personId: seat.person.id,
    now,
  };
}

type Ctx = Awaited<ReturnType<typeof released>>;

function record(ctx: Ctx, clientKey: string = randomUUID(), bookingId = ctx.bookingId) {
  return recordBoardingObservation(ctx.db, {
    shopId: ctx.shopId,
    tripId: ctx.trip.id,
    bookingId,
    recordedByPersonId: ctx.staffId,
    clientKey,
  });
}

async function seatStatus(ctx: Ctx) {
  const [row] = await ctx.db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, ctx.bookingId));
  return row?.status;
}

async function observationRows(ctx: Ctx) {
  return ctx.db
    .select()
    .from(boardingObservations)
    .where(eq(boardingObservations.bookingId, ctx.bookingId));
}

/** Every place on the boat is held by somebody else. */
async function fillTheBoat(ctx: Ctx) {
  const held = await heldSeatCounts(ctx.db, ctx.shopId, ctx.trip.id);
  await ctx.db.update(trips).set({ capacity: held.aboard }).where(eq(trips.id, ctx.trip.id));
}

describe("recording a dock sighting", () => {
  it("rechecks staff authorization on a replay without deleting the observation", async () => {
    const ctx = await released();
    const [captain] = await ctx.db
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
    const [owner] = await ctx.db
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
    const key = randomUUID();
    const input = {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      bookingId: ctx.bookingId,
      recordedByPersonId: captain.personId,
      clientKey: key,
    };
    const first = await recordBoardingObservation(ctx.db, input);
    expect(first).toMatchObject({ ok: true, replay: false });
    const before = await observationRows(ctx);
    expect(
      await setStaffAccountStatus(ctx.db, {
        shopId: ctx.shopId,
        personId: captain.personId,
        userAccountId: captain.accountId,
        status: "disabled",
      }),
    ).toEqual({ ok: true });
    expect(await recordBoardingObservation(ctx.db, input)).toEqual({
      ok: false,
      reason: "staff_not_found",
    });
    expect(
      await recordBoardingObservation(ctx.db, { ...input, recordedByPersonId: owner.personId }),
    ).toMatchObject({ ok: true, replay: true });
    const [otherShop] = await ctx.db
      .insert(shops)
      .values({ name: "Other shop", slug: `other-${randomUUID()}`, timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("other shop missing");
    const [otherStaff] = await ctx.db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Other owner", email: "other@scope.example" })
      .returning();
    if (!otherStaff) throw new Error("other staff missing");
    await ctx.db.insert(personRoles).values({ personId: otherStaff.id, role: "owner" });
    await ctx.db
      .insert(userAccounts)
      .values({ personId: otherStaff.id, email: "other@scope.example", status: "active" });
    expect(
      await recordBoardingObservation(ctx.db, { ...input, recordedByPersonId: otherStaff.id }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
    expect(await observationRows(ctx)).toEqual(before);
  });

  it("records one row per tap, however often the same tap is sent", async () => {
    const ctx = await released();
    const key = randomUUID();
    const first = await record(ctx, key);
    const again = await record(ctx, key);
    expect(first).toMatchObject({ ok: true, replay: false });
    expect(again).toMatchObject({ ok: true, replay: true });
    if (!first.ok || !again.ok) throw new Error("unreachable");
    expect(again.observationId).toBe(first.observationId);
    expect(await observationRows(ctx)).toHaveLength(1);
  });

  it("refuses a spent key sent about another seat, and moves nothing", async () => {
    const ctx = await released();
    const key = randomUUID();
    await record(ctx, key);
    const [otherSeat] = (await getTripRoster(ctx.db, ctx.shopId, ctx.trip.id)).filter(
      (row) => row.booking.id !== ctx.bookingId,
    );
    if (!otherSeat) throw new Error("second seat missing");
    expect(await record(ctx, key, otherSeat.booking.id)).toEqual({
      ok: false,
      reason: "key_reused",
    });
  });

  it("refuses a spent key sent for a different departure", async () => {
    const ctx = await released();
    const key = randomUUID();
    const first = await record(ctx, key);
    expect(first).toMatchObject({ ok: true, replay: false });
    const before = await observationRows(ctx);
    expect(
      await recordBoardingObservation(ctx.db, {
        shopId: ctx.shopId,
        tripId: ctx.otherTripId,
        bookingId: ctx.bookingId,
        recordedByPersonId: ctx.staffId,
        clientKey: key,
      }),
    ).toEqual({ ok: false, reason: "key_reused" });
    expect(await observationRows(ctx)).toEqual(before);
  });

  it("keeps an exact replay on its original departure after a booking move", async () => {
    const ctx = await released();
    const key = randomUUID();
    await ctx.db
      .update(bookings)
      .set({
        turnedAwayAt: new Date(ctx.trip.startsAt.getTime() - MINUTE_MS),
        turnedAwayReason: "waiver",
      })
      .where(eq(bookings.id, ctx.bookingId));
    const first = await record(ctx, key);
    expect(first).toMatchObject({ ok: true, replay: false });
    const before = await observationRows(ctx);
    const target = await createTrip(ctx.db, {
      shopId: ctx.shopId,
      title: "Replay move target",
      startsAt: new Date(ctx.trip.startsAt.getTime() + 3 * 24 * 60 * MINUTE_MS),
      endsAt: new Date(ctx.trip.startsAt.getTime() + (3 * 24 * 60 + 240) * MINUTE_MS),
      capacity: 20,
    });
    if (!target) throw new Error("target departure missing");
    const moved = await moveBooking(ctx.db, {
      shopId: ctx.shopId,
      fromTripId: ctx.trip.id,
      toTripId: target.id,
      bookingId: ctx.bookingId,
      actorPersonId: ctx.staffId,
      now: new Date(ctx.trip.startsAt.getTime() - MINUTE_MS),
    });
    expect(moved).toMatchObject({ ok: true });
    expect(await record(ctx, key)).toMatchObject({ ok: true, replay: true, tripId: ctx.trip.id });
    expect(
      await recordBoardingObservation(ctx.db, {
        shopId: ctx.shopId,
        bookingId: ctx.bookingId,
        recordedByPersonId: ctx.staffId,
        clientKey: key,
      }),
    ).toMatchObject({ ok: true, replay: true, tripId: ctx.trip.id });
    expect(
      await recordBoardingObservation(ctx.db, {
        shopId: ctx.shopId,
        tripId: target.id,
        bookingId: ctx.bookingId,
        recordedByPersonId: ctx.staffId,
        clientKey: key,
      }),
    ).toEqual({ ok: false, reason: "key_reused" });
    expect(await observationRows(ctx)).toEqual(before);
  });

  it("joins a second staffer's tap for the same seat to the open one", async () => {
    const ctx = await released();
    const first = await record(ctx);
    const second = await record(ctx);
    expect(second).toMatchObject({ ok: true, replay: true });
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(second.observationId).toBe(first.observationId);
    expect(await observationRows(ctx)).toHaveLength(1);
  });

  it("does not let a joined tap's key be spent on a different seat", async () => {
    const ctx = await released();
    const [otherSeat] = (await getTripRoster(ctx.db, ctx.shopId, ctx.trip.id)).filter(
      (row) => row.booking.id !== ctx.bookingId,
    );
    if (!otherSeat) throw new Error("second seat missing");
    await ctx.db
      .update(bookings)
      .set({ status: "no_show" })
      .where(eq(bookings.id, otherSeat.booking.id));
    const original = await record(ctx, randomUUID());
    const joinedKey = randomUUID();
    const joined = await record(ctx, joinedKey);
    expect(original).toMatchObject({ ok: true, replay: false });
    expect(joined).toMatchObject({ ok: true, replay: true });
    if (!original.ok || !joined.ok) throw new Error("observation missing");
    expect(joined.observationId).toBe(original.observationId);
    const before = await observationRows(ctx);
    expect(before).toHaveLength(1);
    expect(await record(ctx, joinedKey, otherSeat.booking.id)).toEqual({
      ok: false,
      reason: "key_reused",
    });
    expect(await observationRows(ctx)).toEqual(before);
    const otherRows = await ctx.db
      .select()
      .from(boardingObservations)
      .where(eq(boardingObservations.bookingId, otherSeat.booking.id));
    expect(otherRows).toEqual([]);
  });

  it("refuses a seat that was never released", async () => {
    const ctx = await released();
    const [held] = (await getTripRoster(ctx.db, ctx.shopId, ctx.trip.id)).filter(
      (row) => row.booking.id !== ctx.bookingId,
    );
    if (!held) throw new Error("second seat missing");
    expect(await record(ctx, randomUUID(), held.booking.id)).toEqual({
      ok: false,
      reason: "not_marked",
    });
  });

  it("refuses another shop's seat as not found", async () => {
    const ctx = await released();
    expect(
      await recordBoardingObservation(ctx.db, {
        shopId: randomUUID(),
        bookingId: ctx.bookingId,
        recordedByPersonId: ctx.staffId,
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("taking the seat back", () => {
  it("counts a pending sighting as a held seat until it is settled", async () => {
    const ctx = await released();
    const before = await heldSeatCounts(ctx.db, ctx.shopId, ctx.trip.id);
    await record(ctx);
    const during = await heldSeatCounts(ctx.db, ctx.shopId, ctx.trip.id);
    expect(during.aboard).toBe(before.aboard + 1);
    // Nobody can sell that place while the sighting waits.
    await ctx.db.update(trips).set({ capacity: during.aboard }).where(eq(trips.id, ctx.trip.id));
    const walkUp = await createBooking(ctx.db, {
      actor: "staff",
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      fullName: "Walk Up",
      email: `walk-up-${randomUUID()}@example.com`,
    });
    expect(walkUp).toMatchObject({ ok: false, reason: "trip_full" });

    const settled = await settleBoardingObservations(ctx.db, {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      now: ctx.now,
    });
    expect(settled).toMatchObject({ ok: true, settled: [{ state: "applied" }] });
    expect(await seatStatus(ctx)).toBe("booked");
    expect((await heldSeatCounts(ctx.db, ctx.shopId, ctx.trip.id)).aboard).toBe(during.aboard);
  });

  it("keeps a sighting with no room open, counting, and applies it when a seat opens", async () => {
    const ctx = await released();
    await fillTheBoat(ctx);
    await record(ctx);
    const first = await settleBoardingObservations(ctx.db, {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      now: ctx.now,
    });
    expect(first).toMatchObject({
      ok: true,
      settled: [{ state: "conflict", conflict: "trip_full" }],
    });
    expect(await seatStatus(ctx)).toBe("no_show");
    const open = (await openBoardingObservationsByTrip(ctx.db, ctx.shopId, [ctx.trip.id])).get(
      ctx.trip.id,
    );
    expect(open).toEqual([expect.objectContaining({ state: "conflict", conflict: "trip_full" })]);

    // A place opens; the sweep gives it to the diver at the dock.
    await ctx.db
      .update(trips)
      .set({ capacity: (await heldSeatCounts(ctx.db, ctx.shopId, ctx.trip.id)).aboard })
      .where(eq(trips.id, ctx.trip.id));
    const swept = await settleOpenBoardingObservations(ctx.db, { now: ctx.now });
    expect(swept.applied).toBeGreaterThanOrEqual(1);
    expect(await seatStatus(ctx)).toBe("booked");
  });

  it("applies a sighting left pending by a worker that stopped after intake", async () => {
    const ctx = await released();
    await record(ctx);
    // No inline settle and no after-response settle: the process went away.
    expect((await observationRows(ctx))[0]?.state).toBe("pending");
    await settleOpenBoardingObservations(ctx.db, { now: ctx.now });
    expect(await seatStatus(ctx)).toBe("booked");
    expect((await observationRows(ctx))[0]?.state).toBe("applied");
  });

  it("settles each sighting once, however many passes run", async () => {
    const ctx = await released();
    await record(ctx);
    const passes = { shopId: ctx.shopId, tripId: ctx.trip.id, now: ctx.now };
    await settleBoardingObservations(ctx.db, passes);
    expect(await settleBoardingObservations(ctx.db, passes)).toEqual({ ok: true, settled: [] });
  });
});

describe("a later edit to the seat", () => {
  it("reads a seat moved to another departure as moved, holding nothing here", async () => {
    const ctx = await released();
    await record(ctx);
    const before = await heldSeatCounts(ctx.db, ctx.shopId, ctx.trip.id);
    await ctx.db
      .update(bookings)
      .set({ tripId: ctx.otherTripId })
      .where(eq(bookings.id, ctx.bookingId));
    const after = await heldSeatCounts(ctx.db, ctx.shopId, ctx.trip.id);
    expect(after.aboard).toBe(before.aboard - 1);
    expect(
      await settleBoardingObservations(ctx.db, {
        shopId: ctx.shopId,
        tripId: ctx.trip.id,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true, settled: [{ state: "conflict", conflict: "seat_moved" }] });
  });

  it("reads a called-off departure as cancelled", async () => {
    const ctx = await released();
    await record(ctx);
    await ctx.db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, ctx.trip.id));
    expect(
      await settleBoardingObservations(ctx.db, {
        shopId: ctx.shopId,
        tripId: ctx.trip.id,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true, settled: [{ state: "conflict", conflict: "trip_cancelled" }] });
    expect(await seatStatus(ctx)).toBe("no_show");
  });

  it("reads a removed seat as removed", async () => {
    const ctx = await released();
    await record(ctx);
    await ctx.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, ctx.bookingId));
    expect(
      await settleBoardingObservations(ctx.db, {
        shopId: ctx.shopId,
        tripId: ctx.trip.id,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true, settled: [{ state: "conflict", conflict: "seat_cancelled" }] });
  });

  it("never puts an erased diver back, and keeps the sighting as the record", async () => {
    const ctx = await released();
    await record(ctx);
    const erased = await anonymizeDiver(ctx.db, {
      shopId: ctx.shopId,
      personId: ctx.personId,
      actorPersonId: ctx.staffId,
    });
    expect(erased).toMatchObject({ ok: true });
    expect(
      await settleBoardingObservations(ctx.db, {
        shopId: ctx.shopId,
        tripId: ctx.trip.id,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true, settled: [{ state: "conflict", conflict: "diver_erased" }] });
    expect(await seatStatus(ctx)).toBe("no_show");
  });
});

describe("dismissing a sighting", () => {
  it("stops it counting and takes it off the departure, and only for its own departure", async () => {
    const ctx = await released();
    await fillTheBoat(ctx);
    const recorded = await record(ctx);
    if (!recorded.ok) throw new Error("record refused");
    await settleBoardingObservations(ctx.db, {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      now: ctx.now,
    });
    const counting = await heldSeatCounts(ctx.db, ctx.shopId, ctx.trip.id);

    const elsewhere = await dismissBoardingObservation(ctx.db, {
      shopId: ctx.shopId,
      tripId: ctx.otherTripId,
      observationId: recorded.observationId,
      actorPersonId: ctx.staffId,
    });
    expect(elsewhere).toBe(false);

    expect(
      await dismissBoardingObservation(ctx.db, {
        shopId: ctx.shopId,
        tripId: ctx.trip.id,
        observationId: recorded.observationId,
        actorPersonId: ctx.staffId,
      }),
    ).toBe(true);
    expect((await heldSeatCounts(ctx.db, ctx.shopId, ctx.trip.id)).aboard).toBe(
      counting.aboard - 1,
    );
    expect((await openBoardingObservationsByTrip(ctx.db, ctx.shopId, [ctx.trip.id])).size).toBe(0);
    const [kept] = await ctx.db
      .select({ rows: count() })
      .from(boardingObservations)
      .where(
        and(
          eq(boardingObservations.id, recorded.observationId),
          eq(boardingObservations.state, "dismissed"),
          eq(boardingObservations.dismissedByPersonId, ctx.staffId),
        ),
      );
    expect(kept?.rows).toBe(1);
  });
});

describe("a resend of a tap that was set aside", () => {
  it("answers dismissed and seats nobody", async () => {
    const ctx = await released();
    const key = randomUUID();
    const recorded = await record(ctx, key);
    if (!recorded.ok) throw new Error("record refused");
    await dismissBoardingObservation(ctx.db, {
      shopId: ctx.shopId,
      tripId: ctx.trip.id,
      observationId: recorded.observationId,
      actorPersonId: ctx.staffId,
    });
    expect(
      await undoBookingNoShow(ctx.db, {
        shopId: ctx.shopId,
        tripId: ctx.trip.id,
        bookingId: ctx.bookingId,
        recordedByPersonId: ctx.staffId,
        clientKey: key,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true, state: "dismissed" });
    expect(await seatStatus(ctx)).toBe("no_show");
  });
});
