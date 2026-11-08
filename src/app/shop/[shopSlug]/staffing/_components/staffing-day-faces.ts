import type { StaffWeekDay } from "@/features/staffing-week";
import { calendarDateToUtcMidnight } from "@/lib/calendar-date";
import { formatDayParts, formatShortDate } from "@/lib/format";

/**
 * The week's seven column heads, for the screen's grid and the printed rota
 * alike. A day is a calendar date, so it is labelled at UTC midnight and never
 * shifted by a zone; shift instants are formatted in the shop's zone elsewhere.
 */
export function weekDayFaces(days: readonly StaffWeekDay[], locale: string) {
  return days.map((day) => {
    const instant = calendarDateToUtcMidnight(day.date);
    const parts = formatDayParts(instant, locale, "UTC");
    return { ...day, ...parts, label: formatShortDate(instant, locale, "UTC") };
  });
}
