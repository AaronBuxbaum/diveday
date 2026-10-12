import { formatTime } from "@/lib/format";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";

/** The shop's own calendar day an instant falls on, as a `YYYY-MM-DD` string. */
export function shopDay(date: Date, timeZone: string): string {
  return toDateInputValue(utcToWallTime(date, timeZone));
}

/** A departure's time of day on the shop's own clock, in the reader's words. */
export function at(date: Date, timeZone: string, locale: string): string {
  return formatTime(date, locale, timeZone);
}
