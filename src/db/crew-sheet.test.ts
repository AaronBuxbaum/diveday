// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assembleCrewSheet } from "@/lib/crew-sheet";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { crewSheetForMonth } from "./crew-sheet";
import { bookings, people, shops, tips, tripAssignments, tripScheduleDays, trips } from "./schema";

/**
 * The crew sheet's reader (N-43).
 *
 * Built on a bare shop rather than the demo seed on purpose: every number here
 * is an exact one, and the seed's 48 departures would turn each assertion into
 * a moving target.
 */

/**
 * **A shop behind UTC**, which is where the month-boundary bug lives.
 * Los Angeles is UTC-7 in July, so a departure at 23:00 on the 31st is
 * 06:00Z on 1 August — inside the shop's July and outside a UTC one.
 */
const ZONE = "America/Los_Angeles";
const JULY = { year: 2026, month: 7 };

async function bareShop(db: AppDb) {
  const [shop] = await db
    .insert(shops)
    .values({ name: "Bare Reef", slug: `crew-sheet-${randomUUID()}`, timezone: ZONE })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  return shop;
}

async function crewMember(db: AppDb, shopId: string, fullName: string) {
  const [person] = await db.insert(people).values({ shopId, fullName }).returning();
  if (!person) throw new Error("person insert failed");
  return person;
}

async function departure(
  db: AppDb,
  shopId: string,
  input: { title: string; startsAt: string; hours: number; deletedAt?: Date; cancelled?: boolean },
) {
  const startsAt = new Date(input.startsAt);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title: input.title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + input.hours * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
      deletedAt: input.deletedAt ?? null,
      ...(input.cancelled ? { status: "cancelled" as const, cancelledAt: startsAt } : {}),
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  return trip;
}

async function tipOn(
  db: AppDb,
  shopId: string,
  tripId: string,
  amountCents: number,
  status = "paid",
) {
  const person = await crewMember(db, shopId, "Tipping Diver");
  const [booking] = await db
    .insert(bookings)
    .values({ shopId, tripId, personId: person.id })
    .returning();
  if (!booking) throw new Error("booking insert failed");
  await db.insert(tips).values({
    shopId,
    bookingId: booking.id,
    status: status as "paid" | "pending" | "expired",
    stripeAccountId: "acct_test",
    stripeSessionId: `cs_${randomUUID()}`,
    currency: "usd",
    amountCents,
  });
}

