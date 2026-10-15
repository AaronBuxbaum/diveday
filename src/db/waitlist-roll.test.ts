import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { createDiver } from "./divers";
import { courses, trips, tripWaitlistEntries } from "./schema";
import { createTrip, createTripSeries } from "./trips";
import { carryWaitlist, rollSailedSeriesWaitlists } from "./waitlist-roll";

/**
 * **The wait list rolls forward** (third UX review, item 12). Leads copy, never
 * move; each keeps the time it first asked; a diver already seated on the
 * target is left alone; and a second run adds nobody twice.
 */

const ctx = fileScopedShopContext();
const SAT = 6;

async function lead(
  db: AppDb,
  shopId: string,
  tripId: string,
  name: string,
  invitedAt?: Date,
  partySize = 1,
) {
  const person = await createDiver(db, {
    shopId,
    fullName: name,
    email: `${name.toLowerCase().replace(/\W+/g, "-")}@example.com`,
  });
  if (!person) throw new Error("diver failed");
  await db.insert(tripWaitlistEntries).values({
    shopId,
    tripId,
    personId: person.id,
    createdAt: new Date("2030-08-01T12:00:00Z"),
    invitedAt: invitedAt ?? null,
    partySize,
  });
  return person;
}

async function waiting(db: AppDb, tripId: string) {
  return db
    .select({
      personId: tripWaitlistEntries.personId,
      createdAt: tripWaitlistEntries.createdAt,
      invitedAt: tripWaitlistEntries.invitedAt,
    })
    .from(tripWaitlistEntries)
    .where(eq(tripWaitlistEntries.tripId, tripId));
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

describe("rollSailedSeriesWaitlists", () => {
  it("rolls uninvited leads onto the next date and invites them while it has seats", async () => {
    const { db, shop, first, second, now } = await saturdays();
    const ana = await lead(db, shop.id, first.id, "Ana Reyes");
    const worked = await lead(db, shop.id, first.id, "Ben Worked", new Date("2030-09-06T00:00Z"));

    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 1, invited: 1 });
    const next = await waiting(db, second.id);
    expect(next).toEqual([
      {
        personId: ana.id,
        createdAt: new Date("2030-08-01T12:00:00Z"),
        invitedAt: now,
      },
    ]);
    expect(next.map((row) => row.personId)).not.toContain(worked.id);
    // The record of what they asked for stays on the date they asked about.
    expect((await waiting(db, first.id)).map((row) => row.personId)).toContain(ana.id);

    // A second night adds nobody twice and invites nobody again.
    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 0, invited: 0 });
  });

  it("rolls a lead onto a full next date without inviting them", async () => {
    const { db, shop, first, second, now } = await saturdays(1);
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: second.id,
      fullName: "Seat Holder",
      email: "seat-holder@example.com",
    });
    if (!booked.ok) throw new Error("booking failed");
    await lead(db, shop.id, first.id, "Cara Full");

    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 1, invited: 0 });
    expect((await waiting(db, second.id))[0]?.invitedAt).toBeNull();
  });

  it("does not roll a date that has not sailed", async () => {
    const { db, shop, first } = await saturdays();
    await lead(db, shop.id, first.id, "Dan Early");
    expect(await rollSailedSeriesWaitlists(db, new Date(first.startsAt.getTime() - 1))).toEqual({
      rolled: 0,
      invited: 0,
    });
  });
});

