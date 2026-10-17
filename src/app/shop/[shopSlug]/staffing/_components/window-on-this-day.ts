import { fill } from "@/i18n/fill";
import { formatTime, formatTimeRange, formatWeekday } from "@/lib/format";
import type { PlacedTrip } from "@/lib/staffing-week";
import type { StaffingWeekWords } from "./StaffingWeek";

/**
 * **What a departure's window is on this column's day.** The day it starts it
 * is the range (or, for a gap's narrow cell, the start alone); a later day of
 * an overnight window says when it ends and the day it began, so the 3:00 AM
 * tail of Monday's night boat never reads as Tuesday's own 11:30 PM sailing.
 */
export function windowOnThisDay(
  trip: PlacedTrip,
  words: StaffingWeekWords,
  locale: string,
  timeZone: string,
  shape: "range" | "start",
): string {
  if (trip.continuesFrom !== null) {
    const day = formatWeekday(trip.startsAt, locale, timeZone);
    return trip.endsThisDay
      ? fill(words.continuedUntil, { time: formatTime(trip.endsAt, locale, timeZone), day })
      : fill(words.continuedFrom, { day });
  }
  return shape === "range"
    ? formatTimeRange(trip.startsAt, trip.endsAt, locale, timeZone)
    : formatTime(trip.startsAt, locale, timeZone);
}
