import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS, nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import {
  dismissBoardingObservation,
  recordBoardingObservation,
  settleBoardingObservations,
  settleOpenBoardingObservations,
} from "./boarding-observations";
import { createBookingParty } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { recordRollCall } from "./manifests";
import { getBookingReadiness } from "./readiness";
import { activityEvents, boardingObservations, bookings, people, trips } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { createTrip, getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { heldSeatCounts } from "./trips-queries";

/**
 * **How a dock sighting is measured** on a real server (issue #4474 review):
 * waiting sightings never hold places from one another, an automatic pass
 * never seats a diver on a boat that has left, a turned-away seat's own
 * sighting is not counted against its boarding, a closed reason releases its
 * place, and an erasure racing the allocation never leaves the old name on the
 * trail.
 */

const BASE = Date.UTC(2031, 6, 9, 13);

async function shopFixture() {
  const pg = await postgresTestDb();
  await seedDemo(pg.db, "history");
  const shop = await getShopBySlug(pg.db, "blue-mantis");
  if (!shop) throw new Error("shop missing");
  const [staff] = await listStaff(pg.db, shop.id);
  if (!staff) throw new Error("staff missing");
  return { pg, shopId: shop.id, staffId: staff.person.id };
}

async function departure(db: AppDb, shopId: string, capacity: number) {
  const trip = await createTrip(db, {
    shopId,
    title: `Dock ${randomUUID().slice(0, 6)}`,
    startsAt: new Date(BASE),
    endsAt: new Date(BASE + 4 * HOUR_MS),
    capacity,
  });
  if (!trip) throw new Error("trip not created");
  return trip;
}

async function seats(db: AppDb, shopId: string, tripId: string, count: number) {
  const party = await createBookingParty(
    db,
    Array.from({ length: count }, (_, index) => ({
      actor: "staff" as const,
      shopId,
      tripId,
      fullName: `Diver ${index + 1}`,
    })),
  );
  if (!party.ok) throw new Error(`seats refused: ${party.reason}`);
  return party.bookings.map((row) => row.bookingId);
}

async function release(db: AppDb, bookingId: string) {
  await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingId));
}

async function sight(db: AppDb, shopId: string, staffId: string, bookingId: string) {
  const recorded = await recordBoardingObservation(db, {
    shopId,
    bookingId,
    recordedByPersonId: staffId,
    clientKey: randomUUID(),
  });
  if (!recorded.ok) throw new Error(`sighting refused: ${recorded.reason}`);
  return recorded.observationId;
}

async function stateOf(db: AppDb, observationId: string) {
  const [row] = await db
    .select({ state: boardingObservations.state, code: boardingObservations.conflictCode })
    .from(boardingObservations)
    .where(eq(boardingObservations.id, observationId));
  return row;
}

async function statusOf(db: AppDb, bookingId: string) {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.status;
}

async function refusalLines(db: AppDb, bookingId: string) {
  return db
    .select({ code: activityEvents.code, params: activityEvents.params })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.bookingId, bookingId),
        eq(activityEvents.code, "booking_no_show_undo_refused"),
      ),
    );
}

