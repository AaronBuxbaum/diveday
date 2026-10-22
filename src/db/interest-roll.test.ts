import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { createDiver } from "./divers";
import { carryInterests, rollSailedSeriesInterests } from "./interest-roll";
import { courses, interests, trips } from "./schema";
import { createTrip, createTripSeries } from "./trips";

/**
 * **The wait list rolls forward** (third UX review, item 12). Interests copy, never
 * move; each keeps the time it first asked; a diver already seated on the
 * target is left alone; and a second run adds nobody twice.
 */

const ctx = fileScopedShopContext();
const SAT = 6;

async function interest(
  db: AppDb,
  shopId: string,
  tripId: string,
  name: string,
  offeredAt?: Date,
  partySize = 1,
) {
  const person = await createDiver(db, {
    shopId,
    fullName: name,
    email: `${name.toLowerCase().replace(/\W+/g, "-")}@example.com`,
  });
  if (!person) throw new Error("diver failed");
  await db.insert(interests).values({
    shopId,
    tripId,
    scope: "departure",
    askedBy: "diver",
    personId: person.id,
    askedAt: new Date("2030-08-01T12:00:00Z"),
    offeredAt: offeredAt ?? null,
    partySize,
  });
  return person;
}

async function waiting(db: AppDb, tripId: string) {
  return db
    .select({
      personId: interests.personId,
      askedAt: interests.askedAt,
      offeredAt: interests.offeredAt,
    })
    .from(interests)
    .where(eq(interests.tripId, tripId));
}

async function saturdays(capacity = 12) {
  const { db, shop } = ctx;
  const result = await createTripSeries(db, {
    shopId: shop.id,
    title: "Saturday Two-Tank",
    capacity,
    plannedDives: 2,
    frequency: "weekly",
    intervalWeeks: 1,
    weekdays: weekdaySetFrom([SAT]),
    anchorDate: "2030-09-07",
    endsOn: "2030-09-21",
    timeZone: shop.timezone,
    template: {
      startsAt: new Date("2030-09-07T12:00:00.000Z"),
      endsAt: new Date("2030-09-07T16:00:00.000Z"),
    },
  });
  if (!result) throw new Error("series failed");
  const [first, second] = result.trips;
  if (!first || !second) throw new Error("expected two dates");
  // The night after the first Saturday sailed.
  const now = new Date(first.startsAt.getTime() + 12 * 60 * 60 * 1000);
  return { db, shop, first, second, now };
}

async function seat(db: AppDb, shopId: string, tripId: string, fullName: string) {
  const booked = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName,
    email: `${fullName.toLowerCase().replace(/\W+/g, "-")}@example.com`,
  });
  if (!booked.ok) throw new Error(`seating ${fullName} failed: ${booked.reason}`);
}

async function nextAfter(
  db: AppDb,
  shopId: string,
  trip: { seriesId: string | null; startsAt: Date },
) {
  const rows = await db
    .select()
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.seriesId, trip.seriesId ?? "")));
  const later = rows
    .filter((row) => row.startsAt > trip.startsAt)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  if (!later) throw new Error("expected a third date");
  return later;
}

describe("rollSailedSeriesInterests", () => {
  it("rolls uninvited interests onto the next date and invites them while it has seats", async () => {
    const { db, shop, first, second, now } = await saturdays();
    const ana = await interest(db, shop.id, first.id, "Ana Reyes");
    const worked = await interest(db, shop.id, first.id, "Ben Worked", new Date("2030-09-06T00:00Z"));

    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 1, invited: 1 });
    const next = await waiting(db, second.id);
    expect(next).toEqual([
      {
        personId: ana.id,
        askedAt: new Date("2030-08-01T12:00:00Z"),
        offeredAt: now,
      },
    ]);
    expect(next.map((row) => row.personId)).not.toContain(worked.id);
    // The record of what they asked for stays on the date they asked about.
    expect((await waiting(db, first.id)).map((row) => row.personId)).toContain(ana.id);

    // A second night adds nobody twice and invites nobody again.
    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 0, invited: 0 });
  });

  it("rolls an interest onto a full next date without inviting them", async () => {
    const { db, shop, first, second, now } = await saturdays(1);
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: second.id,
      fullName: "Seat Holder",
      email: "seat-holder@example.com",
    });
    if (!booked.ok) throw new Error("booking failed");
    await interest(db, shop.id, first.id, "Cara Full");

    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 1, invited: 0 });
    expect((await waiting(db, second.id))[0]?.offeredAt).toBeNull();
  });

  it("does not roll a date that has not sailed", async () => {
    const { db, shop, first } = await saturdays();
    await interest(db, shop.id, first.id, "Dan Early");
    expect(await rollSailedSeriesInterests(db, new Date(first.startsAt.getTime() - 1))).toEqual({
      rolled: 0,
      invited: 0,
    });
  });
});

