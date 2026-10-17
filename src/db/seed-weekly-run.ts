import { and, eq, inArray } from "drizzle-orm";
import {
  type CalendarDate,
  calendarDateInTimezone,
  calendarDateWeekday,
  calendarDaysBetween,
  shiftCalendarDate,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { SERIES_HORIZON_DAYS, weekdaySetFrom } from "@/lib/recurrence";
import type { AppDb, DbExecutor } from "./client";
import { boats, crewNotices, diveSites, tripSeriesCrew, trips } from "./schema";
import { at, DEMO_SHOP_TIMEZONE } from "./seed-clock";
import { createTripSeries, deleteTrip } from "./trips";
import { seatStandingCrew } from "./trips-crew";

/**
 * **The demo's weekly boat** (fourth review, item 51). A shop's most ordinary
 * shape is the boat that goes every Saturday with the same skipper and
 * divemaster, and the demo had none: every departure read "One-time
 * departure", while the product page sells repeating trips that keep going.
 *
 * One open-ended Saturday run, written through the schedule builder's own
 * doors so it is exactly what a shop that set one up would have:
 * `createTripSeries` materializes the horizon, the run gets a standing crew
 * (`trip_series_crew`, seated on each date by `seatStandingCrew`, which leaves
 * a person off a date they already crew elsewhere), and the Saturday Mantis
 * II is hauled out for her annual survey, plus any Saturday the crew are out
 * on a longer boat, is deleted with `deleteTrip`, which leaves the skip the
 * nightly roll honors.
 */
/** Named for the two sites its dives visit, in order. */
export const DEMO_WEEKLY_RUN_TITLE = "Saturday Two-Tank — Benwood & Christ of the Abyss";

/** Saturday, in `calendarDateWeekday`'s Sunday-zero count. */
const SATURDAY = 6;

/**
 * The Saturday Mantis II is hauled out for her annual survey: the one closest
 * to the second week of September, after the summer season and before the
 * winter one, among the run's dates after its first. A run whose horizon
 * passed September, or stops short of it, loses the date nearest to it, so the
 * demo always shows a gap in the run. Pure, so the choice is tested on its own.
 */
export function surveySaturday(firstRun: CalendarDate): CalendarDate {
  const horizonEnd = shiftCalendarDate(firstRun, SERIES_HORIZON_DAYS);
  const year = Number(firstRun.slice(0, 4));
  const surveys = [year - 1, year, year + 1].map(secondWeekOfSeptemberSaturday);
  const distance = (saturday: CalendarDate) =>
    Math.min(...surveys.map((survey) => Math.abs(calendarDaysBetween(saturday, survey))));
  let closest = shiftCalendarDate(firstRun, 7);
  for (let saturday = closest; saturday <= horizonEnd; saturday = shiftCalendarDate(saturday, 7)) {
    if (distance(saturday) < distance(closest)) closest = saturday;
  }
  return closest;
}

/** The Saturday that falls on September 8–14 of `year`. */
function secondWeekOfSeptemberSaturday(year: number): CalendarDate {
  const eighth = `${year}-09-08`;
  return shiftCalendarDate(eighth, (SATURDAY - calendarDateWeekday(eighth) + 7) % 7);
}

/** Days from the shop's today to the next Saturday, never today itself. */
function daysToNextSaturday(today: CalendarDate): number {
  const ahead = (SATURDAY - calendarDateWeekday(today) + 7) % 7;
  return ahead === 0 ? 7 : ahead;
}

export async function seedWeeklyRun(
  db: DbExecutor,
  shopId: string,
  ctx: { skipperId: string | undefined; divemasterId: string | undefined },
): Promise<void> {
  // The schedule builder's doors take the app database; the seed runs on it
  // or on one transaction, and both carry `transaction`.
  const app = db as AppDb;
  const today = calendarDateInTimezone(nowDate(), DEMO_SHOP_TIMEZONE);
  const ahead = daysToNextSaturday(today);
  const firstRun = shiftCalendarDate(today, ahead);
  const [boat] = await db
    .select({ id: boats.id })
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.name, "Mantis II")))
    .limit(1);
  const sites = new Map(
    (
      await db
        .select({ id: diveSites.id, name: diveSites.name })
        .from(diveSites)
        .where(eq(diveSites.shopId, shopId))
    ).map((site) => [site.name, site.id]),
  );
  const created = await createTripSeries(app, {
    shopId,
    title: DEMO_WEEKLY_RUN_TITLE,
    description: "The shop's regular Saturday boat: a shallow wreck, then the statue.",
    capacity: 16,
    plannedDives: 2,
    dives: [
      { title: "Benwood Wreck", diveSiteId: sites.get("Benwood Wreck") ?? null },
      { title: "Christ of the Abyss", diveSiteId: sites.get("Christ of the Abyss") ?? null },
    ],
    priceCents: 9500,
    boatId: boat?.id ?? null,
    frequency: "weekly",
    intervalWeeks: 1,
    weekdays: weekdaySetFrom([SATURDAY]),
    anchorDate: firstRun,
    endsOn: null,
    timeZone: DEMO_SHOP_TIMEZONE,
    template: { startsAt: at(ahead, 8, 0), endsAt: at(ahead, 12, 0) },
  });
  if (!created) throw new Error("seed: the weekly Saturday run was refused");
  const { series } = created;

  // The skipper and the divemaster sail every Saturday: the run's own record
  // of it, then each date asked whether they are free in its hours.
  const crew = [
    ...(ctx.skipperId ? [{ personId: ctx.skipperId, tripRole: "captain" as const }] : []),
    ...(ctx.divemasterId ? [{ personId: ctx.divemasterId, tripRole: "divemaster" as const }] : []),
  ];
  // A Saturday the crew are already out on a longer boat is one the regular
  // boat makes way for: that date goes, the way a shop deletes it, rather
  // than sailing short of its crew.
  const madeWay: string[] = [];
  if (crew.length > 0) {
    await db
      .insert(tripSeriesCrew)
      .values(crew.map((member) => ({ shopId, seriesId: series.id, ...member })));
    for (const trip of created.trips) {
      const seated = await seatStandingCrew(db, {
        shopId,
        tripId: trip.id,
        courseSession: false,
        days: [{ startsAt: trip.startsAt, endsAt: trip.endsAt }],
        crew,
      });
      if (seated.length < crew.length) madeWay.push(trip.id);
    }
    // The crew have always sailed this run: being seated on it is not news
    // for their digest.
    await db.delete(crewNotices).where(
      and(
        eq(crewNotices.shopId, shopId),
        inArray(
          crewNotices.tripId,
          created.trips.map((trip) => trip.id),
        ),
      ),
    );
  }

  const closed = surveySaturday(firstRun);
  const [survey] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.seriesId, series.id), eq(trips.seriesOccurrenceDate, closed)))
    .limit(1);
  for (const tripId of new Set([...madeWay, ...(survey ? [survey.id] : [])])) {
    const outcome = await deleteTrip(app, shopId, tripId);
    if (!outcome.ok) throw new Error(`seed: a Saturday the run skips stayed (${outcome.reason})`);
  }
}
