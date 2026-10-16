import type { AppDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { crewAwayByTrip } from "@/db/crew-away";
import { listDiveSites } from "@/db/dive-sites";
import { departuresWeekBefore, tripCrewByTrip, weekBoard } from "@/db/trips";
import type { CalendarDate } from "@/lib/calendar-date";
import type { AvailabilityBlock } from "@/lib/crew-requests";
import { shiftWeek } from "@/lib/week-board";
import { weekSeatTally } from "@/lib/week-seats";

type WeekRows = Awaited<ReturnType<typeof weekBoard>>;

/**
 * **Who is crewing the week the board is drawing.** Chained onto the week read, since it needs
 * that read's ids. One reading, so one list: this used to union the stream's cursor page with the
 * week's ids, and the two never agreed about which departures were on the board (#1923). A shop
 * that keeps no crew schedule prints no crew line, so it reads none.
 *
 * **Each member carries the days they said they are away that this departure meets on** (fourth
 * review, item 12; `crewAwayByTrip`), so the board can say "Marcus Webb away Sun, Oct 18" on the
 * sessions he is rostered to teach. Courses too: a span names its instructor in its own line, and
 * the instructor away is the case the review found.
 */
export async function weekCrewRead(
  db: AppDb,
  shop: { id: string; crewScheduleEnabled: boolean; timezone: string },
  weekRead: Promise<WeekRows>,
): Promise<Map<string, Array<{ id: string; name: string; away: AvailabilityBlock[] }>>> {
  if (!shop.crewScheduleEnabled) return new Map();
  const week = await weekRead;
  const tripIds = [
    ...Object.values(week.days).flatMap((entries) => entries.map((e) => e.tripId)),
    ...week.spans.map((span) => span.tripId),
  ];
  const [crew, away] = await Promise.all([
    tripCrewByTrip(db, shop.id, tripIds),
    crewAwayByTrip(db, shop.id, tripIds, shop.timezone),
  ]);
  return new Map(
    [...crew].map(([tripId, members]) => {
      const awayOnTrip = away.get(tripId) ?? [];
      return [
        tripId,
        members.map((member) => ({
          ...member,
          away: awayOnTrip.find((entry) => entry.personId === member.id)?.blocks ?? [],
        })),
      ];
    }),
  );
}

/**
 * A course the catalogue, or a dive site the library, sent us here to schedule. One list read,
 * and only on the rare navigation that names one — scoped to the session's own shop, so a
 * `?course=` or `?site=` from another tenant simply resolves to nothing.
 */
export async function requestedCourseAndSite(
  db: AppDb,
  shopId: string,
  { course, site }: { course: string | undefined; site: string | undefined },
) {
  const [courses, sites] = await Promise.all([
    course ? listActiveCourses(db, shopId) : [],
    site ? listDiveSites(db, shopId) : [],
  ]);
  return {
    requestedCourse: courses.find((row) => row.id === course) ?? null,
    requestedSite: sites.find((row) => row.id === site) ?? null,
  };
}

/** The same week a year before, as the board weighs it (fifth loop, item 30). */
export type LastYearWeek = { taken: number; total: number; departures: number };

/**
 * **The same week last year**: its seat tally, counted by the rule this
 * week's is (`weekSeatTally` over `weekBoard`'s cells and spans, so a course
 * counts once), and how many departures a copy would put back up. Zero seats
 * and zero departures for a shop with no year of history, and the board says
 * nothing.
 */
export async function lastYearWeekRead(
  db: AppDb,
  shopId: string,
  weekStartIso: CalendarDate,
  timeZone: string,
  now: Date,
): Promise<LastYearWeek> {
  const [rows, departures] = await Promise.all([
    weekBoard(db, shopId, shiftWeek(weekStartIso, -52), timeZone, now),
    departuresWeekBefore(db, shopId, weekStartIso, timeZone),
  ]);
  const tally = weekSeatTally([...Object.values(rows.days).flat(), ...rows.spans]);
  return { ...tally, departures: departures.length };
}

/**
 * **What the week is read beside** (fifth loop, item 30): who crews it and
 * the same week a year before, in one entry of the page's wave so the route
 * stays one page.
 */
export async function weekAroundRead(
  db: AppDb,
  shop: { id: string; crewScheduleEnabled: boolean; timezone: string },
  weekRead: Promise<WeekRows>,
  weekStartIso: CalendarDate,
  now: Date,
) {
  const [crewByTrip, lastYear] = await Promise.all([
    weekCrewRead(db, shop, weekRead),
    lastYearWeekRead(db, shop.id, weekStartIso, shop.timezone, now),
  ]);
  return { crewByTrip, lastYear };
}
