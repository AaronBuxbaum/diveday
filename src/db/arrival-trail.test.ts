import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { markArrived } from "@/test/arrivals";
import { fileScopedShopContext } from "@/test/db";
import { seatCheckedIn, standingArrivalStatus } from "./arrival-provenance";
import { moveBooking, restoreBooking, selfCancelBooking } from "./bookings";
import { checkInBooking, listCheckInQueue, undoCheckInBooking } from "./check-in";
import { strandedMoveOffer } from "./move-offer";
import { undoBookingNoShow } from "./no-show";
import { bookingArrivalEvents, bookings, rollCallEvents, trips } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

/**
 * **Arrival is a trail, not a status** (issue #2702, ADR
 * 20261104-arrival-is-a-trail). Adversarial: each case is a way the old
 * mirror could have been left behind, or a way reading the trail alone could
 * put somebody on the counter, or on a boat, on nobody's word.
 */

const ctx = fileScopedShopContext();

async function context() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const reef = trips.find((trip) => trip.title === "Two-Tank Reef — Molasses & French");
  if (!reef) throw new Error("seeded reef trip missing");
  const other = trips.find((trip) => trip.id !== reef.id && trip.startsAt > reef.startsAt);
  if (!other) throw new Error("seeded second trip missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("seeded staff missing");
  const [seat] = await getTripRoster(db, shop.id, reef.id);
  if (!seat) throw new Error("seeded booking missing");
  return { db, shop, reef, other, staff: staff.person, seat };
}

/** Clear the seat to board, so the live check-in writer accepts it. */
async function clear(db: (typeof ctx)["db"], shopId: string, bookingId: string, name: string) {
  const issued = await issueWaiverRequest(db, { shopId, bookingId });
  if (!issued.ok) throw new Error("waiver request refused");
  await completeWaiver(db, issued.token, {
    signerName: name,
    agreed: true,
    medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
  });
}

async function checkedIn(db: (typeof ctx)["db"], bookingId: string) {
  const [row] = await db
    .select({ status: bookings.status, checkedIn: seatCheckedIn })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row;
}

