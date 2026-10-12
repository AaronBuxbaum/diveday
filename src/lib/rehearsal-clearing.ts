import { DAY_MS } from "./clock";
import { FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS } from "./fly-safe";
import { addCalendarDays, utcToWallTime, wallTimeToUtc } from "./zoned";

/** The fewest whole days a rehearsal stays on the board after it comes home. */
export const REHEARSAL_KEPT_DAYS = FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS + 1;

/**
 * **When the nightly delete may take a rehearsal** (ADR
 * 20261012-rehearsal-departures). Both must hold:
 *
 * 1. **A full night has passed in the shop's zone**: the rehearsal was due
 *    home before the start of yesterday there. The cron ticks at 03:15 UTC,
 *    which is mid-afternoon east of UTC, and a boat due home at noon is often
 *    still out; the scheduled end is a plan, not a landing.
 * 2. **No later departure's fly-safe still reads it.** A test diver who dives
 *    Saturday's rehearsal and Sunday's real boat has dived two days, and
 *    `peopleWhoDivedBefore` reads deleted departures as no day at all. So the
 *    rehearsal stays until the look-back
 *    ({@link FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS}) plus a day has run out.
 *
 * Today the second clause always outlasts the first; the first stays so that
 * shortening the look-back cannot bring the afternoon delete back.
 */
export function rehearsalMayClear(endsAt: Date, now: Date, timeZone: string): boolean {
  const today = { ...utcToWallTime(now, timeZone), hour: 0, minute: 0 };
  const yesterdayStarts = wallTimeToUtc(addCalendarDays(today, -1), timeZone);
  const lookBackEnds = endsAt.getTime() + REHEARSAL_KEPT_DAYS * DAY_MS;
  // diveday:allow-departure-offset: whole days and a local night, far past any late return.
  return endsAt.getTime() < yesterdayStarts.getTime() && lookBackEnds <= now.getTime();
}
