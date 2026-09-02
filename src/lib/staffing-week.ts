import { type CalendarDate, calendarDateInTimezone } from "./calendar-date";
import {
  type AvailabilityBlock,
  blockCoversDay,
  type CrewAssignmentRequest,
  crewRequestRefusal,
  overlappingBlocks,
} from "./crew-requests";
import { weekDates } from "./week-board";

/**
 * **Staffing read as a week** — people down the side, the shop's seven days
 * across the top, and the departures that still need somebody in the day cell
 * where the work actually is.
 *
 * This module must not drift from ADR 20260827-the-shops-shelves, decision 3
 * ("Staffing reads as a week: people as rows, days as columns, shifts as quiet
 * chips; a departure needing crew renders in its day cell with the warning word
 * **and its act**"). It is the assembly half only: pure, framework-free, and
 * reading no wall clock of its own — the caller passes `today` (from
 * `nowDate()`, through the shop's zone) so the frozen e2e clock reaches this
 * the same way it reaches every other surface.
 *
 * **Every bucket is a shop-local day.** A shift is filed under
 * `calendarDateInTimezone(startsAt, shop.timezone)`, never under the host's
 * day: on a UTC CI box a 6:30 PM Key Largo shift starts at 22:30 UTC and a
 * 9:00 PM one starts *tomorrow*, so bucketing by the host would quietly move
 * half a shop's evening work into the next column. The week's own boundaries
 * are the same arithmetic run by the caller, which turns this week's Monday and
 * the following Monday into the UTC instants the reader is scoped by.
 *
 * **A departure is placed by the days it meets, never by `starts_at` alone.**
 * `trips.starts_at`/`ends_at` bound the whole run of a multi-day course, so
 * bucketing by the start put a Thursday-to-Saturday class in one column and
 * dropped a class that began the previous Sunday out of the week it is
 * actually running in. The meeting windows come from `trip_schedule_days` —
 * the same rows the schedule board's week reads for the same reason.
 *
 * The `?week=` grammar itself is not redefined here: it is
 * `src/lib/week-board.ts`, shared with the schedule board (ADR
 * 20260827-clearwater-surface-language, decision 5). One spelling, two
 * surfaces.
 */

/**
 * Why a departure in this week is short-handed, in the vocabulary of the two
 * surfaces that can *fix* it: `courseCrewGap` (src/lib/course-ratios.ts) for
 * the agency training ratio, and `divemasterRatioGap`
 * (src/lib/divemaster-ratio.ts) for the shop's own target, whose two cases
 * Today already words as `uncrewed_departure` and `crew_below_target`.
 *
 * There is deliberately no code for "this departure has no `trip_assignments`
 * row". That is not a judgement about whether anybody is in the water — a
 * captain is a row and supervises nobody, an empty boat is no rows and needs
 * nobody — and having one here is how this surface came to draw an all-clear
 * on a twelve-diver charter with nothing but a captain aboard.
 */
export type StaffGapCode =
  | "no_instructor"
  | "over_ratio"
  | "uncrewed_departure"
  | "crew_below_target";

/**
 * How loudly a gap is drawn — Today's own tone for the same code
 * (`KIND_TONE`, src/lib/today.ts), not a second judgement about the same
 * departure.
 *
 * `crew_below_target` is deliberately quiet: the shop's target "binds
 * nothing" (src/lib/divemaster-ratio.ts), so it is advice rather than a
 * problem, and paying for it in the warning ink this surface reserves for a
 * boat with nobody in the water is how a warning channel stops meaning
 * anything. A code, never copy — the words come from the message bundle.
 */
export const GAP_TONE: Record<StaffGapCode, "warning" | "neutral"> = {
  no_instructor: "warning",
  over_ratio: "warning",
  uncrewed_departure: "warning",
  crew_below_target: "neutral",
};

/** A shift, reduced to what a week cell has to draw. */
export type WeekShift = { id: string; startsAt: Date; endsAt: Date; note: string | null };

