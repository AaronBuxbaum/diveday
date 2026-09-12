import { type CalendarDate, calendarDateWeekday, isValidCalendarDate } from "./calendar-date";
import { formatMoneyScanned, formatTime, weekdayNames } from "./format";
import { cachedFormatter } from "./intl-cache";
import { currencyFractionDigits, majorToMinor, maxPriceMajor } from "./money";
import { CALLING_CODES } from "./phone";

/**
 * "Type it any way": what a field makes of what a person would say out loud.
 *
 * ADR 20260906-before-you-ask, decision 3. Each reader takes the raw text a
 * staffer typed and answers with the **canonical** value the form will submit
 * plus the **label** the field shows in its place, or `null` when it cannot
 * read the text — in which case the field leaves the text exactly as typed and
 * the server refuses it on save (`Field`'s `error`), never a silent guess.
 *
 * Pure and framework-free so every specimen on the canvas's Fields board is a
 * table test here, in both locales. Nothing in this module touches the
 * never-list (`NEVER_FORGIVING_FIELD_NAMES`): a certification card number, a
 * head count, a tank pressure, a nitrox mix, a depth, a medical answer and the
 * emergency contact's name are typed exactly and validated on save, because a
 * helpful guess on any of them is a wrong number on a safety document.
 */
export type TypedReading<T extends string = string> = {
  /** What the form submits. */
  canonical: T;
  /** What the field shows once the reading is taken. */
  label: string;
};

/**
 * Field names that may never be wired to a forgiving reader. Held by
 * `forgiving-fields.never-list.test.ts`, which scans every `<ForgivingInput`
 * in the tree and fails on a `name` from this list. The list is by *name*
 * rather than by kind because the kinds are harmless (a phone, a time) and the
 * danger is entirely in which fact the value lands on.
 */
export const NEVER_FORGIVING_FIELD_NAMES = [
  "cardNumber",
  "certificationNumber",
  "certificationLevel",
  "certificationAgency",
  "agency",
  "level",
  "headCount",
  "seats",
  "capacity",
  "tankPressure",
  "o2Percent",
  "nitroxMix",
  "maxDepth",
  "maximumDepth",
  "emergencyContactName",
] as const;

const NEVER_FORGIVING_PREFIXES = ["medical", "questionnaire"] as const;

