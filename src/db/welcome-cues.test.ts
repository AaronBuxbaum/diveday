import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { fileScopedShopContext } from "@/test/db";
import { bookings, people, trips } from "./schema";
import { setWelcomeConsent, welcomeCueInputsByBooking } from "./welcome-cues";

/**
 * The welcome word's own facts (issue #1182, delight report D22). Two things
 * are worth pinning here rather than at the surface: this is the *only* writer
 * of the consent stamp anywhere in the app, and the stamp is permission for one
 * day rather than a standing preference.
 */
async function welcomeFixture() {
  const { db, shop } = ctx;
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

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

describe("setWelcomeConsent", () => {
  it("stamps the seat, and takes it back again", async () => {
    const { db, shop, trip, seat } = await welcomeFixture();
    // An instant this departure is unambiguously still open at, named rather
    // than inherited. The frozen clock sits *exactly* on `endsAt` plus the
    // late-arrival hour for this seeded boat, so a test that leant on the
    // ambient `now` was really asserting which way the boundary tips — which
    // is a different test, two `it`s below.
    const aboard = new Date(trip.endsAt.getTime() - 60_000);
    expect(
      await setWelcomeConsent(db, {
        shopId: shop.id,
        bookingId: seat.id,
        shared: true,
        now: aboard,
      }),
    ).toEqual({ ok: true });

    const shared = await welcomeCueInputsByBooking(db, shop.id, trip.id);
    expect(shared.get(seat.id)?.sharedAt).toBeInstanceOf(Date);

    expect(
      await setWelcomeConsent(db, {
        shopId: shop.id,
        bookingId: seat.id,
        shared: false,
        now: aboard,
      }),
    ).toEqual({ ok: true });
    const withdrawn = await welcomeCueInputsByBooking(db, shop.id, trip.id);
    expect(withdrawn.get(seat.id)?.sharedAt).toBeNull();
  });

  it("counts the boat home on the exact stroke of the late-arrival hour", async () => {
    // The boundary itself, pinned because the e2e fleet's frozen clock lands on
    // it for this departure — so "the tie" is the ordinary case there, not a
    // corner. `hasReturned` is inclusive, and this is the one writer of the
    // stamp: whichever way it tips, every "is the boat home?" check in the app
    // has to tip the same way, which is the whole reason the offset is not
    // spelled here by hand.
    const { db, shop, trip, seat } = await welcomeFixture();
    const onTheStroke = new Date(trip.endsAt.getTime() + DEPARTURE_BUFFER_MS);
    expect(
      await setWelcomeConsent(db, {
        shopId: shop.id,
        bookingId: seat.id,
        shared: true,
        now: onTheStroke,
      }),
    ).toEqual({ ok: false, reason: "trip_over" });
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

  // Dive-domain review of layer r4-5, note 7: "First dive with us" is a claim
  // about diving. A seat the diver never sat in, or one they spent snorkeling
  // or riding, is not a prior dive; a snorkeler or rider is greeted on any
  // prior seat, and with words that do not call it a dive.
  async function twoDepartures() {
    const { db, shop } = ctx;
    const rows = await db
      .select({ id: trips.id, startsAt: trips.startsAt })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .orderBy(trips.startsAt);
    const earlier = rows[0];
    const later = rows.find((row) => earlier && row.startsAt > earlier.startsAt);
    if (!earlier || !later) throw new Error("welcome fixture needs two departures");
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Noor Haddad" })
      .returning({ id: people.id });
    if (!person) throw new Error("fixture insert failed");
    const seat = async (
      tripId: string,
      type: "diver" | "snorkeler" | "rider",
      status: "booked" | "no_show" = "booked",
    ) => {
      const [row] = await db
        .insert(bookings)
        .values({
          shopId: shop.id,
          tripId,
          personId: person.id,
          participantType: type,
          bookedAs: type,
          status,
        })
        .returning({ id: bookings.id });
      if (!row) throw new Error("fixture insert failed");
      return row.id;
    };
    return { db, shop, earlier, later, seat };
  }

  it("does not count a no-show as a prior dive", async () => {
    const { db, shop, earlier, later, seat } = await twoDepartures();
    await seat(earlier.id, "diver", "no_show");
    const now = await seat(later.id, "diver");
    const inputs = await welcomeCueInputsByBooking(db, shop.id, later.id, later.startsAt);
    expect(inputs.get(now)).toMatchObject({ lastDivedAt: null, nonDiver: false });
  });

  it("does not count a snorkel seat as a prior dive", async () => {
    const { db, shop, earlier, later, seat } = await twoDepartures();
    await seat(earlier.id, "snorkeler");
    const now = await seat(later.id, "diver");
    const inputs = await welcomeCueInputsByBooking(db, shop.id, later.id, later.startsAt);
    expect(inputs.get(now)?.lastDivedAt).toBeNull();
  });

  it("greets a rider on any prior seat, as a non-diver", async () => {
    const { db, shop, earlier, later, seat } = await twoDepartures();
    await seat(earlier.id, "snorkeler");
    const now = await seat(later.id, "rider");
    const inputs = await welcomeCueInputsByBooking(db, shop.id, later.id, later.startsAt);
    expect(inputs.get(now)).toMatchObject({ lastDivedAt: earlier.startsAt, nonDiver: true });
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
