import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { bookings, people, priorVisits, trips } from "./schema";
import { createTrip } from "./trips";
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

  it("keeps the diver's choice only with the consent, and withdrawing clears it (#2425)", async () => {
    const { db, shop, trip, seat } = await welcomeFixture();
    const aboard = new Date(trip.endsAt.getTime() - 60_000);
    const base = { shopId: shop.id, bookingId: seat.id, now: aboard };

    await setWelcomeConsent(db, { ...base, shared: true, hello: "nervous" });
    expect((await welcomeCueInputsByBooking(db, shop.id, trip.id)).get(seat.id)?.hello).toBe(
      "nervous",
    );

    // Saying yes again without naming a choice leaves the choice alone.
    await setWelcomeConsent(db, { ...base, shared: true });
    expect((await welcomeCueInputsByBooking(db, shop.id, trip.id)).get(seat.id)?.hello).toBe(
      "nervous",
    );

    // A choice can be changed, and taken back on its own.
    await setWelcomeConsent(db, { ...base, shared: true, hello: "celebrating" });
    await setWelcomeConsent(db, { ...base, shared: true, hello: null });
    expect((await welcomeCueInputsByBooking(db, shop.id, trip.id)).get(seat.id)?.hello).toBeNull();

    // Withdrawing the consent clears it, whatever the caller passes.
    await setWelcomeConsent(db, { ...base, shared: true, hello: "nervous" });
    await setWelcomeConsent(db, { ...base, shared: false, hello: "nervous" });
    const [row] = await db
      .select({ hello: bookings.welcomeHello, sharedAt: bookings.welcomeSharedAt })
      .from(bookings)
      .where(eq(bookings.id, seat.id));
    expect(row).toEqual({ hello: null, sharedAt: null });
  });

  it("never reads a choice for a seat without the consent, even if the row holds one (#2425)", async () => {
    const { db, shop, trip, seat } = await welcomeFixture();
    await db.update(bookings).set({ welcomeHello: "nervous" }).where(eq(bookings.id, seat.id));
    const inputs = await welcomeCueInputsByBooking(db, shop.id, trip.id);
    expect(inputs.get(seat.id)?.sharedAt).toBeNull();
    expect(inputs.get(seat.id)?.hello).toBeNull();
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
    // A day apart, so the two seats are two dive days, not one.
    const later = rows.find(
      (row) =>
        earlier && row.startsAt.getTime() >= earlier.startsAt.getTime() + 24 * 60 * 60 * 1000,
    );
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

  // H-20261014-boat-count-milestones: which boat with the shop this one is, by the recap's own rule.
  it("counts earlier dive days and imported visits toward this boat's number", async () => {
    const { db, shop, earlier, later, seat } = await twoDepartures();
    const earlierSeat = await seat(earlier.id, "diver");
    const [row] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, earlierSeat));
    if (!row) throw new Error("fixture seat missing");
    await db.insert(priorVisits).values([
      ...Array.from({ length: 8 }, (_, index) => ({
        shopId: shop.id,
        personId: row.personId,
        visitedOn: `2024-0${(index % 9) + 1}-15`,
        sourceLabel: "Old system",
        dedupeKey: `milestone-${index}`,
        importedAt: earlier.startsAt,
      })),
      // The import says this one never happened, so it is not a boat.
      {
        shopId: shop.id,
        personId: row.personId,
        visitedOn: "2024-10-01",
        sourceLabel: "Old system",
        statusLabel: "Cancelled",
        dedupeKey: "milestone-cancelled",
        importedAt: earlier.startsAt,
      },
    ]);
    const now = await seat(later.id, "diver");
    const inputs = await welcomeCueInputsByBooking(db, shop.id, later.id, later.startsAt);
    expect(inputs.get(now)?.diveDayCount).toBe(10);
  });

  it("counts no no-show toward the number, and gives a non-diver none", async () => {
    const { db, shop, earlier, later, seat } = await twoDepartures();
    await seat(earlier.id, "diver", "no_show");
    const now = await seat(later.id, "diver");
    expect(
      (await welcomeCueInputsByBooking(db, shop.id, later.id, later.startsAt)).get(now)
        ?.diveDayCount,
    ).toBe(1);
    await db
      .update(bookings)
      .set({ participantType: "snorkeler", bookedAs: "snorkeler" })
      .where(eq(bookings.id, now));
    expect(
      (await welcomeCueInputsByBooking(db, shop.id, later.id, later.startsAt)).get(now)
        ?.diveDayCount,
    ).toBeNull();
  });

  /**
   * **One dive day per calendar day** (glossary **Dive day**; dive-domain
   * review of layer r5-4, fix 2): a morning boat and an afternoon boat are one
   * day, an imported visit on a booked day is that same day, and the count
   * runs to this departure's own day rather than to now, so two boats ahead
   * never carry one number.
   */
  describe("which dive day this one is", () => {
    const HOUR = 60 * 60 * 1000;
    // Noon UTC on a fixed date, far ahead of the demo board: the same calendar
    // day in every zone the seed uses, morning and afternoon both.
    const DAY_ONE = new Date("2031-03-04T12:00:00Z");

    async function regular() {
      const { db, shop } = ctx;
      const [person] = await db
        .insert(people)
        .values({ shopId: shop.id, fullName: "Ines Ortega" })
        .returning({ id: people.id });
      if (!person) throw new Error("fixture insert failed");
      const departure = async (startsAt: Date) => {
        const trip = await createTrip(db, {
          shopId: shop.id,
          title: "Reef",
          startsAt,
          endsAt: new Date(startsAt.getTime() + 2 * HOUR),
          capacity: 8,
          plannedDives: 1,
        });
        if (!trip) throw new Error("fixture trip failed");
        const [row] = await db
          .insert(bookings)
          .values({
            shopId: shop.id,
            tripId: trip.id,
            personId: person.id,
            participantType: "diver",
            bookedAs: "diver",
          })
          .returning({ id: bookings.id });
        if (!row) throw new Error("fixture insert failed");
        return { tripId: trip.id, bookingId: row.id, startsAt };
      };
      return { db, shop, personId: person.id, departure };
    }

    const countOf = async (
      db: AppDb,
      shopId: string,
      seat: { tripId: string; bookingId: string; startsAt: Date },
      now: Date,
    ) => (await welcomeCueInputsByBooking(db, shopId, seat.tripId, now)).get(seat.bookingId);

    it("counts a morning boat and an afternoon boat on one date as one day", async () => {
      const { db, shop, departure } = await regular();
      const morning = await departure(new Date(DAY_ONE.getTime() - 3 * HOUR));
      const afternoon = await departure(new Date(DAY_ONE.getTime() + 2 * HOUR));
      const next = await departure(new Date(DAY_ONE.getTime() + 7 * 24 * HOUR));
      const after = new Date(next.startsAt.getTime() - HOUR);

      expect((await countOf(db, shop.id, morning, after))?.diveDayCount).toBe(1);
      expect((await countOf(db, shop.id, afternoon, after))?.diveDayCount).toBe(1);
      expect((await countOf(db, shop.id, next, after))?.diveDayCount).toBe(2);
    });

    it("counts an imported visit on a booked day once", async () => {
      const { db, shop, personId, departure } = await regular();
      const booked = await departure(DAY_ONE);
      const next = await departure(new Date(DAY_ONE.getTime() + 7 * 24 * HOUR));
      await db.insert(priorVisits).values({
        shopId: shop.id,
        personId,
        visitedOn: "2031-03-04",
        sourceLabel: "Old system",
        dedupeKey: "same-day-visit",
        importedAt: DAY_ONE,
      });

      const count = await countOf(db, shop.id, next, new Date(next.startsAt.getTime() - HOUR));
      expect(count?.diveDayCount).toBe(2);
      expect((await countOf(db, shop.id, booked, DAY_ONE))?.diveDayCount).toBe(1);
    });

    it("counts to this departure's day, so two boats ahead carry two numbers", async () => {
      const { db, shop, departure } = await regular();
      const first = await departure(DAY_ONE);
      const second = await departure(new Date(DAY_ONE.getTime() + 7 * 24 * HOUR));
      // Both still ahead of the clock.
      const before = new Date(DAY_ONE.getTime() - 24 * HOUR);

      expect((await countOf(db, shop.id, first, before))?.diveDayCount).toBe(1);
      expect((await countOf(db, shop.id, second, before))?.diveDayCount).toBe(2);
    });
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
