import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { markArrived } from "@/test/arrivals";
import { fileScopedShopContext } from "@/test/db";
import { seatCheckedIn, standingArrivalStatus } from "./arrival-provenance";
import { moveBooking, selfCancelBooking } from "./bookings";
import { checkInBooking, listCheckInQueue, undoCheckInBooking } from "./check-in";
import { undoBookingNoShow } from "./no-show";
import { bookingArrivalEvents, bookings, rollCallEvents } from "./schema";
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
      occurredAt: new Date(),
    });
    expect(await checkedIn(db, seat.booking.id)).toEqual({ status: "booked", checkedIn: false });
  });

  it("reads the newest word, not any arrived row", async () => {
    const { db, staff, seat } = await context();
    const at = new Date();
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
