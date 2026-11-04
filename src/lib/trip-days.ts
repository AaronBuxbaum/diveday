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
 *
 * **Read from the meeting days so far** (#2557): today's departure (the
 * boarding door, ⌘K, the shop-day cards, the print sheet), Today's own cards,
 * the blocked-divers badge and the horizon that feeds them
 * (`meetsOnShopDay`, `byMeetingDay`). **Still the one window**: the open roll
 * call and "the boat is out" (`listRollCallGaps`, `blockedAboardOnBoatsOut`),
 * check-in, readiness, `/ready`, closeout and help requests; the cap stays
 * until they move.
 */

import { type CalendarDate, calendarDaysBetween, isValidCalendarDate } from "./calendar-date";
import { hasReturned } from "./trips";
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

/**
 * **Whether a departure meets on a shop day** (#2557): one of its meeting days
 * starts inside `day`, the exact pair of instants around the shop's calendar
 * date (`ShopClock.day`). A departure with no day rows on file is read from
 * its one window, as it always was.
 *
 * This is "today's departure" for a course that meets on Saturday and the
 * Saturday two weeks on: it is today's on both Saturdays and on none of the
 * days between, which `trips.starts_at` alone cannot say.
 */
export function meetsOnShopDay(
  trip: { startsAt: Date },
  meetingDays: readonly { startsAt: Date }[],
  day: { from: Date; to: Date },
): boolean {
  const within = (instant: Date) => instant >= day.from && instant < day.to;
  return meetingDays.length > 0
    ? meetingDays.some((d) => within(d.startsAt))
    : within(trip.startsAt);
}

/** One meeting day's real window (`trip_schedule_days`), as instants. */
export type DayWindow = { startsAt: Date; endsAt: Date };

/**
 * A departure's meeting days in order, or its one window when it has no day
 * rows on file. Every reader of "which day is it" reads this list, so a plain
 * one-day trip is one day whose window is the trip's own.
 */
export function meetingDayWindows(
  trip: DayWindow,
  meetingDays: readonly DayWindow[] | undefined,
): DayWindow[] {
  if (!meetingDays || meetingDays.length === 0) {
    return [{ startsAt: trip.startsAt, endsAt: trip.endsAt }];
  }
  return [...meetingDays].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * **Which meeting day a roll-call result belongs to** (#2557). Checkpoints are
 * keyed per booking (`departure`, `after_dive_1`, ...), not per day, so day
 * one's "back aboard after dive 1" and day two's are the same key. Read
 * against the whole run, Saturday's count would answer for the Saturday two
 * weeks on, and day two's dive could never open a count at all.
 *
 * So each result belongs to one meeting day by when it was taken: day one
 * owns everything before day two's boundary, and each later day owns
 * everything from its boundary to the next one. A boundary sits halfway
 * between the end of the day before and the start of the day it opens, never
 * after that start: a late dock count on Saturday evening stays Saturday's,
 * and Sunday's boarding count before the boat leaves is Sunday's. A one-day
 * trip has one day and no boundary, so it reads exactly as before.
 *
 * Returns each day's first instant in milliseconds; day one's is `-Infinity`.
 */
export function rollCallDayStarts(windows: readonly DayWindow[]): number[] {
  return windows.map((day, index) => {
    const before = windows[index - 1];
    if (!before) return Number.NEGATIVE_INFINITY;
    const start = day.startsAt.getTime();
    const halfway = (before.endsAt.getTime() + start) / 2;
    return Math.min(start, halfway);
  });
}

/** The index of the meeting day an instant's roll-call result belongs to. */
export function rollCallDayOf(dayStarts: readonly number[], instant: Date): number {
  const at = instant.getTime();
  let day = 0;
  for (let index = 1; index < dayStarts.length; index++) {
    if (at >= (dayStarts[index] ?? Number.POSITIVE_INFINITY)) day = index;
  }
  return day;
}

/**
 * Where the roll call a manifest shows now begins: the boundary of the meeting
 * day whose results are being taken, or `null` on day one (everything counts).
 * Between two meeting days the earlier one's record stays on screen until the
 * halfway point, then the later day's count starts empty.
 */
export function rollCallRecordSince(windows: readonly DayWindow[], now: Date): Date | null {
  const starts = rollCallDayStarts(windows);
  const day = rollCallDayOf(starts, now);
  return day === 0 ? null : new Date(starts[day] as number);
}

/**
 * **Whether the boat is out on a meeting day** (#2557): a day's window has
 * started and its return buffer has not passed (`hasReturned`). Between two
 * meeting days nobody is on the water, however long the run's own
 * `starts_at`..`ends_at` window is.
 */
export function onTheWaterDay(windows: readonly DayWindow[], now: Date): DayWindow | null {
  return (
    windows.find(
      (day) => day.startsAt.getTime() <= now.getTime() && !hasReturned(day.endsAt, now),
    ) ?? null
  );
}