describe("arrival is read from the trail", () => {
  it("checks a diver in without touching the seat word, and writes nothing aboard", async () => {
    const { db, shop, staff, seat } = await context();
    await clear(db, shop.id, seat.booking.id, seat.person.fullName);

    const outcome = await checkInBooking(db, {
      shopId: shop.id,
      bookingId: seat.booking.id,
      recordedByPersonId: staff.id,
    });
    expect(outcome).toMatchObject({ ok: true });
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: true });
    // Decision 4 of the counter ADR, unchanged: the desk cannot say aboard.
    const aboard = await db
      .select({ id: rollCallEvents.id })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.bookingId, seat.booking.id));
    expect(aboard).toEqual([]);

    // The undo is the `cleared` row alone, and the seat stays held.
    expect(
      await undoCheckInBooking(db, {
        shopId: shop.id,
        bookingId: seat.booking.id,
        recordedByPersonId: staff.id,
      }),
    ).toMatchObject({ ok: true });
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: false });
  });

  it("never reads a released seat as checked in, and reads it again once restored", async () => {
    const { db, shop, staff, seat } = await context();
    await markArrived(db, seat.booking.id, { recordedByPersonId: staff.id });
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, seat.booking.id));

    // The sighting still stands under a released seat, and nobody reads it.
    expect(await standingArrivalStatus(db, shop.id, seat.booking.tripId, seat.booking.id)).toBe(
      "arrived",
    );
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "no_show", checkedIn: false });
    const queued = (await listCheckInQueue(db, shop.id, { tripId: seat.booking.tripId })).find(
      (row) => row.bookingId === seat.booking.id,
    );
    if (queued) expect(queued.checkedIn).toBe(false);

    const rows = async () =>
      (
        await db
          .select({ id: bookingArrivalEvents.id })
          .from(bookingArrivalEvents)
          .where(eq(bookingArrivalEvents.bookingId, seat.booking.id))
      ).length;
    const before = await rows();
    const restored = await undoBookingNoShow(db, {
      shopId: shop.id,
      bookingId: seat.booking.id,
      recordedByPersonId: staff.id,
    });
    expect(restored).toMatchObject({ ok: true });
    // Back as checked in (#1838) with no second statement about arrival.
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: true });
    expect(await rows()).toBe(before);
  });

  it("never reads a cancelled seat as checked in", async () => {
    const { db, staff, seat } = await context();
    await markArrived(db, seat.booking.id, { recordedByPersonId: staff.id });
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, seat.booking.id));
    expect(await checkedIn(db, seat.booking.id)).toEqual({
      status: "cancelled",
      checkedIn: false,
    });
  });

  it("does not carry an arrival from another departure onto this one", async () => {
    const { db, shop, other, staff, seat } = await context();
    // A row naming this seat but another departure: what a moved seat leaves
    // behind. The correlation is on the seat's own departure.
    await db.insert(bookingArrivalEvents).values({
      shopId: shop.id,
      tripId: other.id,
      bookingId: seat.booking.id,
      recordedByPersonId: staff.id,
      status: "arrived",
      source: "live",
      occurredAt: nowDate(),
    });
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: false });
  });

  it("reads the newest word, not any arrived row", async () => {
    const { db, staff, seat } = await context();
    const at = nowDate();
    await markArrived(db, seat.booking.id, { recordedByPersonId: staff.id, occurredAt: at });
    // Same instant, appended later: the tiebreak is the append order.
    await markArrived(db, seat.booking.id, {
      recordedByPersonId: staff.id,
      occurredAt: at,
      status: "cleared",
    });
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: false });
  });

  it("refuses a diver's own cancel of a seat the desk has checked in", async () => {
    const { db, shop, staff, seat } = await context();
    await markArrived(db, seat.booking.id, { recordedByPersonId: staff.id });
    expect(await selfCancelBooking(db, { shopId: shop.id, bookingId: seat.booking.id })).toEqual({
      ok: false,
      reason: "not_cancellable",
    });
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: true });
  });

  it("refuses to move a checked-in diver off the departure the desk saw them for", async () => {
    const { db, shop, other, staff, seat } = await context();
    await markArrived(db, seat.booking.id, { recordedByPersonId: staff.id });
    const moved = await moveBooking(db, {
      shopId: shop.id,
      fromTripId: seat.booking.tripId,
      toTripId: other.id,
      bookingId: seat.booking.id,
    });
    expect(moved).toMatchObject({ ok: false, reason: "not_movable" });
    const [still] = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(and(eq(bookings.id, seat.booking.id), eq(bookings.shopId, shop.id)));
    expect(still?.tripId).toBe(seat.booking.tripId);
  });

  it("still counts a checked-in diver's seat as held", async () => {
    const { db, shop, reef, staff, seat } = await context();
    const before = (await upcomingTripsWithCounts(db, shop.id)).find((t) => t.id === reef.id);
    await markArrived(db, seat.booking.id, { recordedByPersonId: staff.id });
    expect(before?.booked).toBeGreaterThan(0);
    const after = (await upcomingTripsWithCounts(db, shop.id)).find((t) => t.id === reef.id);
    expect(after?.booked).toBe(before?.booked);
  });
});

describe("a seat that comes back starts a fresh trail", () => {
  it("does not read a Remove undone as checked in, and the next tap re-runs readiness", async () => {
    const { db, shop, staff, seat } = await context();
    await clear(db, shop.id, seat.booking.id, seat.person.fullName);
    await markArrived(db, seat.booking.id, { recordedByPersonId: staff.id });
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, seat.booking.id));

    expect(await restoreBooking(db, shop.id, seat.booking.id)).toBe("restored");
    // The `arrived` row still stands, from the seat's last life.
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: false });
    const again = await checkInBooking(db, {
      shopId: shop.id,
      bookingId: seat.booking.id,
      recordedByPersonId: staff.id,
    });
    // A real check-in, not a duplicate that skipped the readiness gate.
    expect(again).toMatchObject({ ok: true });
    expect(again).not.toMatchObject({ duplicate: true });
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: true });
  });

  it("refuses a check-in on a restored seat readiness would not board", async () => {
    const { db, shop, staff, seat } = await context();
    // Seen once (a fixture row, no waiver), then removed and put back.
    await markArrived(db, seat.booking.id, { recordedByPersonId: staff.id });
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, seat.booking.id));
    expect(await restoreBooking(db, shop.id, seat.booking.id)).toBe("restored");

    const tap = await checkInBooking(db, {
      shopId: shop.id,
      bookingId: seat.booking.id,
      recordedByPersonId: staff.id,
    });
    expect(tap).toMatchObject({ ok: false });
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: false });
  });

  it("does not hand a released seat moved away and back the arrival from its first stay", async () => {
    const { db, shop, other, staff, seat } = await context();
    const home = seat.booking.tripId;
    await markArrived(db, seat.booking.id, { recordedByPersonId: staff.id });
    // Turned away: the one released seat a move takes.
    await db
      .update(bookings)
      .set({ status: "no_show", turnedAwayReason: "waiver", turnedAwayAt: nowDate() })
      .where(eq(bookings.id, seat.booking.id));
    const away = await moveBooking(db, {
      shopId: shop.id,
      fromTripId: home,
      toTripId: other.id,
      bookingId: seat.booking.id,
    });
    expect(away).toMatchObject({ ok: true });
    const back = await moveBooking(db, {
      shopId: shop.id,
      fromTripId: other.id,
      toTripId: home,
      bookingId: seat.booking.id,
    });
    expect(back).toMatchObject({ ok: true });
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: false });
  });
});

