import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { diveSiteSlugFrom } from "@/lib/dive-site-slug";
import { summarizeShopYear } from "@/lib/shop-year";
import { unseededTestDb } from "@/test/db";
import { weatherCallsInWindow } from "./blowouts";
import type { AppDb } from "./client";
import {
  bookingLeadTimes,
  certifiedHere,
  crewYearFacts,
  getMonthlyReport,
  getShopYear,
} from "./reporting";
import {
  boats,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  certifications,
  courses,
  diveSites,
  people,
  shops,
  tripAssignments,
  tripBlowoutDivers,
  tripBlowouts,
  tripDives,
  tripLenses,
  trips,
} from "./schema";

/**
 * The owner's numbers (fifth loop, items 26, 32, 34 and section 6): the reads
 * Reports gained beside `getMonthlyReport` and `getShopYear`, each over an
 * unseeded database so every row is the test's own.
 */

const TZ = "America/New_York";

async function shopRow(db: AppDb, slug: string): Promise<string> {
  const [row] = await db.insert(shops).values({ name: slug, slug, timezone: TZ }).returning();
  if (!row) throw new Error("shop insert failed");
  return row.id;
}

async function person(db: AppDb, shopId: string, fullName: string): Promise<string> {
  const [row] = await db.insert(people).values({ shopId, fullName }).returning();
  if (!row) throw new Error("person insert failed");
  return row.id;
}

async function trip(
  db: AppDb,
  shopId: string,
  startsAt: string,
  values: Partial<typeof trips.$inferInsert> = {},
): Promise<string> {
  const start = new Date(startsAt);
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Trip",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3 * 3_600_000),
      capacity: 10,
      ...values,
    })
    .returning();
  if (!row) throw new Error("trip insert failed");
  return row.id;
}

async function booking(
  db: AppDb,
  shopId: string,
  tripId: string,
  status: "booked" | "cancelled" = "booked",
): Promise<string> {
  const personId = await person(db, shopId, `Diver ${Math.random()}`);
  const [row] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId, tripId, personId, status })
    .returning();
  if (!row) throw new Error("booking insert failed");
  return row.id;
}

async function paid(db: AppDb, shopId: string, bookingId: string, amountCents: number) {
  await db
    .insert(bookingPayments)
    .values({ shopId, bookingId, status: "paid", amountCents, currency: "usd" });
}

describe("each departure's net (item 26)", () => {
  it("carries what each departure took, after tax, and the hull and kind it sailed as", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "net-by-departure");
    const [boat] = await db
      .insert(boats)
      .values({ shopId, name: "Mantis I", capacity: 12 })
      .returning();
    const [lens] = await db
      .insert(tripLenses)
      .values({ shopId, name: "Wreck", slug: "wreck" })
      .returning();
    if (!boat || !lens) throw new Error("fixture insert failed");
    const wreck = await trip(db, shopId, "2026-06-10T13:00:00Z", {
      title: "Wreck",
      boatId: boat.id,
      lensId: lens.id,
    });
    const reef = await trip(db, shopId, "2026-06-11T13:00:00Z", { title: "Reef" });
    await paid(db, shopId, await booking(db, shopId, wreck), 18_000);
    await paid(db, shopId, await booking(db, shopId, wreck), 12_000);
    // A taxed checkout: the departure's net leaves the tax out, as the month does.
    const taxed = await booking(db, shopId, reef);
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId,
        tripId: reef,
        status: "completed",
        stripeAccountId: "acct_net",
        stripeSessionId: "cs_net",
        currency: "usd",
        amountPerDiverCents: 10_000,
        totalCents: 10_000,
        taxEnabled: true,
        taxCents: 1_000,
        settledTotalCents: 11_000,
      })
      .returning();
    if (!checkout) throw new Error("checkout insert failed");
    await db.insert(bookingCheckoutBookings).values({
      shopId,
      checkoutId: checkout.id,
      bookingId: taxed,
      tripCents: 10_000,
      taxCents: 1_000,
    });
    await db.insert(bookingPayments).values({
      shopId,
      bookingId: taxed,
      status: "paid",
      amountCents: 11_000,
      currency: "usd",
      provider: "stripe",
      providerRef: "cs_net",
    });

    const report = await getMonthlyReport(
      db,
      shopId,
      new Date("2026-06-01T04:00:00Z"),
      new Date("2026-07-01T04:00:00Z"),
    );

    expect(report.revenueCents).toBe(40_000);
    expect(report.trips.find((row) => row.title === "Wreck")).toMatchObject({
      netCents: 30_000,
      boatName: "Mantis I",
      kindName: "Wreck",
      isCourse: false,
    });
    expect(report.trips.find((row) => row.title === "Reef")).toMatchObject({
      netCents: 10_000,
      boatName: null,
      kindName: null,
    });
    const sum = report.trips.reduce((total, row) => total + (row.netCents ?? 0), 0);
    expect(sum).toBe(report.revenueCents);
  });
});

