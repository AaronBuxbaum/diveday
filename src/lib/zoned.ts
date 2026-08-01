/**
 * Wall-clock time in an IANA timezone → UTC instant, without a timezone
 * library. Staff schedule trips in the shop's local time (shops.timezone);
 * storage is always UTC (docs/architecture/overview.md). Boring and
 * unit-tested on purpose — schedule math is operationally critical.
 */

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
    new Intl.DateTimeFormat("en-US", {
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
 * gap) resolves to the instant after the jump.
 */
export function wallTimeToUtc(wall: WallTime, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let offset = tzOffsetMs(new Date(naive), timeZone);
  offset = tzOffsetMs(new Date(naive - offset), timeZone);
  return new Date(naive - offset);
}

/** Wall-clock parts of a UTC instant in `timeZone` — the inverse of wallTimeToUtc. */
export function utcToWallTime(date: Date, timeZone: string): WallTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
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

/** Whole calendar days between two wall dates' date parts, ignoring time-of-day. */
export function calendarDayDelta(from: WallTime, to: WallTime): number {
  const fromUtc = Date.UTC(from.year, from.month - 1, from.day);
  const toUtc = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toUtc - fromUtc) / 86_400_000);
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
