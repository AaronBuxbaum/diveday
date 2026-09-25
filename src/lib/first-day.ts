import { type CalendarDate, calendarDateInTimezone, shiftCalendarDate } from "./calendar-date";

/**
 * **The first day a new shop opens onto** — the one boat and one departure the
 * onboard form optionally asks for, judged before `src/db/first-day.ts` turns
 * them into rows.
 *
 * Framework-free and pure: the form's bounds, the `HH:MM` parse, and the
 * arithmetic that puts the departure on tomorrow's board.
 */

/**
 * The longest boat name the form carries back across a bounce. A longer typed
 * name is not truncated — it simply is not echoed, and the owner retypes it.
 */
export const MAX_FIRST_DAY_NAME = 60;

/** `HH:MM` on a 24-hour clock — what `<input type="time">` submits. */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const MINUTES_IN_DAY = 24 * 60;

/**
 * How long the first departure runs. The schedule builder's own blank form
 * opens at 08:30–12:30, so a departure drawn from one typed time inherits that
 * four hours rather than inventing a second answer to the same question
 * (`ScheduleBuilder.tsx`'s `startBlank`).
 */
export const FIRST_DEPARTURE_HOURS = 4;

/**
 * How many seats the first boat gets, since the form asks for a name and not a
 * number.
 *
 * **Six, deliberately low.** Capacity is not decoration here: it is the ceiling
 * every gate downstream defends, through waivers, cert checks and the manifest,
 * and on a US uninspected vessel six passengers is a legal line
 * (`tripDetailsPatch`'s hull check exists for exactly that). A guessed number
 * that is too high sells seats a shop cannot legally fill; one that is too low
 * costs a shop thirty seconds in the boat register. There is only one safe
 * direction to guess in.
 *
 * **Nothing asks the shop to confirm it, and that is a decision** (owner,
 * 2026-09-10, issue #1632). The shop meets the number where it means
 * something: "6 seats" on its first departure, corrected in the boat register
 * in the thirty seconds named above. Because the guess can only ever be too
 * low, a prompt would buy the shop speed and never safety.
 */
export const FIRST_BOAT_CAPACITY = 6;

/**
 * A typed name, as it is carried: the inner runs of whitespace collapsed, the
 * ends trimmed, and control characters refused outright. Returns null for
 * anything that is not a name a shop would sign.
 */
export function parseFirstDayName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  // Control characters, including the newline a paste can carry: a name is one
  // line. `\p{C}` also covers the invisible formatting characters that make two
  // different strings paint identically.
  if (/\p{C}/u.test(input)) return null;
  const name = input.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_FIRST_DAY_NAME) return null;
  return name;
}

/** `HH:MM`, or null. Anything else — a bare hour, "7:30 AM", "25:00" — is junk. */
export function parseDepartureTime(input: unknown): string | null {
  if (typeof input !== "string") return null;
  return TIME_PATTERN.test(input.trim()) ? input.trim() : null;
}

/** Minutes since local midnight for an `HH:MM` already parsed. */
function departureMinutes(time: string): number | null {
  const match = TIME_PATTERN.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * The day the first departure lands on: **tomorrow in the shop's own zone**,
 * never today. A shop set up at 9 AM has already missed a 7:30 boat, and a
 * departure in the past on the first Today is a worse welcome than no
 * departure at all.
 */
export function firstDepartureDay(now: Date, timeZone: string): CalendarDate {
  return shiftCalendarDate(calendarDateInTimezone(now, timeZone), 1);
}

/**
 * The end of that first departure — the start plus {@link FIRST_DEPARTURE_HOURS},
 * held inside the same calendar day.
 *
 * The clamp is not cosmetic: `tripDetailsPatch` parses a departure's start and
 * end against **one** date, so a 9 PM start with a four-hour run would produce
 * an end before its start and the departure would simply not be created. A late
 * boat gets a short day on the board instead of no boat at all, and the shop
 * moves it in the builder.
 *
 * **And at the very end of the day there is no room left to clamp into.** A
 * 23:59 departure clamps to an end equal to its own start, which
 * `tripDetailsPatch` refuses as `end_before_start` — so this says no here
 * instead, and `createFirstDay` writes neither the departure nor the boat.
 */
export function firstDepartureEndTime(start: string): string | null {
  const minutes = departureMinutes(start);
  if (minutes === null) return null;
  const end = Math.min(minutes + FIRST_DEPARTURE_HOURS * 60, MINUTES_IN_DAY - 1);
  if (end <= minutes) return null;
  const hour = Math.floor(end / 60);
  return `${String(hour).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

/**
 * The form's two optional first-day fields, judged once. Each is independent:
 * junk in one loses that field and keeps the other, because neither is
 * required to open a shop.
 *
 * Every input is `unknown` because a `searchParams` value is `string |
 * string[]` and a `FormData` value is a string or a `File`; a repeated
 * parameter or an uploaded file is taken as neither.
 */
export function parseFirstDayFields(params: { boat?: unknown; departure?: unknown }): {
  boatName: string | null;
  departure: string | null;
} {
  return {
    boatName: parseFirstDayName(params.boat),
    departure: parseDepartureTime(params.departure),
  };
}