describe("rollSailedSeriesWaitlists, measuring the next date as a seat is measured", () => {
  it("skips a next date on a conditions hold for the one after it", async () => {
    const { db, shop, first, second, now } = await saturdays();
    const third = await nextAfter(db, shop.id, second);
    await db.update(trips).set({ conditionsHold: true }).where(eq(trips.id, second.id));
    const ana = await lead(db, shop.id, first.id, "Ana Held");

    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 1, invited: 1 });
    expect(await waiting(db, second.id)).toEqual([]);
    expect((await waiting(db, third.id)).map((row) => row.personId)).toEqual([ana.id]);
  });

  // A lead asked on the public page; the invite links the public page, so a
  // date made private is never where it lands (security review r4-4, N4).
  it("skips a private next date for the one after it", async () => {
    const { db, shop, first, second, now } = await saturdays();
    const third = await nextAfter(db, shop.id, second);
    await db.update(trips).set({ isPrivate: true }).where(eq(trips.id, second.id));
    const ana = await lead(db, shop.id, first.id, "Ana Private");

    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 1, invited: 1 });
    expect(await waiting(db, second.id)).toEqual([]);
    expect((await waiting(db, third.id)).map((row) => row.personId)).toEqual([ana.id]);
  });

  it("invites nobody when the divers-only limit is reached, though the boat has room", async () => {
    const { db, shop, first, second, now } = await saturdays();
    await db.update(trips).set({ diverCapacity: 1 }).where(eq(trips.id, second.id));
    await seat(db, shop.id, second.id, "Only Diver");
    await lead(db, shop.id, first.id, "Cy Diverlimit");

    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 1, invited: 0 });
  });

  it("invites nobody onto a course date with no instructor rostered", async () => {
    const { db, shop, first, second, now } = await saturdays();
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Discover Scuba Diving")));
    if (!course) throw new Error("course missing");
    await db.update(trips).set({ courseId: course.id }).where(eq(trips.id, second.id));
    await lead(db, shop.id, first.id, "Dee Unstaffed");

    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 1, invited: 0 });
  });

  it("counts invitations already out on the next date against its open seats", async () => {
    const { db, shop, first, second, now } = await saturdays(2);
    // Invited yesterday, no seat yet: that seat is spoken for.
    await lead(db, shop.id, second.id, "Eve Invited", new Date(now.getTime() - 60_000));
    await lead(db, shop.id, first.id, "Finn Rolled");
    await lead(db, shop.id, first.id, "Gus Rolled");

    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 2, invited: 1 });
  });

  it("invites the next date's own earlier lead before a rolled one", async () => {
    const { db, shop, first, second, now } = await saturdays(1);
    const native = await createDiver(db, {
      shopId: shop.id,
      fullName: "Hana First",
      email: "hana-first@example.com",
    });
    if (!native) throw new Error("diver failed");
    // Asked about the second Saturday before the rolled lead asked about the first.
    await db.insert(tripWaitlistEntries).values({
      shopId: shop.id,
      tripId: second.id,
      personId: native.id,
      createdAt: new Date("2030-07-01T12:00:00Z"),
    });
    const rolled = await lead(db, shop.id, first.id, "Ivo Later");

    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 1, invited: 1 });
    const next = await waiting(db, second.id);
    expect(next.find((row) => row.personId === native.id)?.invitedAt).toEqual(now);
    expect(next.find((row) => row.personId === rolled.id)?.invitedAt).toBeNull();
  });
});

/**
 * **A wait-list party rolls and is invited whole** (fourth UX review, item 34):
 * a couple is one lead of two, invited only when two seats are free, and an
 * invitation out to a party holds its whole party's seats.
 */
describe("rollSailedSeriesWaitlists with a party", () => {
  it("carries the party onto the next date", async () => {
    const { db, shop, first, second, now } = await saturdays();
    await lead(db, shop.id, first.id, "Ivy Pair", undefined, 2);
    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 1, invited: 1 });
    const [rolled] = await db
      .select({ partySize: tripWaitlistEntries.partySize })
      .from(tripWaitlistEntries)
      .where(eq(tripWaitlistEntries.tripId, second.id));
    expect(rolled?.partySize).toBe(2);
  });

  it("never invites a pair onto one free seat, and lets a single behind them take it", async () => {
    const { db, shop, first, now } = await saturdays(1);
    await lead(db, shop.id, first.id, "Jo Pair", undefined, 2);
    await lead(db, shop.id, first.id, "Kai Single");
    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 2, invited: 1 });
  });

  it("counts an invited party's whole party against the open seats", async () => {
    const { db, shop, first, second, now } = await saturdays(3);
    await lead(db, shop.id, second.id, "Lu Invited", new Date(now.getTime() - 60_000), 2);
    await lead(db, shop.id, first.id, "Mo Pair", undefined, 2);
    // Three seats, two spoken for by the invited pair: one left, not two.
    expect(await rollSailedSeriesWaitlists(db, now)).toEqual({ rolled: 1, invited: 0 });
  });
});

describe("carryWaitlist", () => {
  it("copies every lead to the departure staff chose, skipping a diver already seated there", async () => {
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
    const eve = await lead(db, shop.id, first.id, "Eve Lead", new Date("2030-09-01T00:00Z"));
    const fay = await lead(db, shop.id, first.id, "Fay Seated");
    const seated = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: second.id,
      personId: fay.id,
    });
    if (!seated.ok) throw new Error("seat failed");

    expect(
      await carryWaitlist(db, {
        shopId: shop.id,
        fromTripId: first.id,
        toTripId: second.id,
        now: before,
      }),
    ).toEqual({ ok: true, carried: 1 });
    expect(await waiting(db, second.id)).toEqual([
      { personId: eve.id, createdAt: new Date("2030-08-01T12:00:00Z"), invitedAt: null },
    ]);
    // A departure that has left takes nobody.
    expect(
      await carryWaitlist(db, { shopId: shop.id, fromTripId: second.id, toTripId: first.id, now }),
    ).toEqual({ ok: false, reason: "target_unavailable" });
  });

  it("refuses this departure itself and another shop's", async () => {
    const { db, shop, first } = await saturdays();
    expect(
      await carryWaitlist(db, { shopId: shop.id, fromTripId: first.id, toTripId: first.id }),
    ).toEqual({ ok: false, reason: "target_unavailable" });
    expect(
      await carryWaitlist(db, {
        shopId: shop.id,
        fromTripId: first.id,
        toTripId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual({ ok: false, reason: "target_unavailable" });
    const rows = await db
      .select()
      .from(tripWaitlistEntries)
      .where(
        and(eq(tripWaitlistEntries.shopId, shop.id), eq(tripWaitlistEntries.tripId, first.id)),
      );
    expect(rows).toEqual([]);
  });
});
