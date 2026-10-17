import { desc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { diveSiteSlugFrom } from "@/lib/dive-site-slug";
import { summarizeMonth } from "@/lib/reporting";
import { currentShopSeason, seasonStartInstant, shopSeasonOf } from "@/lib/season";
import { summarizeShopYear } from "@/lib/shop-year";
import { shiftInstantByCalendarDays } from "@/lib/zoned";
import { fileScopedShopContext, unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { getShopYear, getYearMonthInputs, getYearToDate } from "./reporting";
import {
  boats,
  bookingPayments,
  bookings,
  diveSites,
  people,
  shops,
  tripDives,
  trips,
} from "./schema";
import { seasonScale } from "./season-scale";

/**
 * The shop's year and its money (`getShopYear`, `getYearToDate`,
 * `getYearMonthInputs`), apart from the month report's own file. Most cases
 * build a shop of their own; the agreement with the home's season count reads
 * the seeded fixture (`fileScopedShopContext`).
 */
const ctx = fileScopedShopContext();

async function makePerson(db: AppDb, shopId: string, name: string): Promise<string> {
  const [row] = await db.insert(people).values({ shopId, fullName: name }).returning();
  if (!row) throw new Error("failed to insert person");
  return row.id;
}

async function makeTrip(
  db: AppDb,
  shopId: string,
  startsAt: Date,
  capacity: number,
  title = "Trip",
  status: "scheduled" | "cancelled" = "scheduled",
): Promise<string> {
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 60 * 60 * 1000),
      capacity,
      status,
    })
    .returning();
  if (!row) throw new Error("failed to insert trip");
  return row.id;
}

async function makeBooking(
  db: AppDb,
  shopId: string,
  tripId: string,
  personId: string,
): Promise<string> {
  const [row] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId, tripId, personId, status: "booked" })
    .returning();
  if (!row) throw new Error("failed to insert booking");
  return row.id;
}

async function pay(db: AppDb, shopId: string, bookingId: string, amountCents: number) {
  await db.insert(bookingPayments).values({
    shopId,
    bookingId,
    status: "paid",
    amountCents,
    currency: "usd",
  });
}

/**
 * **The shop's year** (ADR 20260908-one-hand, decision 6, lever T). Built on a
 * shop of its own rather than the demo fixture: the year is a read over
 * *every* departure a shop ever ran, so a seeded back-fill would make "the
 * quietest month" and "since May" answers about the fixture rather than about
 * the rule.
 */
/**
 * **The year's money** (fourth UX review, item 25): one month row per month
 * begun, each "so far" at now, and one year-to-date read that sums them.
 */
/** A January-start shop's year: the calendar year (issue #2657). */
const YEAR_2026 = { startsOn: "2026-01-01", endsOn: "2026-12-31" } as const;

describe("the year's money", () => {
  const TZ = "America/New_York";
  const NOW = new Date("2026-03-20T16:00:00Z");

  it("reads a row per month begun, departures before now only, and the year as their sum", async () => {
    const db = await unseededTestDb();
    const [shop] = await db
      .insert(shops)
      .values({ name: "Money Year", slug: "money-year", timezone: TZ })
      .returning();
    if (!shop) throw new Error("shop insert failed");
    const seat = async (day: string, cents: number) => {
      const tripId = await makeTrip(db, shop.id, new Date(`${day}T13:00:00Z`), 10);
      const personId = await makePerson(db, shop.id, `Diver ${day}`);
      await pay(db, shop.id, await makeBooking(db, shop.id, tripId, personId), cents);
    };
    await seat("2026-01-10", 10_000);
    await seat("2026-03-02", 9_500);
    // Still to sail on the day the year is read: not in the year's money.
    await seat("2026-03-28", 7_000);

    const months = await getYearMonthInputs(db, shop.id, { timeZone: TZ, ...YEAR_2026, now: NOW });
    expect(months.map(({ month }) => month.month)).toEqual([1, 2, 3]);
    const revenue = months.map(({ input }) => summarizeMonth(input).revenueCents);
    expect(revenue).toEqual([10_000, 0, 9_500]);
    const ytd = summarizeMonth(
      await getYearToDate(db, shop.id, { timeZone: TZ, ...YEAR_2026, now: NOW }),
    );
    expect(ytd.revenueCents).toBe(19_500);
    expect(ytd.seatsBooked).toBe(2);
  });
});

