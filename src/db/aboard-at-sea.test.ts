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
  rollCallCrewEvents,
  rollCallEvents,
  shops,
  tripAssignments,
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
 * **A diver marked aboard a boat that has left cannot be removed** (H-20261015-aboard-diver-removal-at).
 * A cancelled booking is nobody to every roll-call reader, so a wrong-row tap
 * at the desk would drop a person on the water from the count. Each refusal
 * asserts the seat, its capabilities, the crew's catch-up strip and the roll
 * call are all as they were, not merely that the outcome reads as a refusal.
 */
describe("cancelBooking refuses a diver marked aboard at sea (H-20261015-aboard-diver-removal-at)", () => {
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
      hold: "on_the_water",
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
      hold: "on_the_water",
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
      hold: "on_the_water",
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
      hold: "on_the_water",
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

  it("refuses inside the first hour on the dock's word alone, with no stage tapped", async () => {
    const { db, open, seat } = await aboardSeat();
    // Left 20 minutes ago: `hasSailed` still says no, and nobody tapped a stage.
    await sail(db, open.id, 1 / 3);
    await mark(db, seat, "boarded", 25);

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
      hold: "on_the_water",
    });
    await untouched(db, seat.bookingId);
  });

  it("refuses a diver marked not back aboard whom the dock never counted", async () => {
    const { db, open, seat } = await aboardSeat();
    await sail(db, open.id);
    await mark(db, seat, "not_boarded", 10, "after_dive_1");

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
      hold: "on_the_water",
    });
    await untouched(db, seat.bookingId);
  });

  it("refuses a diver marked not back aboard after the dock's tap was cleared", async () => {
    const { db, open, seat } = await aboardSeat();
    await sail(db, open.id);
    await mark(db, seat, "boarded", 90);
    await mark(db, seat, "cleared", 80);
    await mark(db, seat, "not_boarded", 10, "after_dive_1");

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
      hold: "on_the_water",
    });
    await untouched(db, seat.bookingId);
  });

  it("refuses a seat nobody spoke for once the boat has sailed: it counts as carried", async () => {
    const { db, open, seat } = await aboardSeat();
    await sail(db, open.id);

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
      hold: "uncounted",
    });
    await untouched(db, seat.bookingId);
  });

  it("keeps refusing after the boat is home: the seat sailed", async () => {
    const { db, open, seat } = await aboardSeat();
    const other = await bookAnother(db, seat.shopId, open.id);
    // Left three days ago and home the same afternoon.
    await sail(db, open.id, 72);
    await mark(db, seat, "boarded", 72 * 60);

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
      hold: "on_the_water",
    });
    expect(await cancelBooking(db, seat.shopId, other.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
      hold: "uncounted",
    });
    await untouched(db, seat.bookingId);
  });

  it("still removes a seat nobody spoke for before the boat has sailed", async () => {
    const { db, open, seat } = await aboardSeat();
    // Past its time by 20 minutes, still inside the late-arrival hour.
    await sail(db, open.id, 1 / 3);

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toMatchObject({
      ok: true,
      booking: { id: seat.bookingId, previousStatus: "booked" },
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, seat.bookingId));
    expect(row?.status).toBe("cancelled");
  });

  it("still removes a seat the desk marked a no-show once the boat has sailed", async () => {
    const { db, open, seat } = await aboardSeat();
    await sail(db, open.id);
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, seat.bookingId));

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toMatchObject({ ok: true });
  });

  it("still removes a diver the crew marked as never leaving the dock", async () => {
    const { db, open, seat } = await aboardSeat();
    await sail(db, open.id);
    await mark(db, seat, "not_boarded", 90);

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toMatchObject({ ok: true });
  });

  it("removes a diver once the crew mark them ashore, but not once they merely undo the tap", async () => {
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
    // Undone is silence, and a silent seat on a sailed departure was carried.
    expect(await cancelBooking(db, seat.shopId, other.bookingId)).toMatchObject({ ok: false });
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
    const third = await createBooking(db, {
      actor: "staff",
      shopId: seat.shopId,
      tripId: open.id,
      fullName: "Uma Unspoken",
      email: "uma-unspoken@example.com",
    });
    if (!third.ok) throw new Error("setup booking failed");
    await sail(db, open.id);
    await mark(db, seat, "boarded", 90);
    await mark(db, { ...seat, bookingId: other.bookingId }, "not_boarded", 90);

    const aboard = await aboardAtSeaBookingIds(db, {
      shopId: seat.shopId,
      tripId: open.id,
      now: nowDate(),
    });
    // The unspoken-for seat counts as carried; the one the dock left ashore does not.
    expect(aboard.has(seat.bookingId)).toBe(true);
    expect(aboard.has(third.bookingId)).toBe(true);
    expect(aboard.has(other.bookingId)).toBe(false);
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

  // ── Second review (dde-3) ────────────────────────────────────────────────

  async function crewSeat(db: AppDb, shopId: string, tripId: string, assigned = true) {
    const [staffer] = await listStaff(db, shopId);
    if (!staffer) throw new Error("seeded staff missing");
    if (assigned) {
      await db
        .insert(tripAssignments)
        .values({ tripId, personId: staffer.person.id })
        .onConflictDoNothing();
    }
    const [seat] = await db
      .insert(bookings)
      .values({ bookedAs: "diver", shopId, tripId, personId: staffer.person.id, status: "booked" })
      .returning({ id: bookings.id });
    if (!seat) throw new Error("setup crew seat failed");
    return { personId: staffer.person.id, bookingId: seat.id };
  }

  async function markCrew(
    db: AppDb,
    crew: { shopId: string; tripId: string; personId: string },
    status: "boarded" | "not_boarded" | "cleared",
    minutesAgo: number,
    checkpoint = "departure",
  ) {
    await db.insert(rollCallCrewEvents).values({
      ...crew,
      recordedByPersonId: crew.personId,
      status,
      checkpoint,
      occurredAt: new Date(nowMs() - minutesAgo * 60 * 1000),
    });
  }

  it("refuses a dock-boarded diver marked not back aboard on a boat taken out early, no stage tapped", async () => {
    // The boat left before its time; the crew counted the dock and then the
    // first dive. An after-dive checkpoint is never taken at the dock.
    const { db, seat } = await aboardSeat();
    await mark(db, seat, "boarded", 120);
    await mark(db, seat, "not_boarded", 10, "after_dive_1");

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
      hold: "on_the_water",
    });
    await untouched(db, seat.bookingId);
  });

  it("refuses a dock-boarded diver on an early boat once anyone, crew included, has an after-dive result", async () => {
    const { db, open, seat } = await aboardSeat();
    await mark(db, seat, "boarded", 60);
    const crew = await crewSeat(db, seat.shopId, open.id);
    await markCrew(
      db,
      { shopId: seat.shopId, tripId: open.id, personId: crew.personId },
      "boarded",
      5,
      "after_dive_1",
    );

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toMatchObject({
      ok: false,
      hold: "on_the_water",
    });
  });

  it("fails closed on an after-dive tap the crew undid: the boat still left", async () => {
    const { db, open, seat } = await aboardSeat();
    const other = await bookAnother(db, seat.shopId, open.id);
    await mark(db, seat, "boarded", 60);
    const otherSeat = { ...seat, bookingId: other.bookingId };
    await mark(db, otherSeat, "boarded", 20, "after_dive_1");
    await mark(db, otherSeat, "cleared", 15, "after_dive_1");

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toMatchObject({
      ok: false,
      hold: "on_the_water",
    });
  });

  it("says why each seat is held: on the water, or never counted at the dock", async () => {
    const { db, open, seat } = await aboardSeat();
    const other = await bookAnother(db, seat.shopId, open.id);
    await sail(db, open.id);
    await mark(db, seat, "boarded", 90);

    const held = await aboardAtSeaBookingIds(db, {
      shopId: seat.shopId,
      tripId: open.id,
      now: nowDate(),
    });
    expect(held.get(seat.bookingId)).toBe("on_the_water");
    expect(held.get(other.bookingId)).toBe("uncounted");
    expect(await cancelBooking(db, seat.shopId, other.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
      hold: "uncounted",
    });
  });

  it("holds a seat whose dock tap was undone: cleared is silence, not ashore", async () => {
    const { db, open, seat } = await aboardSeat();
    await sail(db, open.id);
    await mark(db, seat, "boarded", 90);
    await mark(db, seat, "cleared", 80);

    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toEqual({
      ok: false,
      reason: "aboard_at_sea",
      hold: "uncounted",
    });
    await untouched(db, seat.bookingId);

    // The dock's own "not boarded" after the undo lets it go.
    await mark(db, seat, "not_boarded", 5);
    expect(await cancelBooking(db, seat.shopId, seat.bookingId)).toMatchObject({ ok: true });
  });

  it("lets go a staffer's seat the crew list marked ashore at the dock", async () => {
    const { db, open } = await seededContext();
    await sail(db, open.id);
    const crew = await crewSeat(db, ctx.shop.id, open.id);
    await markCrew(
      db,
      { shopId: ctx.shop.id, tripId: open.id, personId: crew.personId },
      "not_boarded",
      90,
    );

    expect(await cancelBooking(db, ctx.shop.id, crew.bookingId)).toMatchObject({ ok: true });
  });

  it("holds a staffer's seat when the crew list's ashore tap was undone, or they are off the crew", async () => {
    const { db, open } = await seededContext();
    await sail(db, open.id);
    const undone = await crewSeat(db, ctx.shop.id, open.id);
    const crewOf = { shopId: ctx.shop.id, tripId: open.id, personId: undone.personId };
    await markCrew(db, crewOf, "not_boarded", 90);
    await markCrew(db, crewOf, "cleared", 80);
    expect(await cancelBooking(db, ctx.shop.id, undone.bookingId)).toMatchObject({
      ok: false,
      hold: "uncounted",
    });

    // Taken off the crew: their crew-list word no longer speaks for the seat.
    await markCrew(db, crewOf, "not_boarded", 70);
    await db
      .delete(tripAssignments)
      .where(
        and(eq(tripAssignments.tripId, open.id), eq(tripAssignments.personId, undone.personId)),
      );
    expect(await cancelBooking(db, ctx.shop.id, undone.bookingId)).toMatchObject({
      ok: false,
      hold: "uncounted",
    });
  });

  it("holds a staffer's seat the crew list counted aboard, as on the water", async () => {
    const { db, open } = await seededContext();
    await sail(db, open.id);
    const crew = await crewSeat(db, ctx.shop.id, open.id);
    await markCrew(
      db,
      { shopId: ctx.shop.id, tripId: open.id, personId: crew.personId },
      "boarded",
      90,
    );

    expect(await cancelBooking(db, ctx.shop.id, crew.bookingId)).toMatchObject({
      ok: false,
      hold: "on_the_water",
    });
  });

  it("the diver table's dock word wins over the crew list's ashore", async () => {
    const { db, open } = await seededContext();
    await sail(db, open.id);
    const crew = await crewSeat(db, ctx.shop.id, open.id);
    await markCrew(
      db,
      { shopId: ctx.shop.id, tripId: open.id, personId: crew.personId },
      "not_boarded",
      90,
    );
    await mark(
      db,
      { shopId: ctx.shop.id, tripId: open.id, bookingId: crew.bookingId },
      "boarded",
      80,
    );

    expect(await cancelBooking(db, ctx.shop.id, crew.bookingId)).toMatchObject({
      ok: false,
      hold: "on_the_water",
    });
  });
});
