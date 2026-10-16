// @vitest-environment node
import { and, asc, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { aboardAtSeaBookingIds } from "./aboard-at-sea";
import * as bookingCapabilitiesModule from "./booking-capabilities";
import { cancelBooking, createBooking, createBookingParty, selfCancelBooking } from "./bookings";
import type { AppDb } from "./client";
import {
  bookingCapabilities,
  bookings,
  rollCallEvents,
  shops,
  tripDeskEvents,
  tripStageEvents,
  trips,
} from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
// The lock order against the rail's tap is raced in `seat-lock-order.postgres.test.ts`.
const ctx = fileScopedShopContext();

async function seededContext() {
  const { db, shop } = ctx;
  const open = (await upcomingTripsWithCounts(db, shop.id)).find(
    (t) => t.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!open) throw new Error("expected seeded trip missing");
  return { db, shop, open };
}

async function bookVisitor(db: AppDb, shopId: string, tripId: string) {
  return createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName: "Nora Quinn",
    email: "nora@example.com",
  });
}

/**
 * **A diver marked aboard a boat that has left cannot be removed** (H-122).
 * A cancelled booking is nobody to every roll-call reader, so a wrong-row tap
 * at the desk would drop a person on the water from the count. Each refusal
 * asserts the seat, its capabilities, the crew's catch-up strip and the roll
 * call are all as they were, not merely that the outcome reads as a refusal.
 */
