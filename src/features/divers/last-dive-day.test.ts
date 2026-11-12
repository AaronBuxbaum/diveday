import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBooking } from "../../db/bookings";
import type { AppDb } from "../../db/client";
import {
  bookingArrivalEvents,
  bookings,
  executedDives,
  people,
  personRoles,
  trips,
} from "../../db/schema/index";
import { nowMs } from "../../lib/clock";
import { fileScopedShopContext } from "../../test/db";
import { createDiver, findSimilarDivers, lastDiveDaysHere } from "./store";

/**
 * File-scoped database (issue #1244): one PGlite for the whole file, and a
 * transaction per test that is rolled back afterwards. The roster is a read
 * surface — thirty tests that seat, search, page and filter, each reading back
 * what it just wrote — so nothing here needs its rows committed.
 */
const ctx = fileScopedShopContext();

describe("findSimilarDivers last dive day", () => {
  const HOUR_MS = 60 * 60 * 1000;
  /** Far enough from every seeded name that only this test's rows can match. */
  const NAME = "Marisol Etxebarria";

  async function candidate(db: AppDb, shopId: string) {
    const person = await createDiver(db, {
      shopId,
      fullName: NAME,
      email: "marisol.etxebarria@example.com",
    });
    if (!person) throw new Error("createDiver refused the candidate");
    return person;
  }

  /**
   * A seat on a departure that has since sailed.
   *
   * Booked while the boat is still ahead and back-dated afterwards, because
   * `createBooking` refuses one that has left — which is the only order a real
   * seat on a past departure ever happens in.
   */
  async function sailedSeat(
    db: AppDb,
    shopId: string,
    personId: string,
    title: string,
    startsAt: Date,
  ) {
    const [trip] = await db
      .insert(trips)
      .values({
        shopId,
        title,
        startsAt: new Date(nowMs() + 48 * HOUR_MS),
        endsAt: new Date(nowMs() + 52 * HOUR_MS),
        capacity: 6,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const booking = await createBooking(db, { actor: "staff", shopId, tripId: trip.id, personId });
    expect(booking.ok, `seating on ${title} has to land`).toBe(true);
    const [sailed] = await db
      .update(trips)
      .set({ startsAt, endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS) })
      .where(eq(trips.id, trip.id))
      .returning();
    if (!sailed) throw new Error("back-dating the departure returned no row");
    return sailed;
  }

  const lastDiveDayOf = async (db: AppDb, shopId: string, personId: string) => {
    const matches = await findSimilarDivers(db, shopId, NAME);
    const row = matches.find((match) => match.id === personId);
    if (!row) throw new Error("the candidate has to be on the prompt for this to mean anything");
    return row.lastDiveDayAt;
  };

  it("reports the most recent departure a candidate has actually sailed on", async () => {
    const { db, shop } = ctx;
    const person = await candidate(db, shop.id);
    await sailedSeat(db, shop.id, person.id, "Three days ago", new Date(nowMs() - 72 * HOUR_MS));
    const yesterday = await sailedSeat(
      db,
      shop.id,
      person.id,
      "Yesterday",
      new Date(nowMs() - 24 * HOUR_MS),
    );
    // A seat on a boat that has not left is not a dive day, however soon it is.
    const [ahead] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Next week",
        startsAt: new Date(nowMs() + 7 * 24 * HOUR_MS),
        endsAt: new Date(nowMs() + 7 * 24 * HOUR_MS + 4 * HOUR_MS),
        capacity: 6,
      })
      .returning();
    if (!ahead) throw new Error("trip insert returned no row");
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: ahead.id,
      personId: person.id,
    });
    expect(booked.ok).toBe(true);

    expect(await lastDiveDayOf(db, shop.id, person.id)).toEqual(yesterday.startsAt);
  });

  it("reports nothing for a candidate this shop has never had on a boat", async () => {
    const { db, shop } = ctx;
    const person = await candidate(db, shop.id);
    expect(await lastDiveDayOf(db, shop.id, person.id)).toBeNull();
  });

  it("reports nothing when the one seat on file was canceled", async () => {
    const { db, shop } = ctx;
    const person = await candidate(db, shop.id);
    const trip = await sailedSeat(
      db,
      shop.id,
      person.id,
      "Canceled seat",
      new Date(nowMs() - 24 * HOUR_MS),
    );
    await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(eq(bookings.tripId, trip.id), eq(bookings.personId, person.id)));

    expect(await lastDiveDayOf(db, shop.id, person.id)).toBeNull();
  });

  it("reports nothing for a no-show, or for a departure the shop called off", async () => {
    const { db, shop } = ctx;
    const person = await candidate(db, shop.id);
    const missed = await sailedSeat(
      db,
      shop.id,
      person.id,
      "Never turned up",
      new Date(nowMs() - 24 * HOUR_MS),
    );
    await db
      .update(bookings)
      .set({ status: "no_show" })
      .where(and(eq(bookings.tripId, missed.id), eq(bookings.personId, person.id)));
    expect(await lastDiveDayOf(db, shop.id, person.id)).toBeNull();

    // A blown-out departure leaves its bookings active by design, so without
    // the trip-status clause this would name a day nobody went in the water.
    const blownOut = await sailedSeat(
      db,
      shop.id,
      person.id,
      "Blown out",
      new Date(nowMs() - 48 * HOUR_MS),
    );
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, blownOut.id));
    expect(await lastDiveDayOf(db, shop.id, person.id)).toBeNull();
  });

  /**
   * A staffer's own `arrived` row, written here rather than through
   * `checkInBooking`, whose door is
   * readiness-gated. What this file owns is whether the *counter* spends the
   * standing verdict at all.
   */
  async function deskSawThem(db: AppDb, shopId: string, tripId: string, bookingId: string) {
    const [staffer] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
      .limit(1);
    if (!staffer) throw new Error("the seeded shop has to have an owner to record an arrival");
    await db.insert(bookingArrivalEvents).values({
      shopId,
      tripId,
      bookingId,
      recordedByPersonId: staffer.id,
      status: "arrived",
      occurredAt: new Date(nowMs() - 25 * HOUR_MS),
    });
  }

  it("stays silent on a seat the desk checked in and a staffer then released", async () => {
    // The escape this used to assert, run backwards (`dive-domain-expert`,
    // 2026-09-11). A standing desk sighting used to outrank `no_show` here,
    // against a close-of-day sweep the product never had; the real writer is
    // one staffer's deliberate tap, always later than the check-in it
    // overwrites. Naming the day would tell the next staffer this person dived
    // here on a morning the shop's own record says they never came — and that
    // is the fact the identity question turns on.
    const { db, shop } = ctx;
    const person = await candidate(db, shop.id);
    const startsAt = new Date(nowMs() - 24 * HOUR_MS);
    const trip = await sailedSeat(db, shop.id, person.id, "Seen, then released", startsAt);
    const [seat] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), eq(bookings.personId, person.id)));
    if (!seat) throw new Error("the seat has to exist for this case to mean anything");
    await deskSawThem(db, shop.id, trip.id, seat.id);
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, seat.id));

    expect(await lastDiveDayOf(db, shop.id, person.id)).toBeNull();
  });

  it("still names a called-off departure the crew logged a dive on", async () => {
    // A status column changed afterwards for a refund or a re-papered charter
    // does not outrank a dive somebody wrote down. Without this the counter
    // goes quiet on a day the shop has a dive log for.
    const { db, shop } = ctx;
    const person = await candidate(db, shop.id);
    const trip = await sailedSeat(
      db,
      shop.id,
      person.id,
      "Called off after the fact",
      new Date(nowMs() - 24 * HOUR_MS),
    );
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    await db.insert(executedDives).values({ shopId: shop.id, tripId: trip.id, diveNumber: 1 });

    expect(await lastDiveDayOf(db, shop.id, person.id)).toEqual(trip.startsAt);
  });

  /**
   * A held seat's "Same person" confirm reads the same fact (issue #1789),
   * minus the departure the seat sits on: that seat is the claim being
   * checked, so it can never be the evidence for it.
   */
  it("leaves out the departure a held seat is asking about", async () => {
    const { db, shop } = ctx;
    const person = await candidate(db, shop.id);
    const earlier = await sailedSeat(
      db,
      shop.id,
      person.id,
      "Last week",
      new Date(nowMs() - 7 * 24 * HOUR_MS),
    );
    const thisOne = await sailedSeat(
      db,
      shop.id,
      person.id,
      "This morning",
      new Date(nowMs() - 2 * HOUR_MS),
    );

    const everything = await lastDiveDaysHere(db, shop.id, [person.id]);
    const exceptThisOne = await lastDiveDaysHere(db, shop.id, [person.id], {
      exceptTripId: thisOne.id,
    });
    const onlyThisOne = await lastDiveDaysHere(db, shop.id, [person.id], {
      exceptTripId: earlier.id,
    });

    expect(everything.get(person.id)).toEqual(thisOne.startsAt);
    expect(exceptThisOne.get(person.id)).toEqual(earlier.startsAt);
    expect(onlyThisOne.get(person.id)).toEqual(thisOne.startsAt);
  });

  it("has no entry for a person whose only seat is the one being asked about", async () => {
    const { db, shop } = ctx;
    const person = await candidate(db, shop.id);
    const thisOne = await sailedSeat(
      db,
      shop.id,
      person.id,
      "This morning",
      new Date(nowMs() - 2 * HOUR_MS),
    );

    const days = await lastDiveDaysHere(db, shop.id, [person.id], { exceptTripId: thisOne.id });

    expect(days.has(person.id)).toBe(false);
  });
});
