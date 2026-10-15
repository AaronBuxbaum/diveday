import { type CalendarDate, calendarDateToUtcMidnight } from "@/lib/calendar-date";
import { formatShortDate } from "@/lib/format";

/**
 * **The days somebody said they are away, in words**: "Sat, Oct 17 – Sun, Oct
 * 18", or one date when the range is one day, several ranges joined by commas.
 *
 * One reader for every surface that says it (fourth review, item 12): the
 * staffing week's chip, the schedule board's crew line, the Today row and the
 * reader's own session card. The staffing week was the only place that said
 * it, so a second copy of this formatting would have been the first chance
 * for two surfaces to disagree about which days a person is away.
 *
 * Calendar dates, not instants: a day away is the same date in every zone, so
 * it is formatted at UTC midnight and never shifted by the shop's offset.
 */
export function awayDatesText(
  blocks: readonly { startsOn: CalendarDate; endsOn: CalendarDate }[],
  locale: string,
): string {
  const day = (date: CalendarDate) =>
    formatShortDate(calendarDateToUtcMidnight(date), locale, "UTC");
  return blocks
    .map((block) =>
      block.startsOn === block.endsOn
        ? day(block.startsOn)
        : `${day(block.startsOn)} – ${day(block.endsOn)}`,
    )
    .join(", ");
}
