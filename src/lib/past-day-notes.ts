import { type CalendarDate, calendarDateInTimezone } from "./calendar-date";
import type { StationClose } from "./closeout";

/**
 * **What a past day's station adds to the evening's reading** (issue #2662's
 * review). The home's evening speaks about today, so it can leave three facts
 * unsaid that a day read days later cannot:
 *
 * - `crewNotCounted`: crew sailed and the closing count never took them.
 * - `countedLaterOn`: the closing mark fell on a later shop day, so a bare
 *   time would read as that evening.
 * - `notBackDive`: a diver was once recorded not back after this dive and
 *   later resolved; the roll call holds the record. A diver still missing is
 *   the station's headline already, so it is not repeated.
 */
export type PastDayStationNotes = {
  countedLaterOn: CalendarDate | null;
  crewNotCounted: boolean;
  notBackDive: number | null;
};

export function pastDayStationNotes({
  close,
  day,
  timeZone,
  closedAt,
  notBackDive,
}: {
  close: StationClose;
  day: CalendarDate;
  timeZone: string;
  /** The closing roll call mark, if one was made. */
  closedAt: Date | null;
  /** `listNotBackAfterDive` for this trip. */
  notBackDive: number | null;
}): PastDayStationNotes {
  const countedOn = closedAt ? calendarDateInTimezone(closedAt, timeZone) : null;
  return {
    countedLaterOn: countedOn && countedOn > day ? countedOn : null,
    crewNotCounted:
      close.status !== "not_departed" && close.crewSailed > 0 && !close.crewAccountedFor,
    notBackDive: close.gapReason === "missing_diver" ? null : notBackDive,
  };
}