/**
 * One window a departure actually meets in.
 *
 * A departure is a *run*, not a point: `trips.starts_at`/`ends_at` bound the
 * whole of a three-day course, and `trip_schedule_days` says which mornings it
 * meets on. The week takes the windows, so a Thursday-to-Saturday class
 * occupies three columns with each day's real hours in it rather than one
 * column claiming the run is an 08:00–17:00 outing.
 */
export type TripMeeting = { startsAt: Date; endsAt: Date };

/** A departure this person is on the crew of, across every day it meets. */
export type WeekCrewing = { tripId: string; title: string; meetings: readonly TripMeeting[] };

/** A departure in this week that still needs somebody. */
export type WeekGap = {
  tripId: string;
  title: string;
  gap: StaffGapCode;
  meetings: readonly TripMeeting[];
};

/**
 * A departure placed in one day cell, carrying that day's own hours.
 *
 * `awayBlocks` are this person's own blackouts that overlap the run (issue
 * #1235). It **informs, never gates**: nobody is taken off a boat, and the
 * owner's assignment is not refused — the week says the crew member told the
 * shop they were away, and the conversation is the shop's to have. Empty for
 * almost every chip.
 */
export type PlacedTrip = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  awayBlocks: readonly AvailabilityBlock[];
};

/**
 * A placed gap: the departure, the day's hours, why it is short, and — since
 * #1235 — who has asked to work it.
 *
 * `viewerMayRequest` is the same rule `crewRequestRefusal` gives the write, so
 * the affordance is never offered for something the transaction will turn down;
 * `viewerRefusal` is why, when there is a reason worth saying.
 */
export type PlacedGap = PlacedTrip & {
  gap: StaffGapCode;
  requests: readonly CrewAssignmentRequest[];
  viewerMayRequest: boolean;
};

/** One person's week, before it is placed into days. */
export type WeekPerson = {
  personId: string;
  name: string;
  roles: readonly string[];
  shifts: readonly WeekShift[];
  crewingTrips: readonly WeekCrewing[];
};

/** A column: the day, and where it sits relative to the shop's own today. */
export type StaffWeekDay = { date: CalendarDate; isToday: boolean; isPast: boolean };

/**
 * One cell of a person's row. **Shifts and crewed departures are kept apart**
 * rather than merged into one list of "things on this day": a person crewing a
 * boat they have no shift for is exactly the state the cross-link exists to
 * make visible (task 165), and merging them would hide it behind a chip that
 * looks like every other chip.
 */
export type StaffWeekPersonDay = {
  date: CalendarDate;
  shifts: WeekShift[];
  crewing: PlacedTrip[];
  /** The blackouts this person has covering this day. Quiet, and theirs alone. */
  away: AvailabilityBlock[];
};

/**
 * A row: the person, and their seven cells.
 *
 * **Everyone on the roster gets a row, including whoever has nothing all
 * week.** A week that quietly drops the people with no shifts answers "who is
 * working" and refuses the other half of the question a manager opens this
 * page with — the empty row is the fact.
 */
export type StaffWeekPerson = {
  personId: string;
  name: string;
  roles: readonly string[];
  days: StaffWeekPersonDay[];
};

/** The gap row's cell for one day. */
export type StaffWeekGapDay = { date: CalendarDate; gaps: PlacedGap[] };

export type StaffWeek = {
  /** Seven days, Monday first, from `weekStart`. */
  days: StaffWeekDay[];
  people: StaffWeekPerson[];
  /** Always seven, aligned with `days`, so the gap row is drawn like any other. */
  gapDays: StaffWeekGapDay[];
  /** Whether the gap row has anything to say. It renders only when it does. */
  hasGaps: boolean;
  /** Whether any shift or crewed departure landed anywhere in the week. */
  hasEntries: boolean;
};

/** The shop-local day something starts on, or `null` when it falls outside the week. */
function dayOf(startsAt: Date, timeZone: string, within: Set<CalendarDate>): CalendarDate | null {
  const date = calendarDateInTimezone(startsAt, timeZone);
  return within.has(date) ? date : null;
}

function byStart(a: { startsAt: Date }, b: { startsAt: Date }): number {
  return a.startsAt.getTime() - b.startsAt.getTime();
}

