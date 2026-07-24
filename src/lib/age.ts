import type { CalendarDate } from "./calendar-date";

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
