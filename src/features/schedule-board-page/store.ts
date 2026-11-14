import { openBoardingObservationsByTrip } from "@/db/boarding-observations";
import { personClashesByTrip } from "@/db/person-clashes";
import {
  crewClashesByTrip,
  departuresWeekBefore,
  tripCrewByTrip,
  upcomingScheduleRange,
  weekBoard,
} from "@/db/trips";
import { listBoats, listBoatsForHistory } from "@/features/boats";
import { listActiveCourses } from "@/features/courses";
import { crewAwayByTrip } from "@/features/crew-away";
import { readFormDraft } from "@/features/form-drafts";
import { openAfterDiveRollCalls } from "@/features/roll-call-gaps";
import { canPersonConfigureTrips } from "../../db/authz";
import type { AppDb } from "../../db/client";
import { listDiveSites } from "../../db/dive-sites";
import { listDateInterestsByIds, listOpenDateInterestsForDates } from "../../db/interest-dates";

import type { CalendarDate } from "../../lib/calendar-date";
import type { AvailabilityBlock } from "../../lib/crew-requests";
import { shiftWeek, weekDates } from "../../lib/week-board";
import { weekSeatTally } from "../../lib/week-seats";

type WeekRows = Awaited<ReturnType<typeof weekBoard>>;

/** Who crews each departure on the board's week, with the days each says they are away. */
export type WeekCrew = Map<string, Array<{ id: string; name: string; away: AvailabilityBlock[] }>>;

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
async function weekCrewRead(
  db: AppDb,
  shop: { id: string; crewScheduleEnabled: boolean; timezone: string },
  weekRead: Promise<WeekRows>,
): Promise<WeekCrew> {
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

/** What each departure on the week is standing in that a person has to sort out. */
export type WeekConflicts = Map<string, { dock: number; clashes: number }>;

/**
 * **The day board's conflicts** (issue #4474): divers the desk saw at the dock
 * whose seat has not come back, and people on two overlapping departures (crew
 * on two boats, or a seat on either side). The same committed-row readers the
 * departure page draws its panels from, so the board and the departure never
 * disagree, and a move committed in any order is in the next read.
 */
async function weekConflictsRead(
  db: AppDb,
  shopId: string,
  weekRead: Promise<WeekRows>,
  now: Date,
): Promise<WeekConflicts> {
  const week = await weekRead;
  const tripIds = [
    ...Object.values(week.days).flatMap((entries) => entries.map((e) => e.tripId)),
    ...week.spans.map((span) => span.tripId),
  ];
  const [dock, seats, crew] = await Promise.all([
    openBoardingObservationsByTrip(db, shopId, tripIds),
    personClashesByTrip(db, shopId, tripIds, now),
    crewClashesByTrip(db, shopId, tripIds, now),
  ]);
  const conflicts: WeekConflicts = new Map();
  for (const tripId of tripIds) {
    const people = new Set([
      ...(seats.get(tripId) ?? []).map((clash) => clash.personId),
      ...(crew.get(tripId) ?? []).map((clash) => clash.personId),
    ]);
    const waiting = dock.get(tripId)?.length ?? 0;
    if (waiting > 0 || people.size > 0) {
      conflicts.set(tripId, { dock: waiting, clashes: people.size });
    }
  }
  return conflicts;
}

/**
 * A course the catalogue, or a dive site the library, sent us here to schedule. One list read,
 * and only on the rare navigation that names one — scoped to the session's own shop, so a
 * `?course=` or `?site=` from another tenant simply resolves to nothing.
 */
async function requestedCourseAndSite(
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
async function lastYearWeekRead(
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
async function weekAroundRead(
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

/**
 * **The schedule board in one wave** (issue #2757). The upcoming stream is
 * keyset-paged; the week grid is a separate bounded read, and what the week is
 * read beside (its crew, the same week last year) chains onto it. Builder
 * catalog options load lazily when the closed-by-default add panel opens.
 */
export async function getScheduleBoardPage(
  db: AppDb,
  shop: { id: string; crewScheduleEnabled: boolean; timezone: string },
  personId: string,
  input: {
    weekStartIso: CalendarDate;
    now: Date;
    course: string | undefined;
    site: string | undefined;
    requestIds: readonly string[];
  },
) {
  const { weekStartIso, now } = input;
  const canConfigureRead = canPersonConfigureTrips(db, shop.id, personId);
  const weekRead = weekBoard(db, shop.id, weekStartIso, shop.timezone, now);
  const [
    draft,
    range,
    canConfigure,
    openRollCalls,
    shopBoats,
    weekRows,
    weekAsks,
    boatsEverOwned,
    weekAround,
    { requestedCourse, requestedSite },
    requestRows,
    weekConflicts,
  ] = await Promise.all([
    // The reader's own half-typed add panel, if they left one in the last day (ADR
    // 20260906-before-you-ask, decision 3).
    readFormDraft(db, shop.id, personId, "add_departure", now),
    upcomingScheduleRange(db, shop.id, now),
    canConfigureRead,
    // Returned departures with open roll calls are a separate batched backward read; the upcoming
    // stream cannot include them. Read on every cursor page because the independently addressed
    // `?week=` grid still needs them when the stream is paged.
    openAfterDiveRollCalls(db, shop.id, now),
    listBoats(db, shop.id),
    // Bounded `xl` week-grid read (ADR 20260827-clearwater-surface-language, decision 5); unlike
    // the upcoming stream, it includes departures earlier in the selected week.
    weekRead,
    // Requests are bounded to the displayed week (ADR 20260919-one-idea, slice 23f); the separate
    // requests page reads them unbounded.
    listOpenDateInterestsForDates(db, shop.id, weekDates(weekStartIso)),
    // **Names come from every hull the shop has ever had, not just the live ones.** A departure
    // that sailed on a boat the shop has since deleted must still say which vessel (ADR
    // 20260820-every-delete-is-soft). `shopBoats` stays live: it is the picker and the fleet
    // count, and a deleted hull is not a boat this shop has.
    listBoatsForHistory(db, shop.id),
    weekAroundRead(db, shop, weekRead, weekStartIso, now),
    requestedCourseAndSite(db, shop.id, { course: input.course, site: input.site }),
    // Request IDs only feed the add panel, so require its live configuration role and keep the
    // lookup scoped to this shop. Readers without that role receive no request rows.
    input.requestIds.length > 0
      ? canConfigureRead.then((allowed) =>
          allowed ? listDateInterestsByIds(db, shop.id, [...input.requestIds]) : [],
        )
      : [],
    weekConflictsRead(db, shop.id, weekRead, now),
  ]);
  return {
    draft,
    range,
    canConfigure,
    openRollCalls,
    shopBoats,
    weekRows,
    weekAsks,
    boatsEverOwned,
    weekAround,
    requestedCourse,
    requestedSite,
    requestRows,
    weekConflicts,
  };
}