describe("rollSailedSeriesInterests, measuring the next date as a seat is measured", () => {
  it("skips a next date on a conditions hold for the one after it", async () => {
    const { db, shop, first, second, now } = await saturdays();
    const third = await nextAfter(db, shop.id, second);
    await db.update(trips).set({ conditionsHold: true }).where(eq(trips.id, second.id));
    const ana = await interest(db, shop.id, first.id, "Ana Held");

    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 1, invited: 1 });
    expect(await waiting(db, second.id)).toEqual([]);
    expect((await waiting(db, third.id)).map((row) => row.personId)).toEqual([ana.id]);
  });

  // An interest asked on the public page; the invite links the public page, so a
  // date made private is never where it lands (security review r4-4, N4).
  it("skips a private next date for the one after it", async () => {
    const { db, shop, first, second, now } = await saturdays();
    const third = await nextAfter(db, shop.id, second);
    await db.update(trips).set({ isPrivate: true }).where(eq(trips.id, second.id));
    const ana = await interest(db, shop.id, first.id, "Ana Private");

    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 1, invited: 1 });
    expect(await waiting(db, second.id)).toEqual([]);
    expect((await waiting(db, third.id)).map((row) => row.personId)).toEqual([ana.id]);
  });

  it("invites nobody when the divers-only limit is reached, though the boat has room", async () => {
    const { db, shop, first, second, now } = await saturdays();
    await db.update(trips).set({ diverCapacity: 1 }).where(eq(trips.id, second.id));
    await seat(db, shop.id, second.id, "Only Diver");
    await interest(db, shop.id, first.id, "Cy Diverlimit");

    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 1, invited: 0 });
  });

  it("invites nobody onto a course date with no instructor rostered", async () => {
    const { db, shop, first, second, now } = await saturdays();
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Discover Scuba Diving")));
    if (!course) throw new Error("course missing");
    await db.update(trips).set({ courseId: course.id }).where(eq(trips.id, second.id));
    await interest(db, shop.id, first.id, "Dee Unstaffed");

    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 1, invited: 0 });
  });

  it("counts invitations already out on the next date against its open seats", async () => {
    const { db, shop, first, second, now } = await saturdays(2);
    // Invited yesterday, no seat yet: that seat is spoken for.
    await interest(db, shop.id, second.id, "Eve Invited", new Date(now.getTime() - 60_000));
    await interest(db, shop.id, first.id, "Finn Rolled");
    await interest(db, shop.id, first.id, "Gus Rolled");

    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 2, invited: 1 });
  });

  it("invites the next date's own earlier interest before a rolled one", async () => {
    const { db, shop, first, second, now } = await saturdays(1);
    const native = await createDiver(db, {
      shopId: shop.id,
      fullName: "Hana First",
      email: "hana-first@example.com",
    });
    if (!native) throw new Error("diver failed");
    // Asked about the second Saturday before the rolled interest asked about the first.
    await db.insert(interests).values({
      shopId: shop.id,
      tripId: second.id,
      scope: "departure",
      askedBy: "diver",
      personId: native.id,
      partySize: 1,
      askedAt: new Date("2030-07-01T12:00:00Z"),
    });
    const rolled = await interest(db, shop.id, first.id, "Ivo Later");

    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 1, invited: 1 });
    const next = await waiting(db, second.id);
    expect(next.find((row) => row.personId === native.id)?.offeredAt).toEqual(now);
    expect(next.find((row) => row.personId === rolled.id)?.offeredAt).toBeNull();
  });
});

/**
 * **A date request attached to a departure never rolls** (dive-domain review of
 * #2656, M1). On main only the wait list rolled; a request the builder attached
 * was a contact the shop works by hand, and the roll would otherwise email an
 * uncertified asker a seat on an AOW boat in the shop's name.
 */
describe("rollSailedSeriesInterests and attached date requests", () => {
  async function dateRequest(db: AppDb, shopId: string, email: string) {
    const [parent] = await db
      .insert(interests)
      .values({ shopId, scope: "date", askedBy: "diver", interest: "reef", email })
      .returning({ id: interests.id });
    if (!parent) throw new Error("date interest insert failed");
    return parent.id;
  }

  it("neither copies nor invites a date-parented child on a sailed date, linked or not", async () => {
    const { db, shop, first, second, now } = await saturdays();
    const maria = await createDiver(db, {
      shopId: shop.id,
      fullName: "Maria Never",
      email: "maria-never@example.com",
    });
    if (!maria) throw new Error("diver failed");
    // A child that carries a person (as the first cut of the redesign wrote
    // them) and a person-less one: neither is a wait-list row.
    await db.insert(interests).values([
      {
        shopId: shop.id,
        tripId: first.id,
        scope: "departure",
        askedBy: "diver",
        personId: maria.id,
        parentInterestId: await dateRequest(db, shop.id, "maria-never@example.com"),
        partySize: 1,
      },
      {
        shopId: shop.id,
        tripId: first.id,
        scope: "departure",
        askedBy: "diver",
        name: "Stranger Sam",
        email: "sam@example.com",
        parentInterestId: await dateRequest(db, shop.id, "sam@example.com"),
        partySize: 1,
      },
    ]);

    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 0, invited: 0 });
    expect(await waiting(db, second.id)).toEqual([]);
  });

  it("does not auto-invite a date request attached to the next date", async () => {
    const { db, shop, first, second, now } = await saturdays();
    await db.insert(interests).values({
      shopId: shop.id,
      tripId: second.id,
      scope: "departure",
      askedBy: "diver",
      name: "Stranger Sam",
      email: "sam@example.com",
      parentInterestId: await dateRequest(db, shop.id, "sam@example.com"),
      partySize: 1,
      askedAt: new Date("2030-07-01T12:00:00Z"),
    });
    const ana = await interest(db, shop.id, first.id, "Ana Rolls");

    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 1, invited: 1 });
    const next = await waiting(db, second.id);
    expect(next.find((row) => row.personId === ana.id)?.offeredAt).toEqual(now);
    expect(next.find((row) => row.personId === null)?.offeredAt).toBeNull();
  });
});

