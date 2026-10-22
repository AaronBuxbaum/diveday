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
import { boats, crewNotices, diveSites, shops, tripSeriesCrew, trips } from "./schema";
import { at, DEMO_SHOP_TIMEZONE } from "./seed-clock";
import { createTripSeries, deleteTrip } from "./trips";
import { seatStandingCrew, setTripCrew } from "./trips-crew";

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
 * is deleted with `deleteTrip`, which leaves the skip the nightly roll honors.
 * A Saturday whose standing crew are out on a longer boat is not deleted: the
 * shop puts a relief on the regular boat for that date alone
 * (`setTripCrew`), which also shows that each date's crew is editable on its
 * own.
 *
 * **Staffed to the shop's own ratio** (issue #2686): sixteen seats on one
 * in-water guide read "Under target" from the seventh booking, a warning the
 * first prospect to book would not have caused. The run sells twelve seats
 * and stands two guides on them, so `divers_per_divemaster`'s default of six
 * is met by every booking the boat can take.
 */
/** Named for the two sites its dives visit, in order. */
export const DEMO_WEEKLY_RUN_TITLE = "Saturday Two-Tank — Benwood & Christ of the Abyss";

/** The shop roles that put someone in the water as a guide. */
const IN_WATER_ROLES = ["instructor", "assistant_instructor", "divemaster"];

/** Seats the run sells: two guides at the default six divers per divemaster. */
const RUN_SEATS = 12;

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
  ctx: {
    skipperId: string | undefined;
    /** The standing in-water guides: two cover twelve divers at the default ratio. */
    divemasterIds: readonly string[];
    /**
     * Staff who step onto a date a standing member is busy on, in the order
     * tried, with the shop roles each holds: a place goes only to someone who
     * holds the role it needs.
     */
    reliefs: readonly { personId: string; roles: readonly string[] }[];
  },
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
    capacity: RUN_SEATS,
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
  const [target] = await db
    .select({ ratio: shops.diversPerDivemaster })
    .from(shops)
    .where(eq(shops.id, shopId));
  // Divers the boat may sell on a date with this many guides: the shop's own
  // ratio, never more than the run's twelve seats.
  const guideSeats = (guides: number) => Math.min(RUN_SEATS, guides * (target?.ratio ?? 6));

  // The skipper and the divemasters sail every Saturday: the run's own record
  // of it, then each date asked whether they are free in its hours.
  const crew = [
    ...(ctx.skipperId ? [{ personId: ctx.skipperId, tripRole: "captain" as const }] : []),
    ...ctx.divemasterIds.map((personId) => ({ personId, tripRole: "divemaster" as const })),
  ];
  const calledOff: string[] = [];
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
      // A Saturday a standing member is out on a longer boat keeps its crew
      // by a relief, the way a shop fills it, rather than sailing short or
      // being deleted.
      const absent = crew.filter((member) => !seated.includes(member.personId));
      if (absent.length === 0) continue;
      const roster: { personId: string; tripRole: (typeof crew)[number]["tripRole"] }[] =
        crew.filter((member) => seated.includes(member.personId));
      // The first relief who is free in the date's hours takes each place:
      // `setTripCrew` refuses a person who is out on another boat.
      let unfilled = false;
      for (const member of absent) {
        let placed = false;
        const needs = member.tripRole === "captain" ? ["captain"] : IN_WATER_ROLES;
        const holders = ctx.reliefs.filter((relief) =>
          relief.roles.some((role) => needs.includes(role)),
        );
        if (holders.length === 0) {
          throw new Error(`seed: nobody on the staff holds ${needs.join(" or ")} to relieve`);
        }
        for (const { personId: relief } of holders) {
          if (roster.some((entry) => entry.personId === relief)) continue;
          const attempt = [...roster, { personId: relief, tripRole: member.tripRole }];
          if (await setTripCrew(app, shopId, trip.id, attempt)) {
            roster.push({ personId: relief, tripRole: member.tripRole });
            placed = true;
            break;
          }
        }
        // A date nobody is free to guide sells only what its guides cover, the
        // way a shop caps a day it cannot staff. A date no captain is free to
        // skipper is called off, as a shop does: an instructor is not a
        // captain, and the boat does not sail without one.
        if (!placed && member.tripRole === "captain") {
          calledOff.push(trip.id);
          break;
        }
        if (!placed) unfilled = true;
      }
      if (unfilled) {
        const guides = roster.filter((entry) => entry.tripRole === "divemaster").length;
        // No guide free at all: nothing to sell, so the date is called off
        // like a captainless one (capacity 0 breaks trips_capacity_range).
        if (guides === 0) {
          calledOff.push(trip.id);
          continue;
        }
        await db
          .update(trips)
          .set({ capacity: guideSeats(guides) })
          .where(eq(trips.id, trip.id));
      }
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
  for (const tripId of new Set([...calledOff, ...(survey ? [survey.id] : [])])) {
    const outcome = await deleteTrip(app, shopId, tripId);
    if (!outcome.ok) throw new Error(`seed: a Saturday the run skips stayed (${outcome.reason})`);
  }
}