describe("the staff year's sites (section 6)", () => {
  it("counts each planned dive's site once per departure that dives it", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "year-departure-sites");
    const [benwood, duane] = await db
      .insert(diveSites)
      .values([
        { shopId, name: "Benwood", slug: diveSiteSlugFrom("Benwood") },
        { shopId, name: "Duane", slug: diveSiteSlugFrom("Duane") },
      ])
      .returning();
    if (!benwood || !duane) throw new Error("site insert failed");
    const firstBenwood = await trip(db, shopId, "2026-05-01T13:00:00Z");
    const secondBenwood = await trip(db, shopId, "2026-05-08T13:00:00Z");
    const planned = await trip(db, shopId, "2026-05-09T13:00:00Z");
    await db.insert(tripDives).values([
      { tripId: firstBenwood, diveNumber: 1, diveSiteId: benwood.id },
      { tripId: secondBenwood, diveNumber: 1, diveSiteId: benwood.id },
      { tripId: planned, diveNumber: 1, diveSiteId: duane.id },
    ]);

    const year = summarizeShopYear(
      await getShopYear(db, shopId, {
        timeZone: TZ,
        now: new Date("2026-08-27T16:00:00Z"),
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
      }),
    );

    expect(year.sites.map((site) => [site.name, site.times])).toEqual([
      ["Benwood", 2],
      ["Duane", 1],
    ]);
    expect(year.siteCount).toBe(2);
  });
});

describe("bookingLeadTimes (item 34)", () => {
  it("joins each held seat's booking time to its departure, by the departure's weekday", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "lead-time");
    // Saturday 2026-06-13, 09:00 New York.
    const saturday = await trip(db, shopId, "2026-06-13T13:00:00Z");
    for (const daysAhead of [12, 12, 10, 1, 0]) {
      const bookingId = await booking(db, shopId, saturday);
      await db
        .update(bookings)
        .set({ createdAt: new Date(Date.parse("2026-06-13T12:00:00Z") - daysAhead * 86_400_000) })
        .where(eq(bookings.id, bookingId));
    }
    // A cancelled seat is not a sale.
    await booking(db, shopId, saturday, "cancelled");

    const rows = await bookingLeadTimes(db, shopId, {
      startUtc: new Date("2026-06-01T00:00:00Z"),
      endUtc: new Date("2026-07-01T00:00:00Z"),
      timeZone: TZ,
    });

    expect(rows).toEqual([{ isoWeekday: 6, seats: 5, medianDays: 10, lastThreeDaysShare: 0.4 }]);
  });

  it("reads boats only, never a shore day, a pool session or a course session (dive-domain review F6)", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "lead-time-boats");
    const [course] = await db
      .insert(courses)
      .values({ shopId, title: "Open Water", slug: "open-water" })
      .returning();
    if (!course) throw new Error("course insert failed");
    const saturday = "2026-06-13T13:00:00Z";
    const boat = await trip(db, shopId, saturday);
    const others = [
      await trip(db, shopId, saturday, { diveMode: "shore" }),
      await trip(db, shopId, saturday, { diveMode: "pool" }),
      await trip(db, shopId, saturday, { courseId: course.id }),
    ];
    for (const tripId of [boat, ...others]) {
      const bookingId = await booking(db, shopId, tripId);
      await db
        .update(bookings)
        .set({ createdAt: new Date("2026-05-13T12:00:00Z") })
        .where(eq(bookings.id, bookingId));
    }
    const rows = await bookingLeadTimes(db, shopId, {
      startUtc: new Date("2026-06-01T00:00:00Z"),
      endUtc: new Date("2026-07-01T00:00:00Z"),
      timeZone: TZ,
    });
    expect(rows).toEqual([{ isoWeekday: 6, seats: 1, medianDays: 31, lastThreeDaysShare: 0 }]);
  });

  it("counts calendar days in the shop's zone, so the night before is a day ahead (review N2)", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "lead-time-night");
    // Sunday 2026-06-14, 08:00 New York; booked Saturday at 18:00 New York.
    const sunday = await trip(db, shopId, "2026-06-14T12:00:00Z");
    const bookingId = await booking(db, shopId, sunday);
    await db
      .update(bookings)
      .set({ createdAt: new Date("2026-06-13T22:00:00Z") })
      .where(eq(bookings.id, bookingId));
    const rows = await bookingLeadTimes(db, shopId, {
      startUtc: new Date("2026-06-01T00:00:00Z"),
      endUtc: new Date("2026-07-01T00:00:00Z"),
      timeZone: TZ,
    });
    expect(rows).toEqual([{ isoWeekday: 7, seats: 1, medianDays: 1, lastThreeDaysShare: 1 }]);
  });
});

