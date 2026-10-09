import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { listCheckInQueue } from "./check-in";
import {
  markBookingRunningLate,
  markPersonRunningLate,
  markPhoneRunningLate,
} from "./running-late";
import { bookings, people, trips } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **"Running late"** (J3): one guarded write behind three doors. What matters
 * is where it is refused — a seat that has arrived, a boat that has left, a
 * trip too far off — and that the first statement stands.
 */

const DIVER = { fullName: "Iris Okafor", email: "iris.late@example.com", phone: "+1-305-555-0177" };
const E164 = "+13055550177";

const ctx = fileScopedShopContext();

async function context() {
  const { db, shop } = ctx;
  const open = (await upcomingTripsWithCounts(db, shop.id)).find(
    (trip) => trip.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!open) throw new Error("expected seeded trip missing");
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: open.id,
    ...DIVER,
  });
  if (!booked.ok) throw new Error("setup booking failed");
  const [diver] = await db
    .select({ id: people.id, phone: people.phone })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.email, DIVER.email)))
    .limit(1);
  if (!diver) throw new Error("setup diver missing");
  // Half an hour before the boat leaves: the ordinary moment to say it.
  const now = new Date(open.startsAt.getTime() - 30 * MINUTE_MS);
  return {
    db,
    shop,
    trip: open,
    bookingId: booked.bookingId,
    personId: diver.id,
    phone: diver.phone,
    now,
  };
}

async function lateAt(bookingId: string) {
  const [row] = await ctx.db
    .select({ at: bookings.runningLateAt })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.at ?? null;
}

describe("markBookingRunningLate", () => {
  it("stamps an open seat, and the first statement stands", async () => {
    const { db, shop, bookingId, now } = await context();
    expect(await markBookingRunningLate(db, { shopId: shop.id, bookingId, now })).toEqual({
      status: "marked",
      bookingId,
      at: now,
    });
    const later = new Date(now.getTime() + 5 * MINUTE_MS);
    expect(await markBookingRunningLate(db, { shopId: shop.id, bookingId, now: later })).toEqual({
      status: "already",
      bookingId,
      at: now,
    });
    expect(await lateAt(bookingId)).toEqual(now);
  });

  it("refuses before the window, at departure, and after", async () => {
    const { db, shop, trip, bookingId } = await context();
    for (const now of [
      new Date(trip.startsAt.getTime() - 13 * HOUR_MS),
      trip.startsAt,
      new Date(trip.startsAt.getTime() + 10 * MINUTE_MS),
    ]) {
      expect(await markBookingRunningLate(db, { shopId: shop.id, bookingId, now })).toEqual({
        status: "closed",
      });
    }
    expect(await lateAt(bookingId)).toBeNull();
  });

  it("refuses a seat that has already checked in, and a called-off departure", async () => {
    const { db, shop, trip, bookingId, now } = await context();
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    expect(await markBookingRunningLate(db, { shopId: shop.id, bookingId, now })).toEqual({
      status: "closed",
    });
    await db.update(bookings).set({ status: "booked" }).where(eq(bookings.id, bookingId));
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    expect(await markBookingRunningLate(db, { shopId: shop.id, bookingId, now })).toEqual({
      status: "closed",
    });
  });

  it("never reaches another shop's booking", async () => {
    const { db, bookingId, now } = await context();
    const otherShop = "00000000-0000-4000-8000-000000000000";
    expect(await markBookingRunningLate(db, { shopId: otherShop, bookingId, now })).toEqual({
      status: "closed",
    });
    expect(await lateAt(bookingId)).toBeNull();
  });
});

describe("the arrivals list", () => {
  it("says it on a seat still to arrive, and drops it once they check in", async () => {
    const { db, shop, trip, bookingId, now } = await context();
    await markBookingRunningLate(db, { shopId: shop.id, bookingId, now });
    const [row] = await listCheckInQueue(db, shop.id, { now, tripId: trip.id, query: DIVER.email });
    expect(row?.runningLateAt).toEqual(now);

    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    const [arrived] = await listCheckInQueue(db, shop.id, {
      now,
      tripId: trip.id,
      query: DIVER.email,
    });
    expect(arrived?.runningLateAt).toBeNull();
  });
});

describe("markPersonRunningLate (a LATE reply)", () => {
  it("marks the diver's soonest open seat in this shop", async () => {
    const { db, shop, personId, bookingId, now } = await context();
    expect(await markPersonRunningLate(db, { shopId: shop.id, personId, now })).toMatchObject({
      status: "marked",
      bookingId,
    });
  });

  it("finds nothing when no seat is inside the window", async () => {
    const { db, shop, trip, personId } = await context();
    const tooEarly = new Date(trip.startsAt.getTime() - 2 * 24 * HOUR_MS);
    expect(await markPersonRunningLate(db, { shopId: shop.id, personId, now: tooEarly })).toEqual({
      status: "closed",
    });
  });
});

describe("markPhoneRunningLate (a LATE text)", () => {
  it("matches the stored E.164 number exactly", async () => {
    const { db, bookingId, phone, now } = await context();
    expect(phone).toBe(E164);
    expect(await markPhoneRunningLate(db, { phone: E164, now })).toMatchObject({
      status: "marked",
      bookingId,
    });
  });

  it("finds nothing for a number nobody holds", async () => {
    const { db, now } = await context();
    expect(await markPhoneRunningLate(db, { phone: "+13055550000", now })).toEqual({
      status: "closed",
    });
  });

  it("ignores a deleted diver record's number", async () => {
    const { db, personId, now } = await context();
    await db.update(people).set({ deletedAt: now }).where(eq(people.id, personId));
    expect(await markPhoneRunningLate(db, { phone: E164, now })).toEqual({ status: "closed" });
  });
});