describe("crewSheetForMonth", () => {
  it("reports each crew member's departures, job, hours and tips for the month", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const ana = await crewMember(db, shop.id, "Ana Reyes");
    const ben = await crewMember(db, shop.id, "Ben Okafor");

    const morning = await departure(db, shop.id, {
      title: "Two-tank reef",
      startsAt: "2026-07-08T15:00:00Z", // 08:00 local
      hours: 4,
    });
    const afternoon = await departure(db, shop.id, {
      title: "Wreck",
      startsAt: "2026-07-09T20:00:00Z", // 13:00 local
      hours: 3,
    });
    await db.insert(tripAssignments).values([
      { tripId: morning.id, personId: ana.id, tripRole: "divemaster" },
      { tripId: morning.id, personId: ben.id, tripRole: "captain" },
      { tripId: afternoon.id, personId: ana.id, tripRole: "instructor" },
    ]);
    await tipOn(db, shop.id, morning.id, 6000);

    const rows = assembleCrewSheet(await crewSheetForMonth(db, shop.id, ZONE, JULY));
    expect(rows.map((row) => row.personName)).toEqual(["Ana Reyes", "Ben Okafor"]);
    expect(rows[0]).toMatchObject({
      departures: 2,
      minutes: 7 * 60,
      roles: ["instructor", "divemaster"],
      tipsCents: 3000,
    });
    expect(rows[1]).toMatchObject({
      departures: 1,
      minutes: 4 * 60,
      roles: ["captain"],
      tipsCents: 3000,
    });
  });

  /**
   * **The bug this feature is shaped to have.** A month is a wall-clock date
   * range in the shop's own zone, not a UTC instant range. Bracket it in UTC
   * and the 31st's sunset charter falls out of July while the 30th-of-June
   * night dive falls into it — and both sheets still add up, so nobody ever
   * notices which month a departure landed in.
   */
  it("brackets the month in the shop's own zone, not in UTC", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const ana = await crewMember(db, shop.id, "Ana Reyes");

    // 23:00 on 31 July in Los Angeles — already 1 August in UTC.
    const lastNight = await departure(db, shop.id, {
      title: "July's last night dive",
      startsAt: "2026-08-01T06:00:00Z",
      hours: 2,
    });
    // 23:00 on 30 June in Los Angeles — already 1 July in UTC.
    const juneNight = await departure(db, shop.id, {
      title: "June's last night dive",
      startsAt: "2026-07-01T06:00:00Z",
      hours: 2,
    });
    // 00:30 on 1 July in Los Angeles, comfortably inside the shop's July.
    const julyFirst = await departure(db, shop.id, {
      title: "July's first boat",
      startsAt: "2026-07-01T07:30:00Z",
      hours: 2,
    });
    await db.insert(tripAssignments).values([
      { tripId: lastNight.id, personId: ana.id, tripRole: "divemaster" },
      { tripId: juneNight.id, personId: ana.id, tripRole: "divemaster" },
      { tripId: julyFirst.id, personId: ana.id, tripRole: "divemaster" },
    ]);
    await tipOn(db, shop.id, lastNight.id, 5000);
    await tipOn(db, shop.id, juneNight.id, 9900);

    const july = await crewSheetForMonth(db, shop.id, ZONE, JULY);
    expect(july.assignments.map((row) => row.tripId).sort()).toEqual(
      [lastNight.id, julyFirst.id].sort(),
    );
    // June's tip belongs to June's sheet, even though its instant is in July.
    expect(july.tips).toEqual([{ tripId: lastNight.id, amountCents: 5000 }]);

    const june = await crewSheetForMonth(db, shop.id, ZONE, { year: 2026, month: 6 });
    expect(june.assignments.map((row) => row.tripId)).toEqual([juneNight.id]);
    expect(june.tips).toEqual([{ tripId: juneNight.id, amountCents: 9900 }]);

    // Nothing is counted twice and nothing falls between the two sheets.
    expect(assembleCrewSheet(july)[0]?.departures).toBe(2);
    expect(assembleCrewSheet(june)[0]?.departures).toBe(1);
  });

  it("rolls a December month into the next year", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const ana = await crewMember(db, shop.id, "Ana Reyes");
    // 23:00 on 31 December in Los Angeles — 1 January in UTC.
    const newYearsEve = await departure(db, shop.id, {
      title: "New Year's Eve night dive",
      startsAt: "2027-01-01T07:00:00Z",
      hours: 2,
    });
    await db
      .insert(tripAssignments)
      .values([{ tripId: newYearsEve.id, personId: ana.id, tripRole: "divemaster" }]);

    const december = await crewSheetForMonth(db, shop.id, ZONE, { year: 2026, month: 12 });
    expect(december.assignments.map((row) => row.tripId)).toEqual([newYearsEve.id]);
    const january = await crewSheetForMonth(db, shop.id, ZONE, { year: 2027, month: 1 });
    expect(january.assignments).toEqual([]);
  });

  it("prints no line for a crew member who worked no departures that month", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const ana = await crewMember(db, shop.id, "Ana Reyes");
    await crewMember(db, shop.id, "Off-roster Cleo");
    const trip = await departure(db, shop.id, {
      title: "Two-tank reef",
      startsAt: "2026-07-08T15:00:00Z",
      hours: 4,
    });
    await db.insert(tripAssignments).values([{ tripId: trip.id, personId: ana.id }]);

    const rows = assembleCrewSheet(await crewSheetForMonth(db, shop.id, ZONE, JULY));
    expect(rows.map((row) => row.personName)).toEqual(["Ana Reyes"]);
    // No job was named on the sailing, which the sheet says rather than guessing.
    expect(rows[0]?.roles).toEqual([]);
    expect(rows[0]?.roleUnspecified).toBe(true);
  });

  it("gives a departure that took no tips a zero", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const ana = await crewMember(db, shop.id, "Ana Reyes");
    const trip = await departure(db, shop.id, {
      title: "Two-tank reef",
      startsAt: "2026-07-08T15:00:00Z",
      hours: 4,
    });
    await db.insert(tripAssignments).values([{ tripId: trip.id, personId: ana.id }]);

    const input = await crewSheetForMonth(db, shop.id, ZONE, JULY);
    expect(input.tips).toEqual([]);
    expect(assembleCrewSheet(input)[0]).toMatchObject({ departures: 1, tipsCents: 0 });
  });

  it("counts only money the shop actually has", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const ana = await crewMember(db, shop.id, "Ana Reyes");
    const trip = await departure(db, shop.id, {
      title: "Two-tank reef",
      startsAt: "2026-07-08T15:00:00Z",
      hours: 4,
    });
    await db.insert(tripAssignments).values([{ tripId: trip.id, personId: ana.id }]);
    await tipOn(db, shop.id, trip.id, 4000, "paid");
    await tipOn(db, shop.id, trip.id, 9900, "pending");
    await tipOn(db, shop.id, trip.id, 7700, "expired");

    const input = await crewSheetForMonth(db, shop.id, ZONE, JULY);
    expect(input.tips).toEqual([{ tripId: trip.id, amountCents: 4000 }]);
  });

  it("leaves a cancelled or deleted departure off the sheet", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const ana = await crewMember(db, shop.id, "Ana Reyes");
    const blownOut = await departure(db, shop.id, {
      title: "Blown out",
      startsAt: "2026-07-08T15:00:00Z",
      hours: 4,
      cancelled: true,
    });
    const deleted = await departure(db, shop.id, {
      title: "Never happened",
      startsAt: "2026-07-09T15:00:00Z",
      hours: 4,
      deletedAt: new Date("2026-07-01T00:00:00Z"),
    });
    await db.insert(tripAssignments).values([
      { tripId: blownOut.id, personId: ana.id, tripRole: "divemaster" },
      { tripId: deleted.id, personId: ana.id, tripRole: "divemaster" },
    ]);
    await tipOn(db, shop.id, blownOut.id, 5000);

    const input = await crewSheetForMonth(db, shop.id, ZONE, JULY);
    expect(input.assignments).toEqual([]);
    expect(input.tips).toEqual([]);
  });

  /**
   * A three-day course is three working days, not the seventy-two hours
   * `ends_at - starts_at` would claim — the difference between a plausible
   * sheet and a nonsensical one.
   */
  it("counts a multi-day course as its own scheduled days, not wall-to-wall", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const ana = await crewMember(db, shop.id, "Ana Reyes");
    const course = await departure(db, shop.id, {
      title: "Open Water — three-day course",
      startsAt: "2026-07-10T15:00:00Z",
      hours: 72,
    });
    await db.insert(tripScheduleDays).values([
      {
        tripId: course.id,
        dayNumber: 1,
        startsAt: new Date("2026-07-10T15:00:00Z"),
        endsAt: new Date("2026-07-10T21:00:00Z"),
      },
      {
        tripId: course.id,
        dayNumber: 2,
        startsAt: new Date("2026-07-11T15:00:00Z"),
        endsAt: new Date("2026-07-11T20:00:00Z"),
      },
      {
        tripId: course.id,
        dayNumber: 3,
        startsAt: new Date("2026-07-12T15:00:00Z"),
        endsAt: new Date("2026-07-12T19:00:00Z"),
      },
    ]);
    await db
      .insert(tripAssignments)
      .values([{ tripId: course.id, personId: ana.id, tripRole: "instructor" }]);

    const rows = assembleCrewSheet(await crewSheetForMonth(db, shop.id, ZONE, JULY));
    expect(rows[0]).toMatchObject({ departures: 1, minutes: 15 * 60 });
  });

  it("drops an assignment naming a person who belongs to another shop", async () => {
    // Defense in depth: the trip is this shop's, but the person is not. A
    // reader that trusts the assignment row would put a rival's crew member,
    // by name, on this shop's sheet.
    const db = await unseededTestDb();
    const mine = await bareShop(db);
    const theirs = await bareShop(db);
    const ana = await crewMember(db, mine.id, "Ana Reyes");
    const rival = await crewMember(db, theirs.id, "Rival Crew");
    const trip = await departure(db, mine.id, {
      title: "Two-tank reef",
      startsAt: "2026-07-08T15:00:00Z",
      hours: 4,
    });
    await db.insert(tripAssignments).values([
      { tripId: trip.id, personId: ana.id },
      { tripId: trip.id, personId: rival.id },
    ]);

    const input = await crewSheetForMonth(db, mine.id, ZONE, JULY);
    expect(input.assignments.map((row) => row.personName)).toEqual(["Ana Reyes"]);
  });

  it("never reads another shop's crew or tips", async () => {
    const db = await unseededTestDb();
    const mine = await bareShop(db);
    const theirs = await bareShop(db);
    const ana = await crewMember(db, mine.id, "Ana Reyes");
    const rival = await crewMember(db, theirs.id, "Rival Crew");
    const myTrip = await departure(db, mine.id, {
      title: "Mine",
      startsAt: "2026-07-08T15:00:00Z",
      hours: 4,
    });
    const theirTrip = await departure(db, theirs.id, {
      title: "Theirs",
      startsAt: "2026-07-08T15:00:00Z",
      hours: 4,
    });
    await db.insert(tripAssignments).values([
      { tripId: myTrip.id, personId: ana.id },
      { tripId: theirTrip.id, personId: rival.id },
    ]);
    await tipOn(db, theirs.id, theirTrip.id, 8800);

    const input = await crewSheetForMonth(db, mine.id, ZONE, JULY);
    expect(input.assignments.map((row) => row.personName)).toEqual(["Ana Reyes"]);
    expect(input.tips).toEqual([]);
  });
});
