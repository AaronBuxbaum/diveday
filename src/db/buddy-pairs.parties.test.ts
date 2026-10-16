import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { formPartyTeams, listTripBuddyTeams, planPartyTeams } from "./buddy-pairs";
import type { AppDb } from "./client";
import { bookings, certifications, courses, people } from "./schema";
import { createTrip, getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/** The Benwood reef trip, three booked divers and no teams, as `buddy-pairs.test.ts` uses it. */
async function buddyContext() {
  const { db, shop } = ctx;
  const tripRows = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = tripRows.find((row) => row.title.startsWith("Two-Tank Reef — Benwood"));
  if (!trip) throw new Error("demo Benwood trip missing");
  const [a, b, c] = await getTripRoster(db, shop.id, trip.id);
  if (!a || !b || !c) throw new Error("expected three Benwood bookings");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, trip, a, b, c, staff: staff.person };
}

describe("party teams (fifth-loop ideas, item 50)", () => {
  it("keys each seat to its party and teams a party of two once, never the diver who came alone", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    await db
      .update(bookings)
      .set({ partyLeadBookingId: a.booking.id })
      .where(eq(bookings.id, b.booking.id));

    const { parties } = await planPartyTeams(db, shop.id, trip.id);
    expect(parties.get(a.booking.id)).toBe(a.booking.id);
    expect(parties.get(b.booking.id)).toBe(a.booking.id);
    expect(parties.get(c.booking.id)).toBe(c.booking.id);

    const input = { shopId: shop.id, tripId: trip.id, recordedByPersonId: staff.id };
    expect(await formPartyTeams(db, input)).toBe(1);
    const teams = await listTripBuddyTeams(db, shop.id, trip.id);
    expect(teams).toHaveLength(1);
    expect(
      teams[0]?.members.flatMap((member) => (member.kind === "diver" ? [member.bookingId] : [])),
    ).toEqual(expect.arrayContaining([a.booking.id, b.booking.id]));
    // A second tap finds nobody left to team: the party is already a team.
    expect(await formPartyTeams(db, input)).toBe(0);
  });

  it("leaves a party of four or more for the divemaster to split", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    await db
      .update(bookings)
      .set({ partyLeadBookingId: a.booking.id })
      .where(inArray(bookings.id, [b.booking.id, c.booking.id]));
    const [extra] = await db
      .insert(bookings)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        personId: staff.id,
        status: "booked",
        bookedAs: "diver",
        partyLeadBookingId: a.booking.id,
      })
      .returning({ id: bookings.id });
    expect(extra).toBeDefined();
    expect(
      await formPartyTeams(db, { shopId: shop.id, tripId: trip.id, recordedByPersonId: staff.id }),
    ).toBe(0);
    expect(await listTripBuddyTeams(db, shop.id, trip.id)).toHaveLength(0);
    expect((await planPartyTeams(db, shop.id, trip.id)).left).toEqual([
      { bookingIds: expect.any(Array), reason: "too_large" },
    ]);
  });
});

/**
 * **Safety-critical: one tap never pairs juniors, intro divers or students
 * by themselves** (dive-domain review of layer r5-4, BLOCK 1). Each party is
 * built from scratch on its own departure, with dates of birth, the "Under 18"
 * box and verified cards set exactly, and each branch is proven through the
 * tap itself: the team either stands afterwards or it does not, and the plan
 * says why.
 */