describe("cancelBooking refuses a diver marked aboard at sea (H-122)", () => {
  const HOUR = 60 * 60 * 1000;

  async function sail(db: AppDb, tripId: string, hoursAgo = 2) {
    const departed = new Date(nowMs() - hoursAgo * HOUR);
    await db
      .update(trips)
      .set({ startsAt: departed, endsAt: new Date(departed.getTime() + 4 * HOUR) })
      .where(eq(trips.id, tripId));
  }

  async function mark(
    db: AppDb,
    seat: { shopId: string; tripId: string; bookingId: string },
    status: "boarded" | "not_boarded" | "cleared",
    minutesAgo: number,
    checkpoint = "departure",
  ) {
    const [recorder] = await listStaff(db, seat.shopId);
    if (!recorder) throw new Error("seeded staff missing");
    await db.insert(rollCallEvents).values({
      ...seat,
      recordedByPersonId: recorder.person.id,
      status,
      checkpoint,
      occurredAt: new Date(nowMs() - minutesAgo * 60 * 1000),
    });
  }

  async function aboardSeat() {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    const issued = await bookingCapabilitiesModule.issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      purpose: "readiness",
    });
    if (!issued) throw new Error("setup capability failed");
    const seat = { shopId: shop.id, tripId: open.id, bookingId: booked.bookingId };
    return { db, shop, open, seat };
  }

  async function bookAnother(db: AppDb, shopId: string, tripId: string) {
    const booked = await createBooking(db, {
      actor: "staff",
      shopId,
      tripId,
      fullName: "Otto Second",
      email: "otto-second@example.com",
    });
    if (!booked.ok) throw new Error("setup booking failed");
    return booked;
  }

  async function untouched(db: AppDb, bookingId: string) {
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.status).toBe("booked");
    const [capability] = await db
      .select()
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, bookingId));
    expect(capability?.revokedAt).toBeNull();
    const released = await db
      .select({ id: tripDeskEvents.id })
      .from(tripDeskEvents)
      .where(
        and(eq(tripDeskEvents.bookingId, bookingId), eq(tripDeskEvents.kind, "seat_released")),
      );
    expect(released).toEqual([]);
  }

  async function rollCallOf(db: AppDb, bookingId: string) {
    return db
      .select({ status: rollCallEvents.status, checkpoint: rollCallEvents.checkpoint })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.bookingId, bookingId))
      .orderBy(asc(rollCallEvents.seq));
  }

  it("refuses to remove a diver boarded at the dock once the boat has sailed", async () => {
    const { db, open, seat } = await aboardSeat();
    await sail(db, open.id);
    await mark(db, seat, "boarded", 90);
    const before = await rollCallOf(db, seat.bookingId);

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
    });
    await untouched(db, seat.bookingId);
    expect(await rollCallOf(db, seat.bookingId)).toEqual(before);
    expect((await getTripRoster(db, seat.shopId, open.id)).map((r) => r.booking.id)).toContain(
      seat.bookingId,
    );
  });

  it("refuses inside the first hour once the crew have said the boat is underway", async () => {
    const { db, open, seat } = await aboardSeat();
    // Left 20 minutes ago: `hasSailed` still says no, the crew's word says yes.
    await sail(db, open.id, 1 / 3);
    await mark(db, seat, "boarded", 25);
    const [recorder] = await listStaff(db, seat.shopId);
    if (!recorder) throw new Error("seeded staff missing");
    await db.insert(tripStageEvents).values({
      shopId: seat.shopId,
      tripId: open.id,
      stage: "underway",
      recordedByPersonId: recorder.person.id,
    });

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
    });
    await untouched(db, seat.bookingId);
  });

  it("refuses a diver counted back aboard after a dive, whatever the dock said", async () => {
    const { db, open, seat } = await aboardSeat();
    // Picked up at the second site: never boarded at the dock.
    await mark(db, seat, "not_boarded", 60);
    await mark(db, seat, "boarded", 10, "after_dive_1");

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
    });
    await untouched(db, seat.bookingId);
    expect(open.id).toBe(seat.tripId);
  });

  it("refuses a diver boarded at the dock and since marked not back aboard", async () => {
    const { db, open, seat } = await aboardSeat();
    await sail(db, open.id);
    await mark(db, seat, "boarded", 90);
    await mark(db, seat, "not_boarded", 10, "after_dive_1");

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
    });
    await untouched(db, seat.bookingId);
  });

  it("refuses the diver's own link and keeps a party seat aboard with the crew", async () => {
    const { db, shop, open } = await seededContext();
    const party = await createBookingParty(
      db,
      ["Lena Party", "Kid Party"].map((fullName, index) => ({
        actor: "public" as const,
        shopId: shop.id,
        tripId: open.id,
        fullName,
        ...(index === 0 ? { email: "lena-party@example.com" } : {}),
      })),
    );
    if (!party.ok) throw new Error("setup party failed");
    const [lead, kid] = party.bookings.map((seat) => seat.bookingId);
    if (!lead || !kid) throw new Error("setup party failed");
    // Left 20 minutes ago, the crew said so, and counted the child aboard.
    await sail(db, open.id, 1 / 3);
    await mark(db, { shopId: shop.id, tripId: open.id, bookingId: kid }, "boarded", 25);
    const [recorder] = await listStaff(db, shop.id);
    if (!recorder) throw new Error("seeded staff missing");
    await db.insert(tripStageEvents).values({
      shopId: shop.id,
      tripId: open.id,
      stage: "underway",
      recordedByPersonId: recorder.person.id,
    });

    // The child's own link is refused as the departed boat it is.
    expect(await selfCancelBooking(db, { shopId: shop.id, bookingId: kid })).toEqual({
      ok: false,
      reason: "trip_departed",
    });
    // The lead was never counted aboard, so their own seat goes; the child the
    // crew counted onto the boat stays on it.
    expect(
      await selfCancelBooking(db, { shopId: shop.id, bookingId: lead, withUnclaimedParty: true }),
    ).toEqual({
      ok: true,
      party: { cancelled: [], stayed: [{ bookingId: kid, seatName: "Kid Party" }] },
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, kid));
    expect(row?.status).toBe("booked");
  });

  it("still removes a diver nobody marked aboard, at sea", async () => {
    const { db, open, seat } = await aboardSeat();
    await sail(db, open.id);

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toMatchObject({
      ok: true,
      booking: { id: seat.bookingId, previousStatus: "booked" },
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, seat.bookingId));
    expect(row?.status).toBe("cancelled");
  });

  it("still removes a diver the crew marked as never leaving the dock", async () => {
    const { db, open, seat } = await aboardSeat();
    await sail(db, open.id);
    await mark(db, seat, "not_boarded", 90);

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toMatchObject({ ok: true });
  });

  it("removes a diver once the crew mark them ashore, and once they undo the tap", async () => {
    const { db, open, seat } = await aboardSeat();
    const other = await bookAnother(db, seat.shopId, open.id);
    await sail(db, open.id);
    await mark(db, seat, "boarded", 90);
    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toMatchObject({ ok: false });

    await mark(db, seat, "not_boarded", 5);
    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toMatchObject({ ok: true });

    const otherSeat = { ...seat, bookingId: other.bookingId };
    await mark(db, otherSeat, "boarded", 90);
    await mark(db, otherSeat, "cleared", 5);
    expect(await cancelBooking(db, seat.shopId, other.bookingId)).toMatchObject({ ok: true });
  });

  it("still removes a diver boarded at the dock of a boat that has not left", async () => {
    const { db, seat } = await aboardSeat();
    await mark(db, seat, "boarded", 5);

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toMatchObject({ ok: true });
  });

  it("reads the crew's newest stage, so a mis-tapped Underway taken back to Boarding does not refuse", async () => {
    const { db, open, seat } = await aboardSeat();
    await mark(db, seat, "boarded", 5);
    const [recorder] = await listStaff(db, seat.shopId);
    if (!recorder) throw new Error("seeded staff missing");
    const at = nowMs();
    await db.insert(tripStageEvents).values([
      {
        shopId: seat.shopId,
        tripId: open.id,
        stage: "underway",
        recordedByPersonId: recorder.person.id,
        recordedAt: new Date(at - 2 * 60 * 1000),
      },
      {
        shopId: seat.shopId,
        tripId: open.id,
        stage: "boarding",
        recordedByPersonId: recorder.person.id,
        recordedAt: new Date(at - 60 * 1000),
      },
    ]);

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toMatchObject({ ok: true });
  });

  it("answers the roster's question with the same rule, for the whole departure", async () => {
    const { db, open, seat } = await aboardSeat();
    const other = await bookAnother(db, seat.shopId, open.id);
    await sail(db, open.id);
    await mark(db, seat, "boarded", 90);
    await mark(db, { ...seat, bookingId: other.bookingId }, "not_boarded", 90);

    const aboard = await aboardAtSeaBookingIds(db, {
      shopId: seat.shopId,
      tripId: open.id,
      now: nowDate(),
    });
    expect([...aboard]).toEqual([seat.bookingId]);
    // Another shop asking about this departure hears nothing.
    const [elsewhere] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(ne(shops.id, seat.shopId))
      .limit(1);
    if (elsewhere) {
      const foreign = await aboardAtSeaBookingIds(db, {
        shopId: elsewhere.id,
        tripId: open.id,
        now: nowDate(),
      });
      expect(foreign.size).toBe(0);
    }
  });
});