/**
 * Which of the week's own days one window `[startsAt, endsAt)` covers.
 *
 * Asked of the seven columns rather than walked forward from the window's
 * start, which is what keeps it bounded and total: a run that began weeks ago
 * or has no end anybody typed sensibly cannot spin, and cannot lose the days
 * it does cover to a truncated walk.
 *
 * `endsAt` is exclusive, so a meeting that runs to midnight belongs to the day
 * it started in and not to the one it hands over to. One that genuinely crosses
 * midnight — a night dive back at 00:30 — covers both, which is what the crew's
 * own night looked like.
 */
function daysCovered(
  meeting: TripMeeting,
  timeZone: string,
  dates: readonly CalendarDate[],
): CalendarDate[] {
  const first = calendarDateInTimezone(meeting.startsAt, timeZone);
  const lastMs = meeting.endsAt.getTime() - 1;
  const last =
    Number.isFinite(lastMs) && lastMs > meeting.startsAt.getTime()
      ? calendarDateInTimezone(new Date(lastMs), timeZone)
      : first;
  // Calendar dates are ISO `YYYY-MM-DD`, so the ordering is the string's.
  return dates.filter((date) => date >= first && date <= last);
}

/**
 * Every day of this week a departure covers, each carrying the window it is
 * covered by — the placement both the crewing chips and the gap chips are
 * built from, in the week's own order.
 *
 * A departure is placed by the days it **meets**, never by `startsAt` alone.
 * That single read fixed three things at once: a Thursday-to-Saturday course
 * showed its instructor busy on Thursday and free for the rest of the class; a
 * session that began last Sunday and runs Monday to Wednesday was fetched,
 * counted as needing crew, and then rendered in no column at all; and each
 * chip prints its own day's hours instead of a clock-time range spanning three
 * dates, which is a plain falsehood about the commitment.
 *
 * One chip per day per departure: where two meetings of the same run touch one
 * day, the earlier claims it, because two chips naming one boat is the same
 * fact said twice.
 */
function placements(
  trip: { tripId: string; title: string; meetings: readonly TripMeeting[] },
  timeZone: string,
  dates: readonly CalendarDate[],
  awayBlocks: readonly AvailabilityBlock[] = [],
): { date: CalendarDate; placed: PlacedTrip }[] {
  const byDate = new Map<CalendarDate, PlacedTrip>();
  for (const meeting of [...trip.meetings].sort(byStart)) {
    for (const date of daysCovered(meeting, timeZone, dates)) {
      if (byDate.has(date)) continue;
      byDate.set(date, {
        tripId: trip.tripId,
        title: trip.title,
        startsAt: meeting.startsAt,
        endsAt: meeting.endsAt,
        awayBlocks,
      });
    }
  }
  return dates.flatMap((date) => {
    const placed = byDate.get(date);
    return placed ? [{ date, placed }] : [];
  });
}

/**
 * Place a week's people, their shifts, the departures they crew and the
 * departures nobody crews into seven shop-local days.
 *
 * **A shift is a point; a departure is a run.** A shift is filed by the day it
 * starts on, and one falling outside the week is dropped rather than clamped
 * to an edge column — the reader queries one week at a time, and a shift that
 * leaked in from a query window an hour wide on either side belongs to the
 * week it actually starts in. A departure is placed by every day it *meets*
 * within the week (`placements`), which is a different question and has a
 * different answer: a course that began before this Monday is still running on
 * it.
 */