/** Whether a form field name is on the never-list (exact, or a medical prefix). */
export function isNeverForgivingFieldName(name: string): boolean {
  if ((NEVER_FORGIVING_FIELD_NAMES as readonly string[]).includes(name)) return true;
  const lower = name.toLowerCase();
  return NEVER_FORGIVING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Time of day

const TIME_RE = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/i;

/**
 * "7" is 7:00 AM, "1p" and "13" and "1:00 pm" are 1:00 PM, "7.30" is 7:30 AM.
 * A bare hour under twelve with no meridiem is morning, because that is what
 * the desk means on a dive boat; "12" is noon. The canonical form is the
 * `HH:MM` a `<input type="time">` would have submitted, so the server sees no
 * difference between the two.
 */
export function readTypedTime(raw: string, locale = "en-US"): TypedReading | null {
  const match = TIME_RE.exec(raw.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "p" && hour !== 12) hour += 12;
    if (meridiem === "a" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  const canonical = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { canonical, label: formatWallTime(canonical, locale) };
}

/** The label a `HH:MM` wall-clock time reads as, for the field's settled state. */
export function formatWallTime(canonical: string, locale = "en-US"): string {
  const [hour, minute] = canonical.split(":").map(Number);
  return formatTime(new Date(Date.UTC(2000, 0, 1, hour, minute)), locale, "UTC");
}

// ---------------------------------------------------------------------------
// Calendar date

function shiftDate(date: CalendarDate, days: number): CalendarDate {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * The weekday names a locale uses, long and short, lower-cased and stripped of
 * the trailing period some locales print ("sáb." in Spanish).
 */
function weekdayLookup(locale: string): Array<{ day: number; names: string[] }> {
  const long = weekdayNames(locale, "short");
  const full = Array.from({ length: 7 }, (_, day) =>
    cachedFormatter("dt", Intl.DateTimeFormat, locale, { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 7 + day)),
    ),
  );
  return long.map((short, day) => ({
    day,
    names: [short, full[day] ?? short].map((name) => name.toLowerCase().replace(/\.$/, "")),
  }));
}

function monthFirst(locale: string): boolean {
  const parts = cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).formatToParts(new Date(Date.UTC(2024, 0, 15)));
  const monthIndex = parts.findIndex((part) => part.type === "month");
  const dayIndex = parts.findIndex((part) => part.type === "day");
  return monthIndex < dayIndex;
}

/**
 * "sat" is the next Saturday (never today, and never a day already gone),
 * "9/12" is the next 12 September in a month-first locale and the next 9
 * December in a day-first one, and an ISO date passes as it is. The weekday
 * match takes any prefix of three letters or more, in the reader's language,
 * so "sáb" lands for a shop in Cozumel.
 */
export function readTypedDate(
  raw: string,
  today: CalendarDate,
  locale = "en-US",
): TypedReading<CalendarDate> | null {
  const text = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!text) return null;
  if (isValidCalendarDate(text)) return { canonical: text, label: formatTypedDate(text, locale) };
  const todayWeekday = calendarDateWeekday(today);
  if (/^\p{L}{3,}$/u.test(text)) {
    for (const { day, names } of weekdayLookup(locale)) {
      if (names.some((name) => name.startsWith(text))) {
        const ahead = (day - todayWeekday + 7) % 7 || 7;
        const date = shiftDate(today, ahead);
        return { canonical: date, label: formatTypedDate(date, locale) };
      }
    }
    return null;
  }
  const numeric = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(text);
  if (!numeric) return null;
  const first = Number(numeric[1]);
  const second = Number(numeric[2]);
  const [month, day] = monthFirst(locale) ? [first, second] : [second, first];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const todayYear = Number(today.slice(0, 4));
  const year = numeric[3]
    ? numeric[3].length === 2
      ? 2000 + Number(numeric[3])
      : Number(numeric[3])
    : todayYear;
  const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!isValidCalendarDate(candidate)) return null;
  // A month-and-day with no year means the next time it comes round.
  const date = !numeric[3] && candidate < today ? shiftYear(candidate) : candidate;
  return isValidCalendarDate(date)
    ? { canonical: date, label: formatTypedDate(date, locale) }
    : null;
}

