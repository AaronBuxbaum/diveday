import type { Role } from "./authz";
import { addCalendarDays, utcToWallTime, type WallTime, wallTimeToUtc } from "./zoned";

/**
 * **The desk's hours, and the after-hours ping** (Aaron, 2026-10-09, D4).
 *
 * A diver who writes in at 22:00 waits until somebody opens the Inbox in the
 * morning. Staff who asked to hear get one email saying how many divers wrote
 * in, and a link to the Inbox. This module is the rule, framework-free:
 *
 * - the shop's own desk hours, one window every day in the shop's own zone
 *   (`shops.desk_opens_minute`, `shops.desk_closes_minute`);
 * - who wants the ping (`afterHoursPingWanted`): the staffer's own answer, or
 *   their role's default;
 * - the batching clock (`AFTER_HOURS_PING_INTERVAL_MS`): at most one ping per
 *   person per interval, whatever arrives in it.
 *
 * The ping itself carries a count and a link, never a sender or a word of the
 * message (`src/db/desk-pings.ts`).
 */

/** Minutes after shop-local midnight: opens inclusive, closes exclusive. */
export type DeskHours = { opensMinute: number; closesMinute: number };

/** 08:00–18:00, the schema's own default. */
export const DEFAULT_DESK_HOURS: DeskHours = { opensMinute: 8 * 60, closesMinute: 18 * 60 };

const MINUTES_IN_DAY = 24 * 60;

/**
 * Half an hour. Short enough that a diver's question at 19:05 and another at
 * 19:50 reach somebody twice, long enough that a group chat's worth of
 * messages in a minute is one email.
 */
export const AFTER_HOURS_PING_INTERVAL_MS = 30 * 60_000;

function minuteOfDay(wall: WallTime): number {
  return wall.hour * 60 + wall.minute;
}

/** Whether `at` falls outside the desk's hours, in the shop's own wall clock. */
export function isAfterHours(at: Date, timeZone: string, hours: DeskHours): boolean {
  const minute = minuteOfDay(utcToWallTime(at, timeZone));
  return minute < hours.opensMinute || minute >= hours.closesMinute;
}

/** The instant the desk closed on the wall day `day`, which may be the next midnight. */
function closingOn(day: WallTime, timeZone: string, hours: DeskHours): Date {
  const atMidnight = hours.closesMinute >= MINUTES_IN_DAY;
  const date = atMidnight ? addCalendarDays(day, 1) : day;
  const minute = atMidnight ? 0 : hours.closesMinute;
  return wallTimeToUtc({ ...date, hour: Math.floor(minute / 60), minute: minute % 60 }, timeZone);
}

/**
 * When the desk last closed, at or before `at` — the start of the stretch whose
 * messages an after-hours ping counts. Evening is today's closing; the small
 * hours are yesterday's.
 */
export function deskClosedSince(at: Date, timeZone: string, hours: DeskHours): Date {
  const wall = utcToWallTime(at, timeZone);
  const today = closingOn(wall, timeZone, hours);
  return today.getTime() <= at.getTime()
    ? today
    : closingOn(addCalendarDays(wall, -1), timeZone, hours);
}

/**
 * Whether this person gets the ping: their own answer when they gave one,
 * otherwise their role's default — on for the owner and a manager, who answer
 * the desk's messages; off for crew, who did not ask to hear about them.
 */
export function afterHoursPingWanted(choice: boolean | null, roles: readonly Role[]): boolean {
  return choice ?? (roles.includes("owner") || roles.includes("manager"));
}

/** `"HH:MM"` as a time input submits it, to minutes after midnight. */
export function parseDeskTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * The two times a shop saved, or null when they are not a day's window with
 * the opening first. An overnight desk (opens 20:00, closes 02:00) is refused
 * rather than guessed at: nobody keeps one, and the schema holds the same rule
 * (`shops_desk_hours_in_day`).
 */
export function parseDeskHours(opens: unknown, closes: unknown): DeskHours | null {
  const opensMinute = parseDeskTime(opens);
  const closesMinute = parseDeskTime(closes);
  if (opensMinute === null || closesMinute === null) return null;
  if (opensMinute >= closesMinute) return null;
  return { opensMinute, closesMinute };
}

/** Minutes after midnight as a time input's `"HH:MM"` value. */
export function deskTimeValue(minute: number): string {
  const hour = Math.floor(minute / 60);
  const rest = minute % 60;
  return `${String(hour).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** The instant a desk time falls at on `now`'s shop-local day — for formatting it as a time. */
export function deskTimeOn(minute: number, now: Date, timeZone: string): Date {
  const wall = utcToWallTime(now, timeZone);
  return wallTimeToUtc({ ...wall, hour: Math.floor(minute / 60), minute: minute % 60 }, timeZone);
}