describe("getShopYear", () => {
  const TZ = "America/New_York";
  /** Noon in New York on 2026-08-27, the day the canvas draws. */
  const NOW = new Date("2026-08-27T16:00:00Z");

  async function yearShop(db: AppDb, slug: string) {
    const [row] = await db
      .insert(shops)
      .values({ name: "Year Shop", slug, timezone: TZ })
      .returning();
    if (!row) throw new Error("shop insert failed");
    return row.id;
  }

  /** A departure at 09:00 shop-local on `day`, already sailed by NOW. */
  async function sailedTrip(
    db: AppDb,
    shopId: string,
    day: string,
    capacity: number,
    divers: number,
    title = "Two-Tank Reef",
  ): Promise<string> {
    const tripId = await makeTrip(db, shopId, new Date(`${day}T13:00:00Z`), capacity, title);
    for (let seat = 0; seat < divers; seat += 1) {
      const personId = await makePerson(db, shopId, `Diver ${day}-${seat}`);
      await makeBooking(db, shopId, tripId, personId);
    }
    return tripId;
  }

  it("counts the year's divers, boats and days in the shop's own zone", async () => {
    const db = await unseededTestDb();
    const shopId = await yearShop(db, "year-happy-path");
    // A departure on the year's first day, so the strip starts at January 1
    // and nothing is padded away in front of it.
    await sailedTrip(db, shopId, "2026-01-01", 10, 5);
    await sailedTrip(db, shopId, "2026-03-14", 10, 2);
    await sailedTrip(db, shopId, "2026-03-14", 10, 2, "Night");
    await sailedTrip(db, shopId, "2026-07-04", 12, 12);

    const input = await getShopYear(db, shopId, { timeZone: TZ, now: NOW, ...YEAR_2026 });
    const year = summarizeShopYear(input);

    expect(year.year).toBe(2026);
    expect(year.sinceMonth).toBeNull();
    expect(year.divers).toBe(21);
    expect(year.boatsOut).toBe(4);
    expect(year.daysAtSea).toBe(3);
    expect(year.busiestDay).toEqual({
      day: "2026-07-04",
      boats: 1,
      divers: 12,
      aboard: 12,
      seats: 12,
    });
    // Today is the last square drawn, and the strip never runs past it.
    expect(year.lastDay).toBe("2026-08-27");
    expect(year.strip.at(-1)?.day).toBe("2026-08-27");
    expect(year.strip.at(-1)?.isToday).toBe(true);
    // January 1 2026 is a Thursday, so the first column carries four padding
    // squares before it.
    expect(year.strip.slice(0, 4).every((cell) => cell.day === null)).toBe(true);
    expect(year.strip[4]?.day).toBe("2026-01-01");
    // A full boat is the deepest water; two boats a fifth full, the shallowest.
    expect(year.strip.find((cell) => cell.day === "2026-07-04")?.fill).toBe(3);
    expect(year.strip.find((cell) => cell.day === "2026-03-14")?.fill).toBe(1);
    expect(year.strip.find((cell) => cell.day === "2026-01-01")?.fill).toBe(2);
    expect(year.hasActivity).toBe(true);
  });

  it("names the quietest complete month and never the one still running", async () => {
    const db = await unseededTestDb();
    const shopId = await yearShop(db, "year-quietest-month");
    await sailedTrip(db, shopId, "2026-02-15", 10, 3);
    await sailedTrip(db, shopId, "2026-06-15", 10, 9);
    // August is the month NOW sits in, and it is the thinnest of the three.
    await sailedTrip(db, shopId, "2026-08-03", 10, 1);

    const year = summarizeShopYear(
      await getShopYear(db, shopId, { timeZone: TZ, now: NOW, ...YEAR_2026 }),
    );

    expect(year.quietestMonth).toEqual({ month: 2, divers: 3, boats: 1 });
  });

  it("says since the month a shop opened in, and draws no square before it", async () => {
    const db = await unseededTestDb();
    const shopId = await yearShop(db, "year-opened-mid-year");
    await sailedTrip(db, shopId, "2026-05-20", 8, 6);
    await sailedTrip(db, shopId, "2026-06-02", 8, 4);

    const input = await getShopYear(db, shopId, { timeZone: TZ, now: NOW, ...YEAR_2026 });
    const year = summarizeShopYear(input);

    expect(input.openedThisYear).toBe(true);
    expect(year.sinceMonth).toBe(5);
    expect(year.firstDay).toBe("2026-05-20");
    // 2026-05-20 is a Wednesday: three padding squares, then the first day.
    expect(year.strip.slice(0, 3).every((cell) => cell.day === null)).toBe(true);
    expect(year.strip[3]?.day).toBe("2026-05-20");
  });

  it("says nothing for a year with no departures", async () => {
    const db = await unseededTestDb();
    const shopId = await yearShop(db, "year-empty");

    const year = summarizeShopYear(
      await getShopYear(db, shopId, { timeZone: TZ, now: NOW, ...YEAR_2026 }),
    );

    expect(year.hasActivity).toBe(false);
    expect(year.divers).toBe(0);
    expect(year.boatsOut).toBe(0);
    expect(year.busiestDay).toBeNull();
    expect(year.quietestMonth).toBeNull();
    expect(year.sites).toEqual([]);
    expect(year.boats).toEqual([]);
    expect(year.sinceMonth).toBeNull();
    expect(year.firstDay).toBe("2026-01-01");
  });

  it("counts a hull's days at sea once however often it went out", async () => {
    const db = await unseededTestDb();
    const shopId = await yearShop(db, "year-boat-days");
    const [boat] = await db
      .insert(boats)
      .values({ shopId, name: "Mantis II", capacity: 12 })
      .returning();
    if (!boat) throw new Error("boat insert failed");
    const morning = await sailedTrip(db, shopId, "2026-04-10", 10, 5);
    const night = await sailedTrip(db, shopId, "2026-04-10", 10, 5, "Night");
    const later = await sailedTrip(db, shopId, "2026-04-11", 10, 5);
    await db
      .update(trips)
      .set({ boatId: boat.id })
      .where(inArray(trips.id, [morning, night, later]));

    const year = summarizeShopYear(
      await getShopYear(db, shopId, { timeZone: TZ, now: NOW, ...YEAR_2026 }),
    );

    expect(year.boats).toEqual([{ name: "Mantis II", days: 2 }]);
    expect(year.boatsOut).toBe(3);
  });

  it("orders sites by the times they were dived and keeps a deleted one off its door", async () => {
    const db = await unseededTestDb();
    const shopId = await yearShop(db, "year-sites");
    const [molasses] = await db
      .insert(diveSites)
      .values({ shopId, name: "Molasses Reef", slug: diveSiteSlugFrom("Molasses Reef") })
      .returning();
    const [benwood] = await db
      .insert(diveSites)
      .values({
        shopId,
        name: "Benwood",
        slug: diveSiteSlugFrom("Benwood"),
        deletedAt: new Date("2026-08-01T00:00:00Z"),
      })
      .returning();
    if (!molasses || !benwood) throw new Error("site insert failed");
    const first = await sailedTrip(db, shopId, "2026-05-01", 10, 4);
    const second = await sailedTrip(db, shopId, "2026-05-02", 10, 4);
    await db.insert(tripDives).values([
      { tripId: first, diveNumber: 1, diveSiteId: molasses.id },
      { tripId: first, diveNumber: 2, diveSiteId: benwood.id },
      { tripId: second, diveNumber: 1, diveSiteId: molasses.id },
    ]);

    const year = summarizeShopYear(
      await getShopYear(db, shopId, { timeZone: TZ, now: NOW, ...YEAR_2026 }),
    );

    expect(year.siteCount).toBe(2);
    expect(year.sites.map((site) => [site.name, site.times, site.live])).toEqual([
      ["Molasses Reef", 2, true],
      ["Benwood", 1, false],
    ]);
    // The bar beside each row is the share of the busiest site's own count.
    expect(year.sites[0]?.share).toBe(1);
    expect(year.sites[1]?.share).toBe(0.5);
  });

  it("leaves a departure that has not sailed, and a canceled one, out of the year", async () => {
    const db = await unseededTestDb();
    const shopId = await yearShop(db, "year-unsailed");
    await sailedTrip(db, shopId, "2026-06-01", 10, 5);
    // Thirty minutes ago: inside the hour of grace every departure check
    // allows, so it has not sailed yet.
    const tripId = await makeTrip(db, shopId, new Date(NOW.getTime() - 30 * 60 * 1000), 10, "Soon");
    const personId = await makePerson(db, shopId, "Waiting diver");
    await makeBooking(db, shopId, tripId, personId);
    await makeTrip(db, shopId, new Date("2026-06-15T13:00:00Z"), 10, "Blown out", "cancelled");

    const year = summarizeShopYear(
      await getShopYear(db, shopId, { timeZone: TZ, now: NOW, ...YEAR_2026 }),
    );

    expect(year.boatsOut).toBe(1);
    expect(year.divers).toBe(5);
  });

  it("counts a diver once however many boats they sailed on (issue #2663)", async () => {
    const db = await unseededTestDb();
    const shopId = await yearShop(db, "year-distinct-divers");
    const regular = await makePerson(db, shopId, "Saturday Regular");
    const morning = await sailedTrip(db, shopId, "2026-06-06", 4, 1);
    const night = await makeTrip(db, shopId, new Date("2026-06-07T00:00:00Z"), 4, "Night");
    const nextWeek = await sailedTrip(db, shopId, "2026-06-13", 4, 0);
    for (const tripId of [morning, night, nextWeek]) await makeBooking(db, shopId, tripId, regular);

    const input = await getShopYear(db, shopId, { timeZone: TZ, now: NOW, ...YEAR_2026 });
    const year = summarizeShopYear(input);

    // Two people: the regular, three times, and one diver once.
    expect(year.divers).toBe(2);
    expect(input.monthDivers).toEqual([{ month: "2026-06", divers: 2 }]);
    // June 6 is one day with two boats: two people, three seats taken.
    expect(input.days.find((day) => day.day === "2026-06-06")).toMatchObject({
      boats: 2,
      divers: 2,
      aboard: 3,
    });
  });

  it("follows a season that starts in May, not January (issue #2657)", async () => {
    const db = await unseededTestDb();
    const shopId = await yearShop(db, "year-may-season");
    await db
      .update(shops)
      .set({ seasonStartMonth: 5, seasonStartDay: 1 })
      .where(eq(shops.id, shopId));
    // The last season's, and this one's.
    await sailedTrip(db, shopId, "2026-04-20", 10, 7);
    await sailedTrip(db, shopId, "2026-05-10", 10, 3);

    const season = currentShopSeason(NOW, TZ, { month: 5, day: 1 });
    expect(season).toEqual({ year: 2026, startsOn: "2026-05-01", endsOn: "2027-04-30" });
    const year = summarizeShopYear(
      await getShopYear(db, shopId, { timeZone: TZ, now: NOW, ...season }),
    );
    expect(year.label).toBe("2026–27");
    expect(year.divers).toBe(3);
    expect(year.boatsOut).toBe(1);
    expect(year.sinceMonth).toBeNull();
    expect(year.firstDay).toBe("2026-05-01");

    const last = summarizeShopYear(
      await getShopYear(db, shopId, {
        timeZone: TZ,
        now: NOW,
        ...shopSeasonOf(2025, { month: 5, day: 1 }),
      }),
    );
    expect(last.label).toBe("2025–26");
    expect(last.divers).toBe(7);
    // The season's money, month by month from May.
    const months = await getYearMonthInputs(db, shopId, { timeZone: TZ, ...season, now: NOW });
    expect(months.map(({ month }) => month.month)).toEqual([5, 6, 7, 8]);
  });

  it("never counts another shop's departures", async () => {
    const db = await unseededTestDb();
    const shopId = await yearShop(db, "year-tenant-a");
    const otherId = await yearShop(db, "year-tenant-b");
    await sailedTrip(db, shopId, "2026-06-01", 10, 5);
    await sailedTrip(db, otherId, "2026-06-01", 10, 9);

    const year = summarizeShopYear(
      await getShopYear(db, shopId, { timeZone: TZ, now: NOW, ...YEAR_2026 }),
    );

    expect(year.divers).toBe(5);
    expect(year.boatsOut).toBe(1);
  });
});

/**
 * **The year's divers and the home's season count are one number** (issue
 * #2663): "Divers" on the year page and "your 400th diver of the season" both
 * count different people, so on the seeded shop, read the morning after its
 * last departure so nothing sails between the two, they agree.
 */
describe("the year and the season count agree", () => {
  it("counts the same divers as seasonScale on the seeded shop", async () => {
    const { db, shop } = ctx;
    const tz = shop.timezone;
    const latest = await db
      .select({ startsAt: trips.startsAt })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .orderBy(desc(trips.startsAt))
      .limit(1);
    const last = latest[0]?.startsAt;
    if (!last) throw new Error("the seeded shop has no departures");
    // Two shop days after the last departure: everything has sailed, and none of it is today's.
    const now = shiftInstantByCalendarDays(last, 2, tz);
    const start = { month: shop.seasonStartMonth, day: shop.seasonStartDay };
    const year = summarizeShopYear(
      await getShopYear(db, shop.id, { timeZone: tz, now, ...currentShopSeason(now, tz, start) }),
    );
    const scale = await seasonScale(db, shop.id, tz, seasonStartInstant(now, tz, start), now);

    expect(year.divers).toBeGreaterThan(0);
    expect(year.divers).toBe(scale.diversBefore);
  });
});