function shiftYear(date: CalendarDate): string {
  return `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
}

/** "Sat, Aug 29" — the weekday always beside the date, because that is the word the desk thinks in. */
export function formatTypedDate(date: CalendarDate, locale = "en-US"): string {
  const [year, month, day] = date.split("-").map(Number);
  return cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

// ---------------------------------------------------------------------------
// Phone

function groupNorthAmerican(national: string): string {
  return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}

function groupInThrees(national: string): string {
  const groups: string[] = [];
  let rest = national;
  while (rest.length > 4) {
    groups.push(rest.slice(0, 3));
    rest = rest.slice(3);
  }
  groups.push(rest);
  return groups.join(" ");
}

/**
 * Ten digits in a Florida shop is a US number; a leading + is taken as
 * written; spaces, dots, dashes and parentheses are ignored. Fewer than seven
 * digits is not a phone number and is left as typed.
 *
 * This is the *grouped* reading, for a person to check with their eyes. The
 * same rules without the spaces, for the value the row stores, are `toE164`
 * in `src/lib/phone.ts`, which shares this module's `CALLING_CODES`.
 */
export function readTypedPhone(
  raw: string,
  country: string | null | undefined,
): TypedReading | null {
  const text = raw.trim();
  if (!text) return null;
  const international = text.startsWith("+") || text.startsWith("00");
  const digits = text.replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 7 || digits.length > 15) return null;
  const home = CALLING_CODES[(country ?? "").toUpperCase()];
  if (international) {
    if (digits.startsWith("1") && digits.length === 11) {
      return reading(`+1 ${groupNorthAmerican(digits.slice(1))}`);
    }
    // The longest calling code we know that prefixes the digits, else the
    // first two digits — enough to keep the country in front of the rest.
    const code =
      Object.values(CALLING_CODES)
        .filter((candidate) => digits.startsWith(candidate))
        .sort((a, b) => b.length - a.length)[0] ?? digits.slice(0, 2);
    return reading(`+${code} ${groupInThrees(digits.slice(code.length))}`);
  }
  if (!home) return null;
  if (home === "1") {
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (national.length !== 10) return null;
    return reading(`+1 ${groupNorthAmerican(national)}`);
  }
  const national = digits.startsWith("0") ? digits.slice(1) : digits;
  return reading(`+${home} ${groupInThrees(national)}`);
}

/**
 * The stored number, grouped for a person to read off a screen.
 *
 * Since #1547 `people.phone` holds E.164, so the column is one unbroken run of
 * digits — right, and no longer shaped for the staffer who is reading it aloud
 * down a phone line while the diver stands there. The grouping already exists
 * one function up, so this is `readTypedPhone` again rather than a second set
 * of rules that can drift from the first (#1712).
 *
 * A value it cannot read is returned exactly as stored. A row can still hold
 * text a writer could not resolve — an extension, a note, a number typed for a
 * shop with no country on file — and mangling that would be worse than leaving
 * it alone. The `tel:` href stays the stored value either way: `telHref` keeps
 * only digits and a leading plus, so a grouped string and an E.164 one produce
 * the same link.
 */
export function displayStoredPhone(
  stored: string | null | undefined,
  country: string | null | undefined,
): string {
  if (!stored) return "";
  return readTypedPhone(stored, country)?.label ?? stored;
}

function reading(value: string): TypedReading {
  return { canonical: value, label: value };
}

// ---------------------------------------------------------------------------
// Name

function titleCaseWord(word: string): string {
  return word.toLowerCase().replace(/(^|[-'’])\p{L}/gu, (letter) => letter.toUpperCase());
}

/**
 * "SHARMA, PRIYA" and "PRIYA SHARMA" become "Priya Sharma". A name typed in
 * mixed case is left exactly as typed ("van der Berg", "McKay" are not
 * DiveDay's to fix), so this answers `null` for anything that was not shouted
 * or turned around.
 */
export function readTypedName(raw: string): TypedReading | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  const comma = text.indexOf(",");
  const shouted = /\p{Lu}/u.test(text) && !/\p{Ll}/u.test(text);
  if (comma > 0) {
    const last = text.slice(0, comma).trim();
    const first = text.slice(comma + 1).trim();
    if (!first) return null;
    const turned = `${first} ${last}`;
    const value = shouted ? turned.split(" ").map(titleCaseWord).join(" ") : turned;
    return reading(value);
  }
  if (!shouted || text.length < 2) return null;
  return reading(text.split(" ").map(titleCaseWord).join(" "));
}

// ---------------------------------------------------------------------------
// Money

/**
 * "95", "$95" and "95.00" are the same figure. The canonical form is the
 * major-unit string a number input would have submitted; the label is the
 * scanned form (principle 6: the ledger keeps the cents, a field shows "$95").
 */
export function readTypedMoney(
  raw: string,
  currency: string,
  locale = "en-US",
): TypedReading | null {
  const text = raw.trim();
  if (!text || text.startsWith("-")) return null;
  // Strip everything that is not a digit or a separator, then read the last
  // separator as the decimal point when it is followed by the currency's
  // fraction digits ("62,50" in a Spanish shop, "62.50" in Key Largo).
  const stripped = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(stripped)) return null;
  const digitsOfFraction = currencyFractionDigits(currency);
  const lastSeparator = Math.max(stripped.lastIndexOf("."), stripped.lastIndexOf(","));
  let major: number;
  if (
    digitsOfFraction > 0 &&
    lastSeparator >= 0 &&
    stripped.length - lastSeparator - 1 <= digitsOfFraction &&
    stripped.length - lastSeparator - 1 > 0
  ) {
    const whole = stripped.slice(0, lastSeparator).replace(/[.,]/g, "");
    const fraction = stripped.slice(lastSeparator + 1);
    major = Number(`${whole || "0"}.${fraction}`);
  } else {
    major = Number(stripped.replace(/[.,]/g, ""));
  }
  if (!Number.isFinite(major) || major < 0 || major > maxPriceMajor(currency)) return null;
  const cents = majorToMinor(major, currency);
  return {
    canonical: String(major),
    label: formatMoneyScanned(cents, currency, locale),
  };
}