describe("certifiedHere and crewYearFacts (item 32)", () => {
  it("counts the cards this shop issued by level and by instructor, with days at sea", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "certified-here");
    const marcus = await person(db, shopId, "Marcus Webb");
    const issue = async (
      level: "open_water" | "advanced_open_water",
      at: string,
      deleted = false,
    ) =>
      db.insert(certifications).values({
        shopId,
        personId: await person(db, shopId, `Student ${level} ${at}`),
        agency: "padi",
        level,
        status: "verified",
        issuedByShopAt: new Date(at),
        issuedByPersonId: marcus,
        deletedAt: deleted ? new Date(at) : null,
      });
    await issue("open_water", "2026-03-01T15:00:00Z");
    await issue("open_water", "2026-04-01T15:00:00Z");
    await issue("advanced_open_water", "2026-05-01T15:00:00Z");
    // Taken back, and last year's: neither counts.
    await issue("open_water", "2026-05-02T15:00:00Z", true);
    await issue("open_water", "2025-12-01T15:00:00Z");
    // A card someone else issued, captured rather than issued here.
    await db.insert(certifications).values({
      shopId,
      personId: await person(db, shopId, "Walk-in"),
      agency: "padi",
      level: "rescue",
      status: "verified",
      identifier: "R-1",
    });

    expect(
      await certifiedHere(db, shopId, {
        startUtc: new Date("2026-01-01T05:00:00Z"),
        endUtc: new Date("2027-01-01T05:00:00Z"),
      }),
    ).toEqual({
      total: 3,
      byLevel: [
        { level: "open_water", count: 2 },
        { level: "advanced_open_water", count: 1 },
      ],
    });

    const morning = await trip(db, shopId, "2026-06-01T13:00:00Z");
    const night = await trip(db, shopId, "2026-06-01T23:00:00Z");
    const later = await trip(db, shopId, "2026-06-03T13:00:00Z");
    const cancelled = await trip(db, shopId, "2026-06-05T13:00:00Z", { status: "cancelled" });
    // A pool session is a day on the schedule, not at sea (dive-domain review N1).
    const pool = await trip(db, shopId, "2026-06-07T13:00:00Z", { diveMode: "pool" });
    await db.insert(tripAssignments).values([
      { tripId: morning, personId: marcus },
      { tripId: night, personId: marcus },
      { tripId: later, personId: marcus },
      { tripId: cancelled, personId: marcus },
      { tripId: pool, personId: marcus },
    ]);

    const facts = await crewYearFacts(db, shopId, {
      timeZone: TZ,
      year: 2026,
      now: new Date("2026-08-01T12:00:00Z"),
    });
    expect(facts.get(marcus)).toEqual({ certified: 3, daysAtSea: 2 });
  });
});

