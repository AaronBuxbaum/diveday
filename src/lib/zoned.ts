/**
 * Wall-clock time in an IANA timezone → UTC instant, without a timezone
 * library. Staff schedule trips in the shop's local time (shops.timezone);
 * storage is always UTC (docs/architecture/overview.md). Boring and
 * unit-tested on purpose — schedule math is operationally critical.
 */

import type { MonthRef } from "./calendar";
import { cachedFormatter } from "./intl-cache";

export type WallTime = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
};

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    cachedFormatter("dt", Intl.DateTimeFormat, "en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24, // Intl reports midnight as "24" in some engines
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/**
 * Interpret a wall-clock time as local time in `timeZone`. Two-pass offset
 * refinement handles DST transitions; a nonexistent wall time (spring-forward
 * gap) resolves *forward* by the gap length — 02:30 on a 2am→3am night is
 * 03:30, the same reading Temporal's "compatible" disambiguation gives. An
 * ambiguous wall time (fall-back repeat) keeps the two-pass result unchanged.
 *
 * The forward resolution is load-bearing, not cosmetic: `shopDayBounds` feeds
 * this midnight, and in a zone whose spring-forward jump happens *at* midnight
 * (America/Santiago, America/Havana, Atlantic/Azores' spring side) the
 * two-pass result alone lands an hour *before* the jump — which reads as
 * 23:00 of the *previous* day, silently leaking yesterday's last hour into
 * "today" and dropping the 23:30 boat from the day it actually sails
 * (src/lib/zoned-hostile.test.ts pins both directions).
 */
export function wallTimeToUtc(wall: WallTime, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const offsetAtNaive = tzOffsetMs(new Date(naive), timeZone);
  const offset = tzOffsetMs(new Date(naive - offsetAtNaive), timeZone);
  const candidate = naive - offset;
  // A wall time that exists reads back with the offset it was computed from.
  if (tzOffsetMs(new Date(candidate), timeZone) === offset) return new Date(candidate);
  // Spring-forward gap: of the two candidate instants (one per bracketing
  // offset), the later one sits at-or-after the jump in every zone — east or
  // west of UTC — and reads as the wall time shifted forward by the gap.
  return new Date(Math.max(candidate, naive - offsetAtNaive));
}

/** Wall-clock parts of a UTC instant in `timeZone` — the inverse of wallTimeToUtc. */
export function utcToWallTime(date: Date, timeZone: string): WallTime {
  const parts = Object.fromEntries(
    cachedFormatter("dt", Intl.DateTimeFormat, "en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/**
 * Adds `days` calendar days to a wall date, keeping hour/minute unchanged and
 * rolling month/year over as needed. Pure calendar arithmetic — no timezone
 * involved, since a `WallTime` is already a local wall-clock reading.
 */
export function addCalendarDays(wall: WallTime, days: number): WallTime {
  const shifted = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day + days, wall.hour, wall.minute),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/**
 * The exact UTC instants that bracket the shop's own calendar day containing
 * `now` — `from` inclusive, `to` exclusive.
 *
 * This is the *precise* pair, unlike `shopDayWindow` in
 * `src/lib/operational-window.ts`: that one is a deliberately loose net for
 * queries whose caller then re-checks each row's shop-local date in JS. A
 * filter that has to narrow a `COUNT(*)` and its page identically has no such
 * second pass, so it needs bounds that are already right — computed here, on
 * the same DST-safe wall-clock conversion everything else in this file uses.
 */
export function shopDayBounds(now: Date, timeZone: string): { from: Date; to: Date } {
  const wall = utcToWallTime(now, timeZone);
  const midnight = { ...wall, hour: 0, minute: 0 };
  return {
    from: wallTimeToUtc(midnight, timeZone),
    to: wallTimeToUtc(addCalendarDays(midnight, 1), timeZone),
  };
}

/** A day's worth of milliseconds, for stepping a walk rather than measuring one. */
const MS_PER_DAY = 86_400_000;

/**
 * Every top-of-the-hour inside a shop's own day, as the instant *and* the hour
 * a clock on the wall reads at it.
 *
 * **A day does not always have 24 hours in it.** On the day a zone springs
 * forward it has 23, and the hour that vanished has no instant at all:
 * {@link wallTimeToUtc} resolves 2 AM forward, so asking it for hours 0-23 in
 * New York on 2026-03-08 answers `… 1, 3, 3, 4 …` — the third and fourth
 * requests are the *same instant*, and the entry at position two is three
 * o'clock. A caller that treats position as the hour is wrong from there to
 * midnight, and a caller that keys a list by the instant has two identical
 * keys. On the day it falls back there are 25, and the repeated hour resolves
 * to whichever of the two `wallTimeToUtc` picks; one boundary per clock hour is
 * what a reader wants either way.
 *
 * So the hour is read back *from the instant* rather than assumed, and a
 * repeated instant is dropped. The result is in order, and every entry's `hour`
 * is what a person standing in the shop would say it is.
 *
 * **It walks every calendar day the window touches, not just the first.** The
 * name says "day" because the first caller passed a shop's own day, and the
 * body took that literally: it built hours on the wall date of `from` alone, so
 * a window running 10 PM to 10 AM answered `22, 23` and nothing after midnight
 * (found by review on the departure page, whose voyage strip drew no ticks past
 * midnight — and the demo shop ships a three-day charter). Bounds that span
 * several days get several days of boundaries; a caller that wants four of them
 * across a long window is what `dayStripTicks` is for.
 */
export function dayHourBoundaries(
  bounds: { from: Date; to: Date },
  timeZone: string,
): { at: Date; hour: number }[] {
  const from = bounds.from.getTime();
  const to = bounds.to.getTime();
  const seen = new Set<number>();
  const boundaries: { at: Date; hour: number }[] = [];
  let wall = utcToWallTime(bounds.from, timeZone);
  // One pass per calendar day the window covers, plus one: a window ending at
  // 00:30 on its last day still has that day's midnight in it, and the `+ 2`
  // is the cheap way to say "and the day the end falls on" without a second
  // date comparison. Every hour is clamped to the bounds anyway, so an extra
  // pass adds nothing but a few discarded candidates.
  const days = Math.ceil(Math.max(0, to - from) / MS_PER_DAY) + 2;
  for (let day = 0; day < days; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const at = wallTimeToUtc({ ...wall, hour, minute: 0 }, timeZone);
      const instant = at.getTime();
      if (instant < from || instant >= to) continue;
      if (seen.has(instant)) continue;
      seen.add(instant);
      boundaries.push({ at, hour: utcToWallTime(at, timeZone).hour });
    }
    // Step a calendar day from **noon**, never from midnight: on a spring-
    // forward day midnight plus 24 hours lands at 11 PM the same date, and the
    // walk would repeat a day and never reach the end of the window.
    const noon = wallTimeToUtc({ ...wall, hour: 12, minute: 0 }, timeZone).getTime();
    wall = utcToWallTime(new Date(noon + MS_PER_DAY), timeZone);
  }
  return boundaries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * The exact UTC instants that bracket the shop's own calendar *month* —
 * `from` inclusive, `to` exclusive. The monthly sibling of
 * {@link shopDayBounds}, on the same wall-clock conversion.
 *
 * A month is a wall-clock date range in the shop's zone, never a UTC instant
 * range, and this is the classic silent bug in a monthly export. In Key Largo
 * (UTC-4 in summer) July opens at 04:00Z on 1 July and closes at 04:00Z on
 * 1 August: bracket it in UTC instead and the 1st's dawn charter falls into
 * June while the 31st's night dive falls out of July altogether. Both sheets
 * still add up, so nobody ever notices.
 *
 * `wallTimeToUtc` carries the DST handling, so a month whose first midnight
 * is skipped or repeated by a clock change resolves the same way every other
 * boundary in this file does.
 */
export function shopMonthBounds(month: MonthRef, timeZone: string): { from: Date; to: Date } {
  const next =
    month.month === 12 ? { year: month.year + 1, month: 1 } : { ...month, month: month.month + 1 };
  return {
    from: wallTimeToUtc({ ...month, day: 1, hour: 0, minute: 0 }, timeZone),
    to: wallTimeToUtc({ ...next, day: 1, hour: 0, minute: 0 }, timeZone),
  };
}

/**
 * Shifts a UTC instant by `days` calendar days while preserving its
 * wall-clock time in `timeZone` — moving a multi-day trip by whole days
 * without drifting its published times across a DST transition, unlike
 * adding a fixed millisecond delta (which drifts by the DST offset change).
 */
export function shiftInstantByCalendarDays(date: Date, days: number, timeZone: string): Date {
  if (days === 0) return date;
  return wallTimeToUtc(addCalendarDays(utcToWallTime(date, timeZone), days), timeZone);
}

/**
 * Wall-clock delta between two wall times, in milliseconds — pure calendar
 * arithmetic on the local reading itself (no timezone/DST involved, since a
 * `WallTime` is already what a clock on the wall would show).
 */
export function wallTimeDeltaMs(from: WallTime, to: WallTime): number {
  const fromMs = Date.UTC(from.year, from.month - 1, from.day, from.hour, from.minute);
  const toMs = Date.UTC(to.year, to.month - 1, to.day, to.hour, to.minute);
  return toMs - fromMs;
}

/**
 * Shifts a UTC instant by a wall-clock delta (from `wallTimeDeltaMs`) while
 * staying DST-safe: the delta is applied to `date`'s own wall-clock reading,
 * not its raw UTC instant, so the whole-day part of the delta moves the
 * calendar date without drifting the hour across a DST transition, and any
 * sub-day remainder — a genuine time-of-day change, e.g. a trip moved to a
 * new start *time* — shifts the hour/minute exactly as requested. This is
 * what lets `moveTrip`/`duplicateTrip` (`src/db/trips.ts`) keep a departure's
 * duration intact when its start time also changes, while a multi-day
 * course's later days, which only ever carry the whole-day part of the
 * delta, keep their own published wall-clock hour across a DST transition.
 */
export function shiftInstantByWallTimeDelta(date: Date, deltaMs: number, timeZone: string): Date {
  if (deltaMs === 0) return date;
  const wall = utcToWallTime(date, timeZone);
  const shifted = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) + deltaMs,
  );
  return wallTimeToUtc(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
    },
    timeZone,
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-07-18" — value for an HTML date input. */
export function toDateInputValue(wall: WallTime): string {
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** "07:30" — value for an HTML time input. */
export function toTimeInputValue(wall: WallTime): string {
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** Parse an HTML date input ("2026-07-18") + time input ("07:30"). */
export function parseWallTime(dateValue: string, timeValue: string): WallTime | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;
  const wall: WallTime = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31) return null;
  if (wall.hour > 23 || wall.minute > 59) return null;
  return wall;
}

/**
 * A UTC instant written as the shop's own wall clock with its offset —
 * `2026-07-25T07:30:00-04:00` — the one ISO shape that carries both the
 * moment and the zone it was read in. A bare `.toISOString()` is honest but
 * ends in `Z`, and a reader that is not a person (an agent composing "leaves
 * at 7:30") would have to know the shop's zone to say the time the way the
 * dock says it; this spells it for them. Seconds are always `00`: departures
 * are scheduled to the minute.
 */
export function zonedIsoString(date: Date, timeZone: string): string {
  const offsetMs = tzOffsetMs(date, timeZone);
  const wall = new Date(date.getTime() + offsetMs).toISOString().slice(0, 16);
  const offsetMinutes = Math.round(Math.abs(offsetMs) / 60_000);
  const sign = offsetMs < 0 ? "-" : "+";
  return `${wall}:00${sign}${pad(Math.floor(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
}
