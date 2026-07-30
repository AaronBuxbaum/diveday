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

/** The oldest age that is still a minor. Eighteen is majority, so this is 17. */
export const MINOR_AGE_CEILING = 17;

/**
 * Whether a diver is a minor on a given date.
 *
 * Eighteen, not the diving world's 15. This flag exists because a minor's
 * liability waiver may need a guardian signature (H-21), which is a question of
 * legal majority in the shop's jurisdiction — Florida at launch (H-01). The
 * *diving* restrictions on under-15s are a separate rule and travel through the
 * junior depth bands in `depth-ceiling.ts`, so the two never have to agree.
 *
 * Florida's age of majority is hard-coded here in the sense that 18 is: the day
 * DiveDay opens in a jurisdiction that differs, this becomes shop-configured
 * rather than a constant, and this comment is the marker for that work.
 */
export function isMinorOnDate(dateOfBirth: CalendarDate, onDate: CalendarDate): boolean {
  return ageOnDate(dateOfBirth, onDate) <= MINOR_AGE_CEILING;
}

/**
 * How many days until a diver's next birthday, counted on the calendar rather
 * than in elapsed time — a birthday lands on the same day in every timezone.
 * Returns 0 on the day itself.
 */
export function daysUntilBirthday(dateOfBirth: CalendarDate, onDate: CalendarDate): number {
  const [year, month, day] = onDate.split("-").map(Number);
  const birthMonth = Number(dateOfBirth.slice(5, 7));
  const birthDay = Number(dateOfBirth.slice(8, 10));

  // Date.UTC normalises the arithmetic; both operands are date-only, so no
  // instant, offset, or DST transition is involved in the difference.
  const today = Date.UTC(year, month - 1, day);
  // Feb 29 on a common year has no date to land on, so `Date.UTC` rolls it to
  // Mar 1 — the same day a leap-year birthday is conventionally observed.
  let next = Date.UTC(year, birthMonth - 1, birthDay);
  if (next < today) next = Date.UTC(year + 1, birthMonth - 1, birthDay);
  return Math.round((next - today) / 86_400_000);
}

/**
 * How many days since a diver's most recent birthday, counted on the calendar.
 * Returns 0 on the day itself — the mirror of `daysUntilBirthday`.
 */
export function daysSinceBirthday(dateOfBirth: CalendarDate, onDate: CalendarDate): number {
  const [year, month, day] = onDate.split("-").map(Number);
  const birthMonth = Number(dateOfBirth.slice(5, 7));
  const birthDay = Number(dateOfBirth.slice(8, 10));

  const today = Date.UTC(year, month - 1, day);
  let previous = Date.UTC(year, birthMonth - 1, birthDay);
  if (previous > today) previous = Date.UTC(year - 1, birthMonth - 1, birthDay);
  return Math.round((today - previous) / 86_400_000);
}

/**
 * How far a birthday counts as worth mentioning, in **either direction**
 * (H-21, product owner chose seven days each way). Looking back matters as much
 * as looking ahead: a diver whose birthday was on Tuesday is still worth a
 * shout-out on Saturday's boat, and the crew has no other way to know.
 */
export const BIRTHDAY_WINDOW_DAYS = 7;

export type BirthdayCallout =
  | { status: "today" }
  | { status: "soon"; inDays: number }
  | { status: "recent"; daysAgo: number };

/**
 * The celebratory callout for a diver on a trip, or null when there is nothing
 * to celebrate. Carries only *when* — the age they turn is deliberately absent,
 * because the badge this feeds says the whole thing with an icon and a
 * relative day count, and a roster is already dense enough.
 */
export function birthdayCallout(
  dateOfBirth: CalendarDate | null | undefined,
  onDate: CalendarDate,
  windowDays: number = BIRTHDAY_WINDOW_DAYS,
): BirthdayCallout | null {
  if (!dateOfBirth) return null;
  const inDays = daysUntilBirthday(dateOfBirth, onDate);
  if (inDays === 0) return { status: "today" };
  if (inDays <= windowDays) return { status: "soon", inDays };
  const daysAgo = daysSinceBirthday(dateOfBirth, onDate);
  if (daysAgo <= windowDays) return { status: "recent", daysAgo };
  return null;
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
