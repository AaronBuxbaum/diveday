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
 * A trip's days are the same wall-clock window on consecutive calendar days.
 * That is deliberately the boring shape: it is what a course weekend and a
 * multi-day charter actually look like, it survives a DST boundary (the wall
 * time is what a shop promises, so 08:30 stays 08:30 either side of the
 * change — `addCalendarDays` moves the calendar date, not a fixed 24 hours),
 * and a day that genuinely differs is edited on its own afterwards.
 */

import { addCalendarDays, type WallTime } from "./zoned";

/** A departure meets on at least one day, by definition. */
export const MIN_TRIP_DAYS = 1;

/**
 * A fortnight. Long enough for every liveaboard and course itinerary a dive
 * shop schedules as one departure, short enough that a typo in the box cannot
 * silently mint a year of meeting days.
 */
export const MAX_TRIP_DAYS = 14;

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
