import { nowDate, nowMs } from "@/lib/clock";
import { toDateInputValue, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";

/**
 * The seed's clock.
 *
 * Every date the demo data lands on is computed here, from `nowMs()`/`nowDate()`
 * (`src/lib/clock.ts`) and never from a direct wall-clock read. That is what
 * lets the e2e fleet freeze one instant and get a pixel-identical demo shop on
 * every run: the
 * boat that sails "today", the cert that lapsed last month, and the row order on
 * a roster all move together with `DIVEDAY_CLOCK`, or all stay put without it.
 *
 * `nextCreatedAt`'s counter is module state on purpose — one counter for the
 * whole seed, so the strictly-increasing stamps it hands out are unique across
 * every scenario module, not just within one.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export const DEMO_SHOP_TIMEZONE = "America/New_York";

/**
 * n days from now at the given hour/minute **in the demo shop's own timezone**.
 *
 * This used to set UTC hours, which is not what any caller meant: the shop is
 * in America/New_York, so `at(1, 7)` — written to mean an early boat — sailed
 * at 3:00 AM on every screen that renders it, and the "Sunset Two-Tank" left at
 * noon. Anchoring to the shop's wall clock makes the hour a caller writes the
 * hour a diver reads.
 *
 * The day is the shop's calendar day `daysFromNow` out, resolved before the
 * hour is applied, so a departure lands on the day its caller counted to even
 * when the hour sits either side of UTC midnight.
 */
export function at(daysFromNow: number, hour: number, minute = 0): Date {
  const day = utcToWallTime(new Date(nowMs() + daysFromNow * DAY_MS), DEMO_SHOP_TIMEZONE);
  return wallTimeToUtc({ ...day, hour, minute }, DEMO_SHOP_TIMEZONE);
}

/**
 * n days from now as a date-only "YYYY-MM-DD" (demo cert expiries, CR-009).
 * Uses the UTC calendar date, not the demo shop's own timezone — fine for the
 * multi-week-out/lapsed values seeded today, but do not use this for a
 * boundary-adjacent value (e.g. "expires today") without switching to
 * `calendarDateInTimezone` first.
 */
export function dateAt(daysFromNow: number): string {
  return new Date(nowMs() + daysFromNow * DAY_MS).toISOString().slice(0, 10);
}

/**
 * A birth date chosen so the diver turns exactly `age` on the day `inDays` from
 * the seeded clock — exact calendar arithmetic, not `dateAt`'s day-count
 * approximation, because a birthday callout is precisely the boundary-adjacent
 * case that helper warns against. Anchored to the shop's own timezone so the
 * rendered age and "turns N in 2 days" stay pixel-stable across visual runs.
 */
export function birthDateTurning(age: number, inDays: number): string {
  const wall = utcToWallTime(new Date(nowMs() + inDays * DAY_MS), DEMO_SHOP_TIMEZONE);
  return `${String(wall.year - age).padStart(4, "0")}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
}

/**
 * Distinct, clock-anchored `createdAt` stamps for seed rows whose render
 * order depends on insertion order (a trip roster, a diver's card history).
 * Left to the column's `defaultNow()`, every row in the same multi-row
 * INSERT ties on one transaction-start instant — real wall-clock time, not
 * `DIVEDAY_CLOCK` — and Postgres does not promise a stable order for ties,
 * so which diver renders first drifts between runs. Handing out strictly
 * increasing instants removes the tie.
 */
let seedClockTick = 0;
export function nextCreatedAt(): Date {
  seedClockTick += 1;
  return new Date(nowMs() + seedClockTick);
}

/**
 * Anchored to the clock rather than the calendar so one seeded trip always
 * sails *today*, whatever time the demo is opened. Today's departure board is
 * the first thing staff see, and a demo that never has a boat out cannot show
 * it. Always in the future, so it never falls out of the upcoming schedule.
 */
export function hoursFromNow(hours: number, from = nowDate()): Date {
  const d = new Date(from.getTime() + hours * 60 * 60 * 1000);
  // Round up to the next half hour: dive boats leave at 7:30, not 7:49, and a
  // ragged time reads as a bug in every screenshot of the demo.
  const step = 30 * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / step) * step);
}

/**
 * Start of the seeded departure that must sail *today in the shop's timezone*.
 * Within five hours of local midnight the plain now+5h offset rounds into
 * tomorrow, which empties the departure board the demo (and the Today tests)
 * are built around — so it clamps to the last half-hour slot that still sails
 * today. Even in the final half hour before local midnight, when no
 * half-hour-rounded slot is left, this still returns a same-day moment (the
 * earliest still-future instant) rather than concede to tomorrow: "today
 * always has a board" has no exception.
 */
export function demoTodayDepartureStart(
  now = nowDate(),
  timeZone: string = DEMO_SHOP_TIMEZONE,
): Date {
  const localDay = (date: Date) => toDateInputValue(utcToWallTime(date, timeZone));
  const candidate = hoursFromNow(5, now);
  if (localDay(candidate) === localDay(now)) return candidate;
  const lastSlotToday = wallTimeToUtc(
    { ...utcToWallTime(now, timeZone), hour: 23, minute: 30 },
    timeZone,
  );
  if (lastSlotToday.getTime() > now.getTime()) return lastSlotToday;
  const wall = utcToWallTime(now, timeZone);
  const midnight = wallTimeToUtc({ ...wall, day: wall.day + 1, hour: 0, minute: 0 }, timeZone);
  return new Date(Math.min(now.getTime() + 60 * 1000, midnight.getTime() - 1000));
}