/**
 * **A wait-list party rolls and is invited whole** (fourth UX review, item 34):
 * a couple is one interest of two, invited only when two seats are free, and an
 * invitation out to a party holds its whole party's seats.
 */
describe("rollSailedSeriesInterests with a party", () => {
  it("carries the party onto the next date", async () => {
    const { db, shop, first, second, now } = await saturdays();
    await interest(db, shop.id, first.id, "Ivy Pair", undefined, 2);
    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 1, invited: 1 });
    const [rolled] = await db
      .select({ partySize: interests.partySize })
      .from(interests)
      .where(eq(interests.tripId, second.id));
    expect(rolled?.partySize).toBe(2);
  });

  it("never invites a pair onto one free seat, and lets a single behind them take it", async () => {
    const { db, shop, first, now } = await saturdays(1);
    await interest(db, shop.id, first.id, "Jo Pair", undefined, 2);
    await interest(db, shop.id, first.id, "Kai Single");
    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 2, invited: 1 });
  });

  it("counts an invited party's whole party against the open seats", async () => {
    const { db, shop, first, second, now } = await saturdays(3);
    await interest(db, shop.id, second.id, "Lu Invited", new Date(now.getTime() - 60_000), 2);
    await interest(db, shop.id, first.id, "Mo Pair", undefined, 2);
    // Three seats, two spoken for by the invited pair: one left, not two.
    expect(await rollSailedSeriesInterests(db, now)).toEqual({ rolled: 1, invited: 0 });
  });
});

describe("carryInterests", () => {
  it("copies every interest to the departure staff chose, skipping a diver already seated there", async () => {
    const { db, shop, first, now } = await saturdays();
    const second = await createTrip(db, {
      shopId: shop.id,
      title: "Saturday Two-Tank — second boat",
      startsAt: first.startsAt,
      endsAt: first.endsAt,
      capacity: 8,
      plannedDives: 2,
    });
    if (!second) throw new Error("second departure failed");
    const before = new Date(first.startsAt.getTime() - 24 * 60 * 60 * 1000);
    const eve = await interest(db, shop.id, first.id, "Eve Interest", new Date("2030-09-01T00:00Z"));
    const fay = await interest(db, shop.id, first.id, "Fay Seated");
    const seated = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: second.id,
      personId: fay.id,
    });
    if (!seated.ok) throw new Error("seat failed");

    expect(
      await carryInterests(db, {
        shopId: shop.id,
        fromTripId: first.id,
        toTripId: second.id,
        now: before,
      }),
    ).toEqual({ ok: true, carried: 1 });
    expect(await waiting(db, second.id)).toEqual([
      { personId: eve.id, askedAt: new Date("2030-08-01T12:00:00Z"), offeredAt: null },
    ]);
    // The copy remembers the row it came from.
    const [copy] = await db
      .select({ parentInterestId: interests.parentInterestId })
      .from(interests)
      .where(and(eq(interests.tripId, second.id), eq(interests.personId, eve.id)));
    const [origin] = await db
      .select({ id: interests.id })
      .from(interests)
      .where(and(eq(interests.tripId, first.id), eq(interests.personId, eve.id)));
    expect(copy?.parentInterestId).toBe(origin?.id);
    // A departure that has left takes nobody.
    expect(
      await carryInterests(db, { shopId: shop.id, fromTripId: second.id, toTripId: first.id, now }),
    ).toEqual({ ok: false, reason: "target_unavailable" });
  });

  it("refuses this departure itself and another shop's", async () => {
    const { db, shop, first } = await saturdays();
    expect(
      await carryInterests(db, { shopId: shop.id, fromTripId: first.id, toTripId: first.id }),
    ).toEqual({ ok: false, reason: "target_unavailable" });
    expect(
      await carryInterests(db, {
        shopId: shop.id,
        fromTripId: first.id,
        toTripId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual({ ok: false, reason: "target_unavailable" });
    const rows = await db
      .select()
      .from(interests)
      .where(and(eq(interests.shopId, shop.id), eq(interests.tripId, first.id)));
    expect(rows).toEqual([]);
  });
});