describe("a queued tap cannot outrank what the desk said since", () => {
  const MINUTE = 60_000;
  function queued(occurredAt: Date) {
    return {
      source: "offline" as const,
      clientEventId: crypto.randomUUID(),
      occurredAt,
      offlineSnapshotSavedAt: new Date(occurredAt.getTime() - 10 * MINUTE),
    };
  }

  it("stores a device clock running ahead at the server's time, so a live undo after it wins", async () => {
    const { db, shop, staff, seat } = await context();
    await clear(db, shop.id, seat.booking.id, seat.person.fullName);
    const ahead = new Date(nowDate().getTime() + 4 * MINUTE);
    expect(
      await checkInBooking(db, {
        shopId: shop.id,
        bookingId: seat.booking.id,
        recordedByPersonId: staff.id,
        ...queued(ahead),
      }),
    ).toMatchObject({ ok: true });
    await undoCheckInBooking(db, {
      shopId: shop.id,
      bookingId: seat.booking.id,
      recordedByPersonId: staff.id,
    });
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: false });
  });

  it("refuses a tap queued on the departure a seat has since left", async () => {
    const { db, shop, other, staff, seat } = await context();
    await clear(db, shop.id, seat.booking.id, seat.person.fullName);
    expect(
      await checkInBooking(db, {
        shopId: shop.id,
        bookingId: seat.booking.id,
        recordedByPersonId: staff.id,
        expectedTripId: other.id,
        ...queued(new Date(nowDate().getTime() - 5 * MINUTE)),
      }),
    ).toMatchObject({ ok: false, reason: "snapshot_invalid" });
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: false });
  });

  it("judges a queued tap against corrections made before the seat reopened", async () => {
    const { db, shop, staff, seat } = await context();
    await clear(db, shop.id, seat.booking.id, seat.person.fullName);
    const tappedAt = new Date(nowDate().getTime() - 20 * MINUTE);
    // The desk's later word, then a Remove undone.
    await markArrived(db, seat.booking.id, {
      recordedByPersonId: staff.id,
      occurredAt: new Date(tappedAt.getTime() + 5 * MINUTE),
      status: "cleared",
    });
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, seat.booking.id));
    expect(await restoreBooking(db, shop.id, seat.booking.id)).toBe("restored");
    expect(
      await checkInBooking(db, {
        shopId: shop.id,
        bookingId: seat.booking.id,
        recordedByPersonId: staff.id,
        ...queued(tappedAt),
      }),
    ).toMatchObject({ ok: false, reason: "newer_event_exists" });
  });

  it("offers no move to a diver the desk has seen on a called-off boat", async () => {
    const { db, shop, staff, seat } = await context();
    await markArrived(db, seat.booking.id, { recordedByPersonId: staff.id });
    await db
      .update(trips)
      .set({ status: "cancelled", cancelledAt: nowDate() })
      .where(eq(trips.id, seat.booking.tripId));
    expect(
      await strandedMoveOffer(db, { shopId: shop.id, bookingId: seat.booking.id, now: nowDate() }),
    ).toBeNull();
  });
});
