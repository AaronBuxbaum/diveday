import { type CalendarDate, calendarDaysBetween } from "@/lib/calendar-date";

/** How many surface-interval tips the `shopHome.quietTip` bundle holds (`quietTip.0` to the last). */
export const QUIET_DAY_TIP_COUNT = 6;

/**
 * **One tip a day for a quiet day** (issue #4263): a line a crew member can use
 * on the dock, by the shop's own calendar day, so it holds still all day and
 * moves on tomorrow. A pure function of the day: nothing is stored, nothing is
 * read, and the same day is the same tip on every screen.
 */
export function quietDayTipIndex(day: CalendarDate): number {
  const days = calendarDaysBetween("2026-01-01" as CalendarDate, day);
  return ((days % QUIET_DAY_TIP_COUNT) + QUIET_DAY_TIP_COUNT) % QUIET_DAY_TIP_COUNT;
}
