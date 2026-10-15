import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { inboxSeats } from "./inbox-seats";
import { bookings, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **A message from a seat holder names their seat** (fourth UX review, item
 * 32). "Could I switch to the afternoon boat?" arrives days before the boat,
 * outside the running-late window, and the Inbox row used to name no seat at
 * all, so the desk had nothing to move. The row now names the seat the sender
 * already held when they wrote; "Mark running late" stays with the window.
 */

const DIVER = { fullName: "Noor Haddad", email: "noor.inbox@example.com" };
const MESSAGE_ID = "8f000000-1111-4222-8333-555555555555";

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
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.email, DIVER.email)))
    .limit(1);
  if (!diver) throw new Error("setup diver missing");
  const [seat] = await db
    .select({ createdAt: bookings.createdAt })
    .from(bookings)
    .where(eq(bookings.id, booked.bookingId));
  if (!seat) throw new Error("setup seat missing");
  return {
    db,
    shop,
    trip: open,
    bookingId: booked.bookingId,
    personId: diver.id,
    bookedAt: seat.createdAt,
  };
}

describe("inboxSeats", () => {
  it("names a seat held when they wrote, days before the boat, without the late mark", async () => {
    const { db, shop, trip, bookingId, personId, bookedAt } = await context();
    const receivedAt = new Date(bookedAt.getTime() + MINUTE_MS);
    const now = new Date(trip.startsAt.getTime() - 3 * 24 * HOUR_MS);
    const seats = await inboxSeats(db, shop.id, [{ id: MESSAGE_ID, personId, receivedAt }], now);
    expect(seats.get(MESSAGE_ID)).toEqual([
      expect.objectContaining({
        bookingId,
        tripId: trip.id,
        title: trip.title,
        lateWindow: false,
      }),
    ]);
  });

  it("offers the late mark inside the window, as the running-late reader does", async () => {
    const { db, shop, trip, bookingId, personId } = await context();
    const now = new Date(trip.startsAt.getTime() - 30 * MINUTE_MS);
    const receivedAt = new Date(now.getTime() - 5 * MINUTE_MS);
    const seats = await inboxSeats(db, shop.id, [{ id: MESSAGE_ID, personId, receivedAt }], now);
    expect(seats.get(MESSAGE_ID)).toEqual([
      expect.objectContaining({ bookingId, lateWindow: true }),
    ]);
  });

  it("names nothing for words written before the seat was booked", async () => {
    const { db, shop, trip, personId, bookedAt } = await context();
    const receivedAt = new Date(bookedAt.getTime() - HOUR_MS);
    const now = new Date(trip.startsAt.getTime() - 3 * 24 * HOUR_MS);
    const seats = await inboxSeats(db, shop.id, [{ id: MESSAGE_ID, personId, receivedAt }], now);
    expect(seats.size).toBe(0);
  });

  it("names nothing once the boat has sailed, for a stranger, or in another shop", async () => {
    const { db, shop, trip, personId, bookedAt } = await context();
    const receivedAt = new Date(bookedAt.getTime() + MINUTE_MS);
    const sailed = new Date(trip.startsAt.getTime() + 2 * HOUR_MS);
    expect(
      (await inboxSeats(db, shop.id, [{ id: MESSAGE_ID, personId, receivedAt }], sailed)).size,
    ).toBe(0);
    const now = new Date(trip.startsAt.getTime() - 3 * 24 * HOUR_MS);
    expect(
      (await inboxSeats(db, shop.id, [{ id: MESSAGE_ID, personId: null, receivedAt }], now)).size,
    ).toBe(0);
    const otherShop = "00000000-0000-4000-8000-000000000000";
    expect(
      (await inboxSeats(db, otherShop, [{ id: MESSAGE_ID, personId, receivedAt }], now)).size,
    ).toBe(0);
  });

  /**
   * dive-domain review r4-4, F1: a regular with Wednesday's reef boat and
   * Saturday's wreck boat writes "can I switch Saturday?". Naming only the
   * soonest seat put Wednesday's move one tap from the desk; the row names
   * every seat they held when they wrote, soonest first, each with its own move.
   */
  it("names every open seat the sender held when they wrote, soonest first", async () => {
    const { db, shop, trip, bookingId, personId, bookedAt } = await context();
    const later = (await upcomingTripsWithCounts(db, shop.id)).find(
      (other) =>
        other.id !== trip.id &&
        other.courseId === null &&
        other.startsAt > trip.startsAt &&
        other.booked < other.capacity,
    );
    if (!later) throw new Error("expected a later open trip");
    const second = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: later.id,
      ...DIVER,
    });
    if (!second.ok) throw new Error(`second booking failed: ${second.reason}`);
    // Both seats were booked moments ago; the message came an hour after.
    const receivedAt = new Date(bookedAt.getTime() + HOUR_MS);
    const now = new Date(trip.startsAt.getTime() - 3 * 24 * HOUR_MS);
    const seats = await inboxSeats(db, shop.id, [{ id: MESSAGE_ID, personId, receivedAt }], now);
    expect(seats.get(MESSAGE_ID)?.map((seat) => seat.bookingId)).toEqual([
      bookingId,
      second.bookingId,
    ]);
  });

  it("never names a canceled seat", async () => {
    const { db, shop, trip, bookingId, personId, bookedAt } = await context();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    const receivedAt = new Date(bookedAt.getTime() + MINUTE_MS);
    const now = new Date(trip.startsAt.getTime() - 3 * 24 * HOUR_MS);
    const seats = await inboxSeats(db, shop.id, [{ id: MESSAGE_ID, personId, receivedAt }], now);
    expect(seats.size).toBe(0);
  });
});