describe("which parties one tap leaves for the divemaster", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function departure(db: AppDb, shopId: string, courseId?: string) {
    const startsAt = new Date(nowDate().getTime() + 5 * DAY);
    const trip = await createTrip(db, {
      shopId,
      title: "Party reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 20,
      plannedDives: 2,
      courseId,
    });
    if (!trip) throw new Error("departure not created");
    return trip;
  }

  /** "Born N years and a week before the departure": a whole age with no birthday edge. */
  function bornYearsBefore(startsAt: Date, years: number) {
    const date = new Date(startsAt.getTime() - 7 * DAY);
    date.setUTCFullYear(date.getUTCFullYear() - years);
    return date.toISOString().slice(0, 10);
  }

  type Member = {
    age: number | null;
    minor?: boolean;
    card?: boolean;
    type?: "diver" | "snorkeler" | "rider";
  };

  let made = 0;

  /** One party on `trip`: the first member leads, the rest name the lead. */
  async function party(
    db: AppDb,
    shopId: string,
    trip: { id: string; startsAt: Date },
    members: Member[],
  ) {
    let lead: string | null = null;
    const ids: string[] = [];
    for (const member of members) {
      made += 1;
      const [person] = await db
        .insert(people)
        .values({
          shopId,
          fullName: `Party member ${made}`,
          dateOfBirth: member.age === null ? null : bornYearsBefore(trip.startsAt, member.age),
        })
        .returning({ id: people.id });
      if (!person) throw new Error("person not created");
      if (member.card ?? true) {
        await db.insert(certifications).values({
          shopId,
          personId: person.id,
          agency: "padi",
          level: "open_water",
          identifier: `PARTY-${made}`,
          status: "verified",
        });
      }
      const type = member.type ?? "diver";
      const [seat] = await db
        .insert(bookings)
        .values({
          shopId,
          tripId: trip.id,
          personId: person.id,
          bookedAs: type,
          participantType: type,
          status: "booked",
          partyLeadBookingId: lead,
          minorDeclaredAt: member.minor ? nowDate() : null,
        })
        .returning({ id: bookings.id });
      if (!seat) throw new Error("seat not created");
      lead ??= seat.id;
      ids.push(seat.id);
    }
    return ids;
  }

  async function tap(db: AppDb, shopId: string, tripId: string) {
    const [staff] = await listStaff(db, shopId);
    if (!staff) throw new Error("demo staff missing");
    return formPartyTeams(db, { shopId, tripId, recordedByPersonId: staff.person.id });
  }

  const reasons = async (db: AppDb, shopId: string, tripId: string) =>
    (await planPartyTeams(db, shopId, tripId)).left.map((left) => left.reason);

  const adult = { age: 40 } satisfies Member;

  it("teams two certified adults", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await party(db, shop.id, trip, [adult, adult]);
    expect(await tap(db, shop.id, trip.id)).toBe(1);
  });

  it("leaves two eleven-year-olds whose parent is riding, not diving", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await party(db, shop.id, trip, [
      { age: 42, type: "rider" },
      { age: 11, minor: true },
      { age: 11, minor: true },
    ]);
    expect(await tap(db, shop.id, trip.id)).toBe(0);
    expect(await listTripBuddyTeams(db, shop.id, trip.id)).toHaveLength(0);
    expect(await reasons(db, shop.id, trip.id)).toEqual(["young_child"]);
  });

  it("leaves a ten-year-old even beside a certified parent", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await party(db, shop.id, trip, [adult, { age: 10, minor: true }]);
    expect(await tap(db, shop.id, trip.id)).toBe(0);
    expect(await reasons(db, shop.id, trip.id)).toEqual(["young_child"]);
  });

  it("teams a thirteen-year-old with a certified adult, and leaves two thirteen-year-olds", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await party(db, shop.id, trip, [adult, { age: 13, minor: true }]);
    await party(db, shop.id, trip, [
      { age: 13, minor: true },
      { age: 13, minor: true },
    ]);
    expect(await tap(db, shop.id, trip.id)).toBe(1);
    expect(await reasons(db, shop.id, trip.id)).toEqual(["junior_without_adult"]);
  });

  it("leaves a fourteen-year-old whose adult holds no verified card", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await party(db, shop.id, trip, [
      { age: 45, card: false },
      { age: 14, minor: true },
    ]);
    expect(await tap(db, shop.id, trip.id)).toBe(0);
    expect(await reasons(db, shop.id, trip.id)).toEqual(["junior_without_adult"]);
  });

  it("leaves a minor nobody wrote a date of birth for", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await party(db, shop.id, trip, [adult, { age: null, minor: true }]);
    expect(await tap(db, shop.id, trip.id)).toBe(0);
    expect(await reasons(db, shop.id, trip.id)).toEqual(["minor_age_unknown"]);
  });

  it("leaves every party on an intro (Discover Scuba) departure", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .insert(courses)
      .values({ shopId: shop.id, title: "Party DSD", slug: "party-dsd", isIntroCourse: true })
      .returning({ id: courses.id });
    if (!course) throw new Error("course not created");
    const trip = await departure(db, shop.id, course.id);
    await party(db, shop.id, trip, [
      { age: 30, card: false },
      { age: 31, card: false },
    ]);
    expect(await tap(db, shop.id, trip.id)).toBe(0);
    expect(await reasons(db, shop.id, trip.id)).toEqual(["intro_course"]);
  });

  it("leaves every party of training seats on a course departure", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .insert(courses)
      .values({ shopId: shop.id, title: "Party Open Water", slug: "party-open-water", isIntroCourse: false })
      .returning({ id: courses.id });
    if (!course) throw new Error("course not created");
    const trip = await departure(db, shop.id, course.id);
    await party(db, shop.id, trip, [adult, adult]);
    expect(await tap(db, shop.id, trip.id)).toBe(0);
    expect(await reasons(db, shop.id, trip.id)).toEqual(["training_course"]);
  });

  it("on a mixed boat, teams only the parties it may and says why it left the rest", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    const couple = await party(db, shop.id, trip, [adult, adult]);
    const family = await party(db, shop.id, trip, [adult, { age: 12, minor: true }]);
    const kids = await party(db, shop.id, trip, [
      { age: 11, minor: true },
      { age: 14, minor: true },
    ]);
    const teens = await party(db, shop.id, trip, [
      { age: 14, minor: true },
      { age: 13, minor: true },
    ]);
    const bigGroup = await party(db, shop.id, trip, [adult, adult, adult, adult]);
    const [solo] = await party(db, shop.id, trip, [adult]);

    expect(await tap(db, shop.id, trip.id)).toBe(2);
    const teamed = (await listTripBuddyTeams(db, shop.id, trip.id)).map((team) =>
      team.members.flatMap((member) => (member.kind === "diver" ? [member.bookingId] : [])).sort(),
    );
    expect(teamed.sort()).toEqual([[...couple].sort(), [...family].sort()].sort());
    const left = (await planPartyTeams(db, shop.id, trip.id)).left.map((entry) => ({
      bookingIds: [...entry.bookingIds].sort(),
      reason: entry.reason,
    }));
    expect(left).toEqual(
      expect.arrayContaining([
        { bookingIds: [...kids].sort(), reason: "young_child" },
        { bookingIds: [...teens].sort(), reason: "junior_without_adult" },
        { bookingIds: [...bigGroup].sort(), reason: "too_large" },
      ]),
    );
    expect(left).toHaveLength(3);
    expect(left.flatMap((entry) => entry.bookingIds)).not.toContain(solo);
  });
});
