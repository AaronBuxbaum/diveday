import { and, asc, eq, gt, gte, isNotNull, lt, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { moneyByBoat, moneyByKind } from "@/lib/departure-money";
import { summarizeShopYear } from "@/lib/shop-year";
import { sameMomentYearBefore, shopDayBounds, shopMonthBounds, utcToWallTime } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { weatherCallsInWindow } from "./blowouts";
import { diverPackageBalance } from "./dive-packages";
import { openLostItemsByPerson } from "./lost-items";
import { listTripReadiness } from "./readiness";
import { getMonthMoneyDetail } from "./report-lines";
import { bookingLeadTimes, certifiedHere, getMonthlyReport, getShopYear } from "./reporting";
import { getSafetyMonth } from "./safety-report";
import {
  bookingPayments,
  bookings,
  certifications,
  diveSites,
  executedDives,
  interests,
  orders,
  tripBlowouts,
  trips,
} from "./schema";
import {
  LOST_MASK,
  SHOP_CERTIFIED_TITLE,
  WEATHER_CALLED_TITLE,
  WEATHER_MOVED,
  WEEKLY_RUN_WAITING,
} from "./seed-booth";
import { DEMO_SHOP_TIMEZONE } from "./seed-clock";
import { DEMO_WEEKLY_RUN_TITLE } from "./seed-weekly-run";
import { liveTrip } from "./trips-live";

const TZ = DEMO_SHOP_TIMEZONE;

function thisMonth() {
  const wall = utcToWallTime(nowDate(), TZ);
  return shopMonthBounds({ year: wall.year, month: wall.month }, TZ);
}

/**
 * **What a booth visitor is shown** (market sheet 2026-10-22, items 2 and 4):
 * each fact asserted through the read the page itself makes.
 */
describe("the demo's booth stories", () => {
  const context = fileScopedShopContext({ history: true });

  it("has a regular three dives into a five-dive card, two spent on tomorrow's boat", async () => {
    const { db, shop } = context;
    const [card] = await db
      .select({ personId: orders.personId, paidAt: orders.paidAt })
      .from(orders)
      .where(and(eq(orders.shopId, shop.id), eq(orders.description, "Five-dive card")));
    expect(card).toBeDefined();
    expect(await diverPackageBalance(db, shop.id, card?.personId ?? "")).toEqual({
      left: 3,
      of: 5,
    });
    // Bought before this month, so the month's money is what it was.
    expect(card?.paidAt?.getTime()).toBeLessThan(thisMonth().from.getTime());
    const tomorrow = shopDayBounds(new Date(nowDate().getTime() + DAY_MS), TZ);
    const [seat] = await db
      .select({ provider: bookingPayments.provider, amountCents: bookingPayments.amountCents })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .innerJoin(bookingPayments, eq(bookingPayments.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.personId, card?.personId ?? ""),
          gte(trips.startsAt, tomorrow.from),
          lt(trips.startsAt, tomorrow.to),
        ),
      );
    expect(seat).toEqual({ provider: "dive_package", amountCents: 0 });
  });

  it("has a thin last year, so the year reads against it by this date", async () => {
    const { db, shop } = context;
    const now = nowDate();
    const yearAgo = sameMomentYearBefore(now, TZ);
    const lastYear = utcToWallTime(yearAgo, TZ).year;
    const season = await getShopYear(db, shop.id, {
      timeZone: TZ,
      startsOn: `${lastYear}-01-01`,
      endsOn: `${lastYear}-12-31`,
      now: yearAgo,
    });
    const summary = summarizeShopYear(season);
    expect(summary.hasActivity).toBe(true);
    // Thin: a first season, not a copy of this one.
    expect(summary.boatsOut).toBeLessThanOrEqual(6);
  });

  it("called last Saturday off for weather: divers refunded, two moved to the next", async () => {
    const { db, shop } = context;
    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, WEATHER_CALLED_TITLE)));
    expect(trip?.status).toBe("cancelled");
    expect(trip?.startsAt.getTime()).toBeLessThan(nowDate().getTime());
    const wall = utcToWallTime(trip?.startsAt ?? nowDate(), TZ);
    expect(new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()).toBe(6);
    const [call] = await db
      .select({ calledAt: tripBlowouts.calledAt })
      .from(tripBlowouts)
      .where(eq(tripBlowouts.tripId, trip?.id ?? ""));
    expect(call?.calledAt.getTime()).toBeLessThan(trip?.startsAt.getTime() ?? 0);
    const weather = await weatherCallsInWindow(db, shop.id, {
      startUtc: new Date((trip?.startsAt.getTime() ?? 0) - DAY_MS),
      endUtc: new Date((trip?.startsAt.getTime() ?? 0) + DAY_MS),
      timeZone: TZ,
    });
    expect(weather.departures).toBe(1);
    expect(weather.divers).toBeGreaterThanOrEqual(4);
    expect(weather.refundedCents).toBe(weather.divers * (trip?.priceCents ?? 0));
    expect(weather.moved).toBe(WEATHER_MOVED);
  });

  it("certified two students itself, the card on each one's course seat", async () => {
    const { db, shop } = context;
    const rows = await db
      .select({
        level: certifications.level,
        issuedAt: certifications.issuedByShopAt,
        tripId: certifications.issuedFromTripId,
        title: trips.title,
        tripEnds: trips.endsAt,
        by: certifications.issuedByPersonId,
      })
      .from(certifications)
      .innerJoin(trips, eq(trips.id, certifications.issuedFromTripId))
      .where(and(eq(certifications.shopId, shop.id), isNotNull(certifications.issuedByShopAt)));
    const fromSession = rows.filter((row) => row.title === SHOP_CERTIFIED_TITLE);
    expect(fromSession).toHaveLength(2);
    for (const row of fromSession) {
      expect(row.level).toBe("rescue");
      expect(row.issuedAt?.getTime()).toBeLessThanOrEqual(row.tripEnds.getTime());
      expect(row.issuedAt?.getTime()).toBeLessThan(nowDate().getTime());
    }
    const seats = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(eq(bookings.tripId, fromSession[0]?.tripId ?? ""), eq(bookings.status, "checked_in")),
      );
    expect(seats).toHaveLength(2);
    const here = await certifiedHere(db, shop.id, {
      startUtc: new Date(nowDate().getTime() - 60 * DAY_MS),
      endUtc: nowDate(),
    });
    expect(here.total).toBeGreaterThanOrEqual(2);
  });

  /**
   * **A card the shop issued has the training behind it** (dive-domain review
   * of the demo reseed, item 4). The session was an Advanced Open Water
   * course of three planned dives at a 12 m reef with no boat and nothing in
   * the log, and the instructor issued the cards anyway; AOW is five
   * adventure dives with a Deep dive past 18 m, which the demo cannot seat.
   * It is now a Rescue Diver weekend: four sessions in the log, from a hull,
   * every one within its site's depth, both students cleared by the gate.
   */
  it("logs every session behind the cards, from a hull, within each site's depth", async () => {
    const { db, shop } = context;
    const [session] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, SHOP_CERTIFIED_TITLE)));
    if (!session) throw new Error("expected the certified course session");
    expect(session.priceCents).toBeNull();
    expect(session.boatId).not.toBeNull();
    const logged = await db
      .select({
        number: executedDives.diveNumber,
        depth: executedDives.maxDepthMeters,
        siteDepth: diveSites.maxDepthMeters,
        enteredAt: executedDives.enteredAt,
        exitedAt: executedDives.exitedAt,
      })
      .from(executedDives)
      .innerJoin(diveSites, eq(diveSites.id, executedDives.actualSiteId))
      .where(eq(executedDives.tripId, session.id))
      .orderBy(asc(executedDives.diveNumber));
    expect(logged.map((dive) => dive.number)).toEqual(
      Array.from({ length: session.plannedDives }, (_, index) => index + 1),
    );
    for (const dive of logged) {
      expect(dive.depth).toBeGreaterThan(0);
      expect(dive.depth).toBeLessThanOrEqual(dive.siteDepth ?? 0);
      expect(dive.enteredAt?.getTime()).toBeGreaterThanOrEqual(session.startsAt.getTime());
      expect(dive.exitedAt?.getTime()).toBeLessThanOrEqual(session.endsAt.getTime());
    }
    const readiness = await listTripReadiness(db, shop.id, session.id);
    expect(readiness).toHaveLength(2);
    expect(
      readiness
        .filter((row) => row.readiness.status !== "ready")
        .map((row) => JSON.stringify(row.readiness)),
    ).toEqual([]);
  });

  /**
   * **The month's safety record reads clean** (visual triage of PR #2918,
   * item 1c). The course session sailed a hull with two students and an
   * instructor and wrote no head count at all, so the Safety tab read
   * "Roll calls closed 7 of 8" and "2 seats never marked at the dock" over a
   * seed whose every boat came home counted. A boat still at sea is not in
   * the figure (`getSafetyMonth` reads only boats home).
   */
  it("counts the course session at the dock and after every dive, so the safety month reads clean", async () => {
    const { db, shop } = context;
    const [session] = await db
      .select({ startsAt: trips.startsAt })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, SHOP_CERTIFIED_TITLE)));
    if (!session) throw new Error("expected the certified course session");
    const wall = utcToWallTime(session.startsAt, TZ);
    for (const month of [
      thisMonth(),
      shopMonthBounds({ year: wall.year, month: wall.month }, TZ),
    ]) {
      const safety = await getSafetyMonth(db, shop.id, month.from, month.to, TZ);
      expect(safety.departuresBack).toBeGreaterThan(0);
      expect(safety.openRollCalls).toEqual([]);
      expect(safety.rollCallsClosed).toBe(safety.departuresBack);
      expect(safety.unmarkedAtDock).toBe(0);
    }
  });

  it("holds a mask for a diver who is back tomorrow", async () => {
    const { db, shop } = context;
    const tomorrow = shopDayBounds(new Date(nowDate().getTime() + DAY_MS), TZ);
    const tomorrowsDivers = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.shopId, shop.id),
          ne(bookings.status, "cancelled"),
          liveTrip(),
          gte(trips.startsAt, tomorrow.from),
          lt(trips.startsAt, tomorrow.to),
        ),
      );
    const items = await openLostItemsByPerson(
      db,
      shop.id,
      tomorrowsDivers.map((row) => row.personId),
    );
    expect([...items.values()].flat()).toContain(LOST_MASK);
  });

  it("sold the weekly run's next date out, with a wait list", async () => {
    const { db, shop } = context;
    const [run] = await db
      .select()
      .from(trips)
      .where(
        and(
          eq(trips.shopId, shop.id),
          eq(trips.title, DEMO_WEEKLY_RUN_TITLE),
          eq(trips.status, "scheduled"),
          liveTrip(),
          gt(trips.startsAt, nowDate()),
        ),
      )
      .orderBy(asc(trips.startsAt))
      .limit(1);
    if (!run) throw new Error("expected the weekly run");
    const seated = await db
      .select({ id: bookings.id, createdAt: bookings.createdAt })
      .from(bookings)
      .where(and(eq(bookings.tripId, run.id), ne(bookings.status, "cancelled")));
    expect(seated).toHaveLength(run.capacity);
    for (const seat of seated) expect(seat.createdAt.getTime()).toBeLessThan(nowDate().getTime());
    const waiting = await db
      .select({ personId: interests.personId })
      .from(interests)
      .where(and(eq(interests.tripId, run.id), eq(interests.scope, "departure")));
    expect(waiting).toHaveLength(WEEKLY_RUN_WAITING);
  });
});

