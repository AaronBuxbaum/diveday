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