export function staffWeek(input: {
  people: readonly WeekPerson[];
  gaps: readonly WeekGap[];
  weekStart: CalendarDate;
  timeZone: string;
  /** The shop's own calendar date — from `nowDate()` through the shop's zone. */
  today: CalendarDate;
  /** Every live blackout touching this week, whoever's (issue #1235). */
  blocks?: readonly AvailabilityBlock[];
  /** Live requests against this week's departures. */
  requests?: readonly CrewAssignmentRequest[];
  /**
   * Who is reading, and what the page will let them do. Absent on a caller
   * that has no viewer to speak of — every test written before #1235, and the
   * assembly's own unit tests.
   */
  viewer?: { personId: string; isCrew: boolean };
  /** The instant `crewRequestRefusal` measures a sailed departure against. */
  now?: Date;
}): StaffWeek {
  const blocks = input.blocks ?? [];
  const requests = input.requests ?? [];
  const now = input.now ?? new Date(0);
  const dates = weekDates(input.weekStart);
  const within = new Set(dates);
  const days: StaffWeekDay[] = dates.map((date) => ({
    date,
    isToday: date === input.today,
    isPast: date < input.today,
  }));

  let hasEntries = false;
  const people: StaffWeekPerson[] = input.people.map((person) => {
    const shiftsByDay = new Map<CalendarDate, WeekShift[]>();
    for (const shift of person.shifts) {
      const date = dayOf(shift.startsAt, input.timeZone, within);
      if (!date) continue;
      shiftsByDay.set(date, [...(shiftsByDay.get(date) ?? []), shift]);
    }
    // Every day the departure meets in, not just the one it starts on: a
    // person teaching a Thursday-to-Saturday course is busy on all three, and
    // a week that says otherwise is what double-books them onto a boat.
    const crewingByDay = new Map<CalendarDate, PlacedTrip[]>();
    for (const trip of person.crewingTrips) {
      // The warning word an overlapping blackout earns, resolved once per
      // departure rather than per column: it is a fact about the run.
      const away = overlappingBlocks(blocks, person.personId, trip.meetings, input.timeZone);
      for (const { date, placed } of placements(trip, input.timeZone, dates, away)) {
        crewingByDay.set(date, [...(crewingByDay.get(date) ?? []), placed]);
      }
    }
    const ownBlocks = blocks.filter((block) => block.personId === person.personId);
    const personDays = dates.map((date) => ({
      date,
      shifts: (shiftsByDay.get(date) ?? []).sort(byStart),
      crewing: (crewingByDay.get(date) ?? []).sort(byStart),
      away: ownBlocks.filter((block) => blockCoversDay(block, date)),
    }));
    if (
      personDays.some(
        (day) => day.shifts.length > 0 || day.crewing.length > 0 || day.away.length > 0,
      )
    ) {
      hasEntries = true;
    }
    return {
      personId: person.personId,
      name: person.name,
      roles: person.roles,
      days: personDays,
    };
  });

  // **The first day of the run this week can see, and only that one.** A crew
  // gap is a fact about the departure, not about each of its mornings —
  // `trip_assignments` is per trip, so one Assign fixes the whole run — and
  // drawing the same warning in three columns would be principle 9's
  // wallpaper. Taking the *first visible* meeting rather than the run's own
  // first day is what puts a course that began last Sunday on this week's
  // Monday instead of nowhere.
  const gapsByDay = new Map<CalendarDate, PlacedGap[]>();
  const crewIdsByTrip = new Map<string, string[]>();
  for (const person of input.people) {
    for (const trip of person.crewingTrips) {
      crewIdsByTrip.set(trip.tripId, [...(crewIdsByTrip.get(trip.tripId) ?? []), person.personId]);
    }
  }
  for (const gap of input.gaps) {
    const [first] = placements(gap, input.timeZone, dates);
    if (!first) continue;
    const tripRequests = requests.filter((request) => request.tripId === gap.tripId);
    const viewer = input.viewer;
    // The same rule the write applies, evaluated here so the affordance is
    // never offered for something the transaction will refuse.
    const viewerMayRequest = Boolean(
      viewer?.isCrew &&
        crewRequestRefusal({
          personId: viewer.personId,
          meetings: gap.meetings,
          crewPersonIds: crewIdsByTrip.get(gap.tripId) ?? [],
          livePendingOrDecidedPersonIds: tripRequests.map((request) => request.personId),
          blocks,
          timeZone: input.timeZone,
          now,
        }) === null,
    );
    gapsByDay.set(first.date, [
      ...(gapsByDay.get(first.date) ?? []),
      { ...first.placed, gap: gap.gap, requests: tripRequests, viewerMayRequest },
    ]);
  }
  const gapDays = dates.map((date) => ({
    date,
    gaps: (gapsByDay.get(date) ?? []).sort(byStart),
  }));

  return {
    days,
    people,
    gapDays,
    hasGaps: gapDays.some((day) => day.gaps.length > 0),
    hasEntries,
  };
}