/**
 * **Reports for the demo month add up** (market sheet 2026-10-22, item 2):
 * every departure that sold seats is on a hull and has a kind, so "By boat"
 * and "By kind of trip" each total the departures; night dives read After
 * dark; courses agree between the money lines and the kinds; and boats sell
 * further ahead at the weekend than midweek.
 */
describe("the demo month's Reports", () => {
  const context = fileScopedShopContext({ history: true });

  it("totals the departures by boat and by kind, with courses agreeing", async () => {
    const { db, shop } = context;
    const { from, to } = thisMonth();
    const report = await getMonthlyReport(db, shop.id, from, to, { currency: "usd", timeZone: TZ });
    const departures = report.trips.reduce((sum, trip) => sum + (trip.netCents ?? 0), 0);
    expect(departures).toBeGreaterThan(0);
    const byBoat = moneyByBoat(report.trips, TZ).reduce((sum, row) => sum + row.netCents, 0);
    const byKind = moneyByKind(report.trips);
    expect(byBoat).toBe(departures);
    expect(byKind.reduce((sum, row) => sum + row.netCents, 0)).toBe(departures);
    for (const trip of report.trips) {
      if ((trip.netCents ?? 0) > 0) expect(trip.boatName).toBeTruthy();
      if (/night|dusk/i.test(trip.title)) expect(trip.kindName).toBe("After dark");
    }
    const detail = await getMonthMoneyDetail(db, shop.id, from, to, nowDate(), {
      currency: "usd",
      timeZone: TZ,
    });
    const courseLine = detail.lines.find((line) => line.line === "courses")?.cents ?? 0;
    const courseKind = byKind.find((row) => row.kind.kind === "course")?.netCents ?? 0;
    expect(courseLine).toBe(courseKind);
  });

  it("sells weekend boats further ahead than midweek ones", async () => {
    const { db, shop } = context;
    const now = nowDate();
    const rows = await bookingLeadTimes(db, shop.id, {
      startUtc: new Date(now.getTime() - 365 * DAY_MS),
      endUtc: now,
      timeZone: TZ,
    });
    const median = (weekday: number) =>
      rows.find((row) => row.isoWeekday === weekday)?.medianDays ?? 0;
    expect(new Set(rows.map((row) => row.medianDays)).size).toBeGreaterThan(1);
    expect(median(6)).toBeGreaterThan(median(3));
    expect(median(7)).toBeGreaterThan(median(2));
  });
});
