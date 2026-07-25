import { type CalendarDate, calendarDateInTimezone } from "./calendar-date";
import { nowDate } from "./clock";

/** Nobody diving today was born before this. A date under it is a typo, not a diver. */
const OLDEST_PLAUSIBLE_BIRTH_YEAR = 1900;

/**
 * A cheap typo guard on the one field where a slip is silently punitive: a
 * future date of birth yields a *negative* age, so `2062-03-04` for `1962-03-04`
 * turns the fail-open gate into a hard refusal on every age-gated course, with
 * nothing on screen explaining why. Rejecting it at the form is the boring fix.
 * This is plausibility, not verification — the dock-side ID check is the control.
 */
export function isPlausibleDateOfBirth(dateOfBirth: CalendarDate, now: Date = nowDate()): boolean {
  const year = Number(dateOfBirth.slice(0, 4));
  if (year < OLDEST_PLAUSIBLE_BIRTH_YEAR) return false;
  return dateOfBirth <= maxPlausibleBirthDate(now);
}

/**
 * The upper bound `isPlausibleDateOfBirth` enforces, also handed to the date
 * input's `max` so the browser refuses the typo before the round trip. It is
 * the furthest-ahead timezone's "today" (UTC+14), not the server's: a shop in
 * Kiritimati entering a real birth date on their own calendar is not
 * committing a typo, and a day of slack is a cheaper error than refusing them.
 */
export function maxPlausibleBirthDate(now: Date = nowDate()): CalendarDate {
  return calendarDateInTimezone(now, "Pacific/Kiritimati");
}

/**
 * Whole years old on a given calendar date. Both dates are date-only
 * (`YYYY-MM-DD`), so this is plain calendar arithmetic with no timezone or
 * instant involved — a birthday lands on the same day everywhere.
 */
export function ageOnDate(dateOfBirth: CalendarDate, onDate: CalendarDate): number {
  const birthYear = Number(dateOfBirth.slice(0, 4));
  const onYear = Number(onDate.slice(0, 4));
  // "MM-DD" sorts chronologically as a string, so this is the whole
  // "has their birthday happened yet this year?" test.
  const hadBirthday = onDate.slice(5) >= dateOfBirth.slice(5);
  return onYear - birthYear - (hadBirthday ? 0 : 1);
}

/**
 * Whether a diver meets a course's minimum age *on the day the course runs* —
 * not the day they book. A 14-year-old booking a 15+ course three months out
 * for a date after their birthday is eligible, and pinning the check to the
 * booking date would wrongly refuse them.
 *
 * `unknown` is its own outcome rather than a boolean, because the caller's
 * fail-open decision (H-08, option B: no date on file never blocks) is a
 * product policy, not something to bake into the arithmetic. Encoding it here
 * would make a future fail-closed switch a silent one-character edit.
 */
export type MinimumAgeCheck =
  | { status: "unknown" }
  | { status: "meets"; age: number }
  | { status: "under"; age: number; minimumAge: number };

export function checkMinimumAge(
  dateOfBirth: CalendarDate | null | undefined,
  minimumAge: number | null | undefined,
  onDate: CalendarDate,
): MinimumAgeCheck {
  if (!dateOfBirth || !minimumAge) return { status: "unknown" };
  const age = ageOnDate(dateOfBirth, onDate);
  return age >= minimumAge ? { status: "meets", age } : { status: "under", age, minimumAge };
}
