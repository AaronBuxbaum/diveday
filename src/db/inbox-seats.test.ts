import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { inboxSeats } from "./inbox-seats";
import { bookings, buddyPairMembers, people } from "./schema";
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

  it("names only the seat an Ask to move names, with no late mark, even inside the window", async () => {
    // The booking page's "Ask to move" (H-20261014-ask-to-move) carries its booking: it is about
    // that seat whenever it departs, never the sender's soonest boat.
    const { db, shop, trip, bookedAt, personId } = await context();
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
    const now = new Date(trip.startsAt.getTime() - 30 * MINUTE_MS);
    const receivedAt = new Date(Math.max(now.getTime() - 5 * MINUTE_MS, bookedAt.getTime()));
    const seats = await inboxSeats(
      db,
      shop.id,
      [{ id: MESSAGE_ID, personId, receivedAt, bookingId: second.bookingId }],
      now,
    );
    expect(seats.get(MESSAGE_ID)).toEqual([
      expect.objectContaining({ bookingId: second.bookingId, tripId: later.id, lateWindow: false }),
    ]);
  });

  it("names nothing for an Ask to move whose booking is not this shop's", async () => {
    const { db, shop, trip, personId, bookedAt } = await context();
    const receivedAt = new Date(bookedAt.getTime() + MINUTE_MS);
    const now = new Date(trip.startsAt.getTime() - 3 * 24 * HOUR_MS);
    const seats = await inboxSeats(
      db,
      shop.id,
      [{ id: MESSAGE_ID, personId, receivedAt, bookingId: crypto.randomUUID() }],
      now,
    );
    expect(seats.size).toBe(0);
  });

  it("never names a canceled seat", async () => {
    const { db, shop, trip, bookingId, personId, bookedAt } = await context();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    const receivedAt = new Date(bookedAt.getTime() + MINUTE_MS);
    const now = new Date(trip.startsAt.getTime() - 3 * 24 * HOUR_MS);
    const seats = await inboxSeats(db, shop.id, [{ id: MESSAGE_ID, personId, receivedAt }], now);
    expect(seats.size).toBe(0);
  });

  /**
   * **What the roster's Move will refuse** (issue #2668): an Ask to move on a
   * party lead's seat names the party's live seats, and one on a buddy team says
   * so, by `moveBooking`'s own predicates. Only an Ask to move carries it.
   */
  describe("an Ask to move's refusal", () => {
    async function asked() {
      const c = await context();
      const receivedAt = new Date(c.bookedAt.getTime() + MINUTE_MS);
      const now = new Date(c.trip.startsAt.getTime() - 3 * 24 * HOUR_MS);
      const read = async (bookingId?: string) =>
        (
          await inboxSeats(
            c.db,
            c.shop.id,
            [{ id: MESSAGE_ID, personId: c.personId, receivedAt, bookingId }],
            now,
          )
        ).get(MESSAGE_ID);
      return { ...c, read };
    }

    async function follower(c: Awaited<ReturnType<typeof asked>>, email: string) {
      const seat = await createBooking(c.db, {
        actor: "staff",
        shopId: c.shop.id,
        tripId: c.trip.id,
        fullName: "Party Follower",
        email,
      });
      if (!seat.ok) throw new Error(`follower booking failed: ${seat.reason}`);
      await c.db
        .update(bookings)
        .set({ partyLeadBookingId: c.bookingId })
        .where(eq(bookings.id, seat.bookingId));
      return seat.bookingId;
    }

    it("names the party a lead's seat leads, counting live seats only", async () => {
      const c = await asked();
      await follower(c, "follower.one@example.com");
      const canceled = await follower(c, "follower.two@example.com");
      await c.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, canceled));
      expect((await c.read(c.bookingId))?.[0]?.moveRefusal).toEqual({
        kind: "leads_party",
        partySize: 2,
      });
      // A message that names no booking is not an Ask to move, and says nothing.
      expect((await c.read())?.[0]?.moveRefusal).toBeUndefined();
    });

    it("says the seat is on a buddy team on its departure", async () => {
      const c = await asked();
      await c.db.insert(buddyPairMembers).values({
        shopId: c.shop.id,
        tripId: c.trip.id,
        pairId: crypto.randomUUID(),
        bookingId: c.bookingId,
        pairedByPersonId: c.personId,
      });
      expect((await c.read(c.bookingId))?.[0]?.moveRefusal).toEqual({ kind: "on_buddy_team" });
    });

    it("says nothing for a seat Move takes as it stands", async () => {
      const c = await asked();
      expect((await c.read(c.bookingId))?.[0]?.moveRefusal).toBeUndefined();
    });
  });
});
