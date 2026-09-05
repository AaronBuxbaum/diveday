import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEPARTURE_BUFFER_MS } from "@/lib/closeout";
import { seededShopContext } from "@/test/db";
import { bookings, trips } from "./schema";
import { setWelcomeConsent, welcomeCueInputsByBooking } from "./welcome-cues";

/**
 * The welcome word's own facts (issue #1182, delight report D22). Two things
 * are worth pinning here rather than at the surface: this is the *only* writer
 * of the consent stamp anywhere in the app, and the stamp is permission for one
 * day rather than a standing preference.
 */
async function welcomeFixture() {
  const { db, shop } = await seededShopContext();
  const [trip] = await db
    .select({ id: trips.id, endsAt: trips.endsAt })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .orderBy(trips.startsAt)
    .limit(1);
  if (!trip) throw new Error("welcome fixture needs a departure");
  const [seat] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shopId, shop.id), eq(bookings.tripId, trip.id)))
    .limit(1);
  if (!seat) throw new Error("welcome fixture needs a seated diver");
  return { db, shop, trip, seat };
}

describe("setWelcomeConsent", () => {
  it("stamps the seat, and takes it back again", async () => {
    const { db, shop, trip, seat } = await welcomeFixture();
    expect(
      await setWelcomeConsent(db, { shopId: shop.id, bookingId: seat.id, shared: true }),
    ).toEqual({ ok: true });

    const shared = await welcomeCueInputsByBooking(db, shop.id, trip.id);
    expect(shared.get(seat.id)?.sharedAt).toBeInstanceOf(Date);

    expect(
      await setWelcomeConsent(db, { shopId: shop.id, bookingId: seat.id, shared: false }),
    ).toEqual({ ok: true });
    const withdrawn = await welcomeCueInputsByBooking(db, shop.id, trip.id);
    expect(withdrawn.get(seat.id)?.sharedAt).toBeNull();
  });

  it("refuses a booking that is not this shop's", async () => {
    const { db, seat } = await welcomeFixture();
    expect(
      await setWelcomeConsent(db, {
        shopId: "00000000-0000-4000-8000-0000000000aa",
        bookingId: seat.id,
        shared: true,
      }),
    ).toEqual({ ok: false, reason: "unknown_booking" });
  });

  it("refuses once the boat is home, so the stamp cannot become a standing preference", async () => {
    const { db, shop, trip, seat } = await welcomeFixture();
    const pastBuffer = new Date(trip.endsAt.getTime() + DEPARTURE_BUFFER_MS + 60_000);
    expect(
      await setWelcomeConsent(db, {
        shopId: shop.id,
        bookingId: seat.id,
        shared: true,
        now: pastBuffer,
      }),
    ).toEqual({ ok: false, reason: "trip_over" });
  });

  it("still takes an answer inside the late-arrival hour", async () => {
    const { db, shop, trip, seat } = await welcomeFixture();
    const inBuffer = new Date(trip.endsAt.getTime() + DEPARTURE_BUFFER_MS - 60_000);
    expect(
      await setWelcomeConsent(db, {
        shopId: shop.id,
        bookingId: seat.id,
        shared: true,
        now: inBuffer,
      }),
    ).toEqual({ ok: true });
  });
});

describe("welcomeCueInputsByBooking", () => {
  it("reports every live seat, consented or not", async () => {
    const { db, shop, trip } = await welcomeFixture();
    const roster = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), eq(bookings.tripId, trip.id)));
    const inputs = await welcomeCueInputsByBooking(db, shop.id, trip.id);
    expect(inputs.size).toBe(roster.length);
    for (const [, value] of inputs) expect(value.sharedAt).toBeNull();
  });

  it("says nothing about a departure that is off the board", async () => {
    const { db, shop, trip } = await welcomeFixture();
    await db
      .update(trips)
      .set({ deletedAt: new Date("2026-07-21T13:00:00.000Z") })
      .where(eq(trips.id, trip.id));
    expect((await welcomeCueInputsByBooking(db, shop.id, trip.id)).size).toBe(0);
  });
});