describe("weatherCallsInWindow (item 27)", () => {
  it("counts the called-off departures, their divers, the money back and who moved", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "weather-month");
    const owner = await person(db, shopId, "Dana Reyes");
    const blown = await trip(db, shopId, "2026-06-10T13:00:00Z", { status: "cancelled" });
    const ended = await trip(db, shopId, "2026-06-12T13:00:00Z", { status: "cancelled" });
    const later = await trip(db, shopId, "2026-06-20T13:00:00Z");
    const calledAt = new Date("2026-06-09T22:00:00Z");
    const [weather] = await db
      .insert(tripBlowouts)
      .values({ shopId, tripId: blown, calledByPersonId: owner, calledAt, cause: "weather" })
      .returning();
    // A repeating trip's run ending is the schedule, not the weather.
    const [runEnded] = await db
      .insert(tripBlowouts)
      .values({ shopId, tripId: ended, calledByPersonId: owner, calledAt, cause: "run_ended" })
      .returning();
    if (!weather || !runEnded) throw new Error("blowout insert failed");
    const seats = [
      await booking(db, shopId, blown, "cancelled"),
      await booking(db, shopId, blown, "cancelled"),
    ];
    const snapshot = await db
      .select({ id: bookings.id, personId: bookings.personId })
      .from(bookings)
      .where(inArray(bookings.id, seats));
    await db.insert(tripBlowoutDivers).values(
      snapshot.map((seat) => ({
        shopId,
        blowoutId: weather.id,
        bookingId: seat.id,
        personId: seat.personId,
      })),
    );
    const endedSeat = await booking(db, shopId, ended, "cancelled");
    const [endedPerson] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, endedSeat));
    if (!endedPerson) throw new Error("ended seat missing");
    await db.insert(tripBlowoutDivers).values({
      shopId,
      blowoutId: runEnded.id,
      bookingId: endedSeat,
      personId: endedPerson.personId,
    });
    const [first, second] = snapshot;
    if (!first || !second) throw new Error("snapshot missing");
    await db.insert(bookingPayments).values({
      shopId,
      bookingId: first.id,
      status: "refunded",
      amountCents: 9_500,
      currency: "usd",
    });
    // The second diver books the make-up boat after the call.
    await db.insert(bookings).values({
      shopId,
      tripId: later,
      personId: second.personId,
      bookedAs: "diver",
      createdAt: new Date("2026-06-10T01:00:00Z"),
    });

    const june = {
      startUtc: new Date("2026-06-01T04:00:00Z"),
      endUtc: new Date("2026-07-01T04:00:00Z"),
      timeZone: TZ,
    };
    expect(await weatherCallsInWindow(db, shopId, june)).toEqual({
      departures: 1,
      days: 1,
      divers: 2,
      refundedCents: 9_500,
      moved: 1,
    });
    // Anchored to the departure, not the call: July counts nothing.
    expect(
      await weatherCallsInWindow(db, shopId, {
        startUtc: june.endUtc,
        endUtc: new Date("2026-08-01T04:00:00Z"),
        timeZone: TZ,
      }),
    ).toMatchObject({ departures: 0, divers: 0, refundedCents: 0 });
  });

  it("leaves out a departure reinstated after the call, which sailed (dive-domain review F2)", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "weather-reinstated");
    const owner = await person(db, shopId, "Dana Reyes");
    // The morning call was no-go, the swell dropped, the shop ran it.
    const sailed = await trip(db, shopId, "2026-06-10T13:00:00Z");
    const calledAt = new Date("2026-06-10T10:00:00Z");
    const [call] = await db
      .insert(tripBlowouts)
      .values({ shopId, tripId: sailed, calledByPersonId: owner, calledAt, cause: "weather" })
      .returning();
    if (!call) throw new Error("blowout insert failed");
    const seat = await booking(db, shopId, sailed);
    const [held] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, seat));
    if (!held) throw new Error("seat missing");
    await db
      .insert(tripBlowoutDivers)
      .values({ shopId, blowoutId: call.id, bookingId: seat, personId: held.personId });
    expect(
      await weatherCallsInWindow(db, shopId, {
        startUtc: new Date("2026-06-01T04:00:00Z"),
        endUtc: new Date("2026-07-01T04:00:00Z"),
        timeZone: TZ,
      }),
    ).toEqual({ departures: 0, days: 0, divers: 0, refundedCents: 0, moved: 0 });
  });

  it("counts as moved only a live seat booked within 30 days of the call (review N3)", async () => {
    const db = await unseededTestDb();
    const shopId = await shopRow(db, "weather-moved");
    const owner = await person(db, shopId, "Dana Reyes");
    const blown = await trip(db, shopId, "2026-06-10T13:00:00Z", { status: "cancelled" });
    const nextSeason = await trip(db, shopId, "2027-03-10T13:00:00Z");
    const soon = await trip(db, shopId, "2026-06-20T13:00:00Z");
    const calledAt = new Date("2026-06-09T22:00:00Z");
    const [call] = await db
      .insert(tripBlowouts)
      .values({ shopId, tripId: blown, calledByPersonId: owner, calledAt, cause: "weather" })
      .returning();
    if (!call) throw new Error("blowout insert failed");
    const seats = [
      await booking(db, shopId, blown, "cancelled"),
      await booking(db, shopId, blown, "cancelled"),
    ];
    const snapshot = await db
      .select({ id: bookings.id, personId: bookings.personId })
      .from(bookings)
      .where(inArray(bookings.id, seats));
    await db.insert(tripBlowoutDivers).values(
      snapshot.map((row) => ({
        shopId,
        blowoutId: call.id,
        bookingId: row.id,
        personId: row.personId,
      })),
    );
    const [first, second] = snapshot;
    if (!first || !second) throw new Error("snapshot missing");
    // One books next season, months after the call; the other books soon but cancels.
    await db.insert(bookings).values([
      {
        shopId,
        tripId: nextSeason,
        personId: first.personId,
        bookedAs: "diver",
        createdAt: new Date("2026-12-01T12:00:00Z"),
      },
      {
        shopId,
        tripId: soon,
        personId: second.personId,
        bookedAs: "diver",
        status: "cancelled",
        createdAt: new Date("2026-06-10T12:00:00Z"),
      },
    ]);
    const counted = await weatherCallsInWindow(db, shopId, {
      startUtc: new Date("2026-06-01T04:00:00Z"),
      endUtc: new Date("2026-07-01T04:00:00Z"),
      timeZone: TZ,
    });
    expect(counted).toMatchObject({ departures: 1, divers: 2, moved: 0 });
  });
});