describePostgres("dock sightings are measured against the seats actually held", () => {
  it("seats the earliest of two waiting sightings when one place opens", async () => {
    const { pg, shopId, staffId } = await shopFixture();
    const trip = await departure(pg.db, shopId, 12);
    const ids = await seats(pg.db, shopId, trip.id, 12);
    const [first, second, cancelled] = ids;
    if (!first || !second || !cancelled) throw new Error("seats missing");
    await release(pg.db, first);
    await release(pg.db, second);
    const firstSighting = await sight(pg.db, shopId, staffId, first);
    const secondSighting = await sight(pg.db, shopId, staffId, second);
    // Seen a minute apart, so "earliest" is the desk's order and not the ids'.
    await pg.db
      .update(boardingObservations)
      .set({ observedAt: new Date(BASE - 20 * MINUTE_MS) })
      .where(eq(boardingObservations.id, secondSighting));
    await pg.db
      .update(boardingObservations)
      .set({ observedAt: new Date(BASE - 21 * MINUTE_MS) })
      .where(eq(boardingObservations.id, firstSighting));
    // Ten held of ten: both sightings wait on a full boat.
    await pg.db.update(trips).set({ capacity: 10 }).where(eq(trips.id, trip.id));
    const now = new Date(BASE - 10 * MINUTE_MS);
    await settleBoardingObservations(pg.db, { shopId, tripId: trip.id, now });
    expect(await stateOf(pg.db, firstSighting)).toEqual({ state: "conflict", code: "trip_full" });
    expect(await stateOf(pg.db, secondSighting)).toEqual({ state: "conflict", code: "trip_full" });

    // One booked seat goes: nine held of ten, one place.
    await pg.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, cancelled));
    await settleOpenBoardingObservations(pg.db, { now });
    expect(await stateOf(pg.db, firstSighting)).toMatchObject({ state: "applied" });
    expect(await statusOf(pg.db, first)).toBe("booked");
    expect(await stateOf(pg.db, secondSighting)).toEqual({ state: "conflict", code: "trip_full" });
    expect((await heldSeatCounts(pg.db, shopId, trip.id, { awaited: false })).aboard).toBe(10);
  });

  it("releases the place of a sighting whose reason closed, so a reinstated boat is not overfilled", async () => {
    const { pg, shopId, staffId } = await shopFixture();
    const trip = await departure(pg.db, shopId, 3);
    const [late, other, third] = await seats(pg.db, shopId, trip.id, 3);
    if (!late || !other || !third) throw new Error("seats missing");
    await release(pg.db, late);
    const sighting = await sight(pg.db, shopId, staffId, late);
    const now = new Date(BASE - 10 * MINUTE_MS);
    await pg.db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    await settleBoardingObservations(pg.db, { shopId, tripId: trip.id, now });
    expect(await stateOf(pg.db, sighting)).toEqual({ state: "conflict", code: "trip_cancelled" });
    // A called-off boat holds nobody's place: back on, with two held of three.
    await pg.db.update(trips).set({ status: "scheduled" }).where(eq(trips.id, trip.id));
    expect((await heldSeatCounts(pg.db, shopId, trip.id)).aboard).toBe(2);
    await settleBoardingObservations(pg.db, { shopId, tripId: trip.id, now });
    expect(await statusOf(pg.db, late)).toBe("booked");
    // And the closed reason left one line on the trail.
    expect((await refusalLines(pg.db, late)).map((line) => line.params)).toEqual([
      expect.objectContaining({ reason: "trip_cancelled" }),
    ]);
  });
});

describePostgres("an automatic pass never boards a boat that has left", () => {
  it("leaves the sighting for a person once the boat has sailed, and a staffer may still seat it", async () => {
    const { pg, shopId, staffId } = await shopFixture();
    const trip = await departure(pg.db, shopId, 4);
    const [late] = await seats(pg.db, shopId, trip.id, 2);
    if (!late) throw new Error("seat missing");
    await release(pg.db, late);
    const sighting = await sight(pg.db, shopId, staffId, late);
    const afterSailing = new Date(BASE + 2 * HOUR_MS);

    const swept = await settleOpenBoardingObservations(pg.db, { now: afterSailing });
    expect(swept.applied).toBe(0);
    expect(await stateOf(pg.db, sighting)).toEqual({ state: "conflict", code: "boat_left" });
    expect(await statusOf(pg.db, late)).toBe("no_show");
    // Closed for the sweep: the next tick does not pick it up again.
    expect((await settleOpenBoardingObservations(pg.db, { now: afterSailing })).departures).toBe(0);

    // The staffer at the desk says they did go: Try again seats them.
    await settleBoardingObservations(pg.db, {
      shopId,
      tripId: trip.id,
      by: "desk",
      now: afterSailing,
    });
    expect(await statusOf(pg.db, late)).toBe("booked");
  });

  it("still seats a sighting automatically before the boat sails", async () => {
    const { pg, shopId, staffId } = await shopFixture();
    const trip = await departure(pg.db, shopId, 4);
    const [late] = await seats(pg.db, shopId, trip.id, 2);
    if (!late) throw new Error("seat missing");
    await release(pg.db, late);
    await sight(pg.db, shopId, staffId, late);
    await settleBoardingObservations(pg.db, {
      shopId,
      tripId: trip.id,
      by: "automatic",
      now: new Date(BASE + 10 * MINUTE_MS),
    });
    expect(await statusOf(pg.db, late)).toBe("booked");
  });
});

