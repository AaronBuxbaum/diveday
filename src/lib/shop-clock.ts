/**
 * **The shop's clock**: one frozen value, minted once per request, that every
 * "what time is it *here*" question reads.
 *
 * Before this, a surface carried two loose values, `now: Date` and
 * `timeZone: string`, and re-derived the shop's day from them wherever it
 * needed one: `calendarDateInTimezone(now, tz)` here, `shopDayBounds(now, tz)`
 * there, and a coarse ±26-hour scan for the one query that asked about the
 * shop's calendar date. Each derivation was correct; nothing said they were
 * derived from the *same* instant, and the scan was a second, looser
 * definition of "today" beside the exact one.
 *
 * A `ShopClock` is that pair plus the answers built from it, computed once:
 *
 * - `now` — the instant (from `nowDate()`, so the e2e harness can freeze it).
 * - `timeZone` — the shop's IANA zone.
 * - `today` — the shop's calendar date at `now`.
 * - `day` — the exact UTC pair bracketing that date: `from` inclusive, `to`
 *   exclusive (`shopDayBounds`, DST-safe). "Today's departures" is
 *   `startsAt >= day.from && startsAt < day.to`, in SQL, with no second pass.
 * - `wall` — the shop's wall-clock time at `now`.
 * - `maySend(kind)` — whether a guest message of that kind may go out now, in
 *   the shop's waking hours (`maySendNow`, `src/lib/send-window.ts`).
 *
 * The grammar: a surface has a clock (`requireShopSurface` returns one beside
 * the shop row), a per-shop cron loop mints one per shop, and a domain function
 * takes a clock rather than a `(now, timeZone)` twin.
 *
 * The value is frozen, so nothing downstream can move one surface's "now"
 * without moving them all.
 */

import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { maySendNow, type SendableKind } from "@/lib/send-window";
import { shopDayBounds, utcToWallTime, type WallTime } from "@/lib/zoned";

export type ShopClock = Readonly<{
  /** The instant this clock was minted at. */
  now: Date;
  /** The shop's IANA time zone. */
  timeZone: string;
  /** The shop's calendar date at `now`. */
  today: CalendarDate;
  /** The shop's calendar day at `now`, as UTC instants: `from` inclusive, `to` exclusive. */
  day: Readonly<{ from: Date; to: Date }>;
  /** The shop's wall-clock time at `now`. */
  wall: Readonly<WallTime>;
  /** Whether a guest message of `kind` may be sent now, in the shop's waking hours. */
  maySend: (kind: SendableKind) => boolean;
}>;

/** Mints the clock for a shop. `now` defaults to the application clock. */
export function shopClock(shop: { timezone: string }, now: Date = nowDate()): ShopClock {
  const timeZone = shop.timezone;
  const instant = new Date(now.getTime());
  const bounds = shopDayBounds(instant, timeZone);
  return Object.freeze({
    now: instant,
    timeZone,
    today: calendarDateInTimezone(instant, timeZone),
    day: Object.freeze({ from: bounds.from, to: bounds.to }),
    wall: Object.freeze(utcToWallTime(instant, timeZone)),
    maySend: (kind: SendableKind) => maySendNow(kind, instant, timeZone),
  });
}
