import { toDateInputValue, utcToWallTime } from "./zoned";

/**
 * The shop-local date of `now` as "YYYY-MM-DD" — the day the evening is about.
 * The same reading `src/features/today/today-reader.ts`'s `shopDay` makes, through the same
 * DST-safe wall-clock conversion (`src/lib/zoned.ts`).
 */
export function shopDayOf(now: Date, timeZone: string): string {
  return toDateInputValue(utcToWallTime(now, timeZone));
}