describePostgres("boarding a turned-away seat at the gangway", () => {
  it("does not count the seat's own pending sighting against it", async () => {
    const { pg, shopId, staffId } = await shopFixture();
    // A seeded seat that is ready to board.
    let found: { tripId: string; bookingId: string } | null = null;
    for (const trip of await upcomingTripsWithCounts(pg.db, shopId)) {
      for (const row of await getTripRoster(pg.db, shopId, trip.id)) {
        if (row.booking.status !== "booked") continue;
        const readiness = await getBookingReadiness(pg.db, shopId, row.booking.id);
        if (readiness?.status === "ready") {
          found = { tripId: trip.id, bookingId: row.booking.id };
          break;
        }
      }
      if (found) break;
    }
    if (!found) throw new Error("no ready seat in the seed");
    const { tripId, bookingId } = found;
    await pg.db
      .update(bookings)
      .set({ status: "no_show", turnedAwayAt: nowDate(), turnedAwayReason: "waiver" })
      .where(eq(bookings.id, bookingId));
    await sight(pg.db, shopId, staffId, bookingId);
    // Exactly one place free, the one this diver's own sighting is holding.
    const held = await heldSeatCounts(pg.db, shopId, tripId, { awaited: false });
    await pg.db
      .update(trips)
      .set({ capacity: held.aboard + 1 })
      .where(eq(trips.id, tripId));
    const boarded = await recordRollCall(pg.db, {
      shopId,
      tripId,
      bookingId,
      recordedByPersonId: staffId,
      status: "boarded",
    });
    expect(boarded).toMatchObject({ ok: true });
  });
});

describePostgres("an erasure racing the allocation", () => {
  it("waits for the person row, so the trail carries the name as the erasure left it", async () => {
    const { pg, shopId, staffId } = await shopFixture();
    const trip = await departure(pg.db, shopId, 4);
    const [late] = await seats(pg.db, shopId, trip.id, 2);
    if (!late) throw new Error("seat missing");
    await release(pg.db, late);
    await sight(pg.db, shopId, staffId, late);
    const [seat] = await pg.db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, late));
    if (!seat) throw new Error("seat missing");

    // The erasure holds the person row and is rewriting the name.
    let release_!: () => void;
    const held = new Promise<void>((resolve) => {
      release_ = resolve;
    });
    let locked_!: () => void;
    const locked = new Promise<void>((resolve) => {
      locked_ = resolve;
    });
    const erasure = pg.connect().transaction(async (tx: DbExecutor) => {
      await tx
        .select({ id: people.id })
        .from(people)
        .where(eq(people.id, seat.personId))
        .for("update");
      await tx.update(people).set({ fullName: "Erased Diver" }).where(eq(people.id, seat.personId));
      locked_();
      await held;
    });
    await locked;
    const settle = settleBoardingObservations(pg.connect(), {
      shopId,
      tripId: trip.id,
      now: new Date(BASE - 10 * MINUTE_MS),
    });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release_();
    }
    await Promise.all([erasure, settle]);
    const [line] = await pg.db
      .select({ params: activityEvents.params })
      .from(activityEvents)
      .where(
        and(eq(activityEvents.bookingId, late), eq(activityEvents.code, "booking_no_show_undone")),
      );
    expect(line?.params).toMatchObject({ diver: "Erased Diver" });
  });
});

describePostgres("dismissing a sighting", () => {
  it("writes who set it aside on the trail", async () => {
    const { pg, shopId, staffId } = await shopFixture();
    const trip = await departure(pg.db, shopId, 1);
    const [late] = await seats(pg.db, shopId, trip.id, 1);
    if (!late) throw new Error("seat missing");
    await release(pg.db, late);
    const sighting = await sight(pg.db, shopId, staffId, late);
    expect(
      await dismissBoardingObservation(pg.db, {
        shopId,
        tripId: trip.id,
        observationId: sighting,
        actorPersonId: staffId,
      }),
    ).toBe(true);
    const lines = await pg.db
      .select({ code: activityEvents.code })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.bookingId, late),
          eq(activityEvents.code, "boarding_observation_dismissed"),
        ),
      );
    expect(lines).toHaveLength(1);
  });
});
