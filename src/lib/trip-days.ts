/**
 * Multi-day departures: the consecutive meeting days one trip holds.
 *
 * `trip_schedule_days` has always been able to describe a departure that meets
 * on more than one day — the trip page prints a meeting-day list, the schedule
 * board badges a day count, `moveTrip` slides every day together, and crew
 * double-booking is checked day by day. Nothing could ever *create* one: every
 * write path fell through to the single implicit day `insertTripInstance`
 * mints from `startsAt`/`endsAt`, so an Open Water weekend or a three-day
 * liveaboard had to be put on the board as unrelated one-off trips that share
 * a title and nothing else — separate rosters, separate waivers, separate
 * crew.
 *
 * A trip's days are the same wall-clock window, on consecutive calendar days
 * unless the shop names the dates. Consecutive is the boring default: it is
 * what a course weekend and a multi-day charter look like, it survives a DST
 * boundary (the wall time is what a shop promises, so 08:30 stays 08:30 either
 * side of the change — `addCalendarDays` moves the calendar date, not a fixed
 * 24 hours), and a day that genuinely differs is edited on its own afterwards.
 *
 * **A date per day, when the days are not consecutive** (third UX review,
 * item 10). An Open Water course for working adults meets Sat/Sun, Sat/Sun,
 * Sat, and as consecutive days it had to go on the board as three unrelated
 * trips: three rosters, three prep links per student, three recaps, and a
 * certify on whichever roster was last. Named dates keep it one trip, one
 * roster, one certify. Each later date must come after the one before it and
 * within {@link MAX_TRIP_SPAN_DAYS} of day one; anything else is refused,
 * never reordered, because a reordered course is not the one the shop typed.
 *
 * **For now, no gaps** ({@link MAX_MEETING_DAY_GAP_DAYS}). Today, the open roll
 * call, check-in and boarding read a departure's day as its one
 * `startsAt`..`endsAt` window, not its `trip_schedule_days`, so a course on
 * Saturday and the Saturday after would read as a boat on the water with an
 * open roll call all week, and would not be today's departure on day two.
 * Gaps open when those read the meeting days.
 */

import { type CalendarDate, calendarDaysBetween, isValidCalendarDate } from "./calendar-date";
import { addCalendarDays, type WallTime } from "./zoned";

/** A departure meets on at least one day, by definition. */
export const MIN_TRIP_DAYS = 1;

/**
 * A fortnight. Long enough for every liveaboard and course itinerary a dive
 * shop schedules as one departure, short enough that a typo in the box cannot
 * silently mint a year of meeting days.
 */
export const MAX_TRIP_DAYS = 14;

/**
 * Six weeks from day one to the last day: room for a course that meets over
 * several weekends, short enough that a mistyped year cannot stretch one
 * departure across a season.
 */
export const MAX_TRIP_SPAN_DAYS = 42;

/**
 * The most calendar days one meeting day may come after the one before it.
 * One, so a departure's days run back to back, until every reader of "the
 * boat is out" and "today's departure" reads `trip_schedule_days` rather than
 * the departure's one window (see the module comment). The builder and the
 * edit form offer a date per later day only once this is more than one.
 * Typed `number`, so raising it is the one change.
 */
export const MAX_MEETING_DAY_GAP_DAYS: number = 1;

/** One meeting day as wall time in the shop's own zone. */
export type MeetingDayWall = { start: WallTime; end: WallTime };

/** Whether `value` is a day count a trip may actually carry. */
export function isTripDayCount(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_TRIP_DAYS && value <= MAX_TRIP_DAYS;
}

/**
 * The `dayCount` consecutive meeting days a trip runs, given the wall-clock
 * window of its first day. Returns `null` rather than a guess for a day count
 * outside the supported range — the caller refuses the whole submission, so a
 * forged form can never write a trip whose day rows disagree with its own
 * `startsAt`/`endsAt`.
 *
 * Day 1 is always the window it was handed back, unchanged: a one-day trip
 * through here is exactly the trip it would have been without it.
 */
export function tripMeetingDays(day: MeetingDayWall, dayCount: number): MeetingDayWall[] | null {
  if (!isTripDayCount(dayCount)) return null;
  return Array.from({ length: dayCount }, (_, offset) => ({
    start: addCalendarDays(day.start, offset),
    end: addCalendarDays(day.end, offset),
  }));
}

export type MeetingDaysResult =
  | { ok: true; days: MeetingDayWall[] }
  | { ok: false; reason: "invalid" | "days_out_of_order" };

const dateOf = (wall: WallTime): CalendarDate =>
  `${String(wall.year).padStart(4, "0")}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;

/**
 * The meeting days a submission asks for: `dayCount` consecutive days when
 * `laterDates` is empty, otherwise day one plus one named date for each later
 * day. Every day keeps day one's wall-clock window; a window that ends after
 * midnight ends on the morning after its own date, as day one's does.
 *
 * `invalid` is a count out of range, a date that does not exist, or a list
 * whose length disagrees with the count (a forged or stale form).
 * `days_out_of_order` is a later date on or before the day before it, more
 * than {@link MAX_MEETING_DAY_GAP_DAYS} after it, or more than
 * {@link MAX_TRIP_SPAN_DAYS} after day one: something the staffer can fix by
 * looking at the dates, so it gets its own sentence.
 */
export function meetingDaysFor(
  day: MeetingDayWall,
  dayCount: number,
  laterDates: readonly string[] = [],
): MeetingDaysResult {
  if (laterDates.length === 0) {
    const days = tripMeetingDays(day, dayCount);
    return days ? { ok: true, days } : { ok: false, reason: "invalid" };
  }
  if (!isTripDayCount(dayCount) || laterDates.length !== dayCount - 1) {
    return { ok: false, reason: "invalid" };
  }
  if (!laterDates.every((date) => isValidCalendarDate(date))) {
    return { ok: false, reason: "invalid" };
  }
  const first = dateOf(day.start);
  let previous = first;
  const days: MeetingDayWall[] = [day];
  for (const date of laterDates) {
    const step = calendarDaysBetween(previous, date);
    if (step < 1 || step > MAX_MEETING_DAY_GAP_DAYS) {
      return { ok: false, reason: "days_out_of_order" };
    }
    const offset = calendarDaysBetween(first, date);
    if (offset > MAX_TRIP_SPAN_DAYS) return { ok: false, reason: "days_out_of_order" };
    days.push({
      start: addCalendarDays(day.start, offset),
      end: addCalendarDays(day.end, offset),
    });
    previous = date;
  }
  return { ok: true, days };
}

/**
 * The later days' dates of a stored departure, for the edit form: empty when
 * the days are consecutive (the count says it all), otherwise one date per
 * day after the first, read in the shop's zone.
 */
export function laterMeetingDates(dayStarts: readonly CalendarDate[]): CalendarDate[] {
  const [first, ...rest] = dayStarts;
  if (!first || rest.length === 0) return [];
  const consecutive = rest.every((date, index) => calendarDaysBetween(first, date) === index + 1);
  return consecutive ? [] : rest;
}
