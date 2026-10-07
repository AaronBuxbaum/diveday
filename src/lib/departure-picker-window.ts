import {
  type CalendarDate,
  calendarDateInTimezone,
  isValidCalendarDate,
  shiftCalendarDate,
} from "./calendar-date";
import { wallTimeToUtc } from "./zoned";

/**
 * How many shop days the Add-a-booking picker shows at once: today and
 * tomorrow by default, because "someone just called" is almost always about
 * the next boat or the one after it (UX audit 2026-10-07, item 19). The
 * global door used to page through every upcoming departure, 48 of them over
 * three pages with no way to jump to a date.
 */
export const DEPARTURE_PICKER_WINDOW_DAYS = 2;

export type DeparturePickerWindow = {
  /** The shop's today. */
  today: CalendarDate;
  /** The first day shown: `?from=` when it is today or later, else today. */
  day: CalendarDate;
  /** The instant the window starts: now on today, the day's midnight later. */
  start: Date;
  /** The instant after the window's last day: midnight, `WINDOW_DAYS` on. */
  end: Date;
  /** The `from` of the window before this one, or null on today's. */
  earlier: CalendarDate | null;
  /** The `from` of the window after this one. */
  later: CalendarDate;
};

function midnight(date: CalendarDate, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return wallTimeToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone);
}

/**
 * The days the picker shows, in the shop's zone, from an untrusted `?from=`.
 *
 * A missing, malformed or past date reads as today: the picker books seats,
 * and a departure that has already sailed has none to sell. Today's window
 * starts *now*, not at midnight, for the same reason — the boat that left at
 * 8 is not a place a 2 PM caller can be put. Midnights come from
 * `wallTimeToUtc`, so a 9 PM Key Largo departure files under its own day on a
 * UTC server, and a spring-forward midnight does not leak the day before.
 */
export function departurePickerWindow({
  now,
  timeZone,
  from,
}: {
  now: Date;
  timeZone: string;
  from: string | null | undefined;
}): DeparturePickerWindow {
  const today = calendarDateInTimezone(now, timeZone);
  const day = from && isValidCalendarDate(from) && from > today ? from : today;
  const later = shiftCalendarDate(day, DEPARTURE_PICKER_WINDOW_DAYS);
  const back = shiftCalendarDate(day, -DEPARTURE_PICKER_WINDOW_DAYS);
  return {
    today,
    day,
    start: day === today ? now : midnight(day, timeZone),
    end: midnight(later, timeZone),
    earlier: day === today ? null : back > today ? back : today,
    later,
  };
}
