/**
 * Shared formatting helpers. Booking times, manifests, and waivers all
 * display dates to divers, so keep every user-facing date/time format here.
 */

/**
 * Every `Intl.*Format` constructor here is called on essentially every render
 * (AGENTS.md requires locale-negotiated formatting for every date, time, and
 * money figure app-wide), and constructing one is meaningfully more expensive
 * than reusing an existing instance's `.format()`.
 *
 * The cache that fixes that now lives in `./intl-cache`, shared with the other
 * modules that were still paying the constructor on every call — see the
 * reasoning there.
 */
import { nowDate } from "./clock";
import { cachedFormatter } from "./intl-cache";
import { minorToMajor } from "./money";

/**
 * True for a real IANA timezone name — the only thing an app-wide "store UTC
 * + IANA timezone" invariant (AGENTS.md) can trust. `Intl.DateTimeFormat`
 * throws a `RangeError` for anything else, including a well-formed but
 * nonexistent zone like `"Etc/Nowhere"` (CR-014).
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    cachedFormatter("dt", Intl.DateTimeFormat, undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Minor units to a localized currency string, e.g. 13000 usd → "$130.00",
 * 5000 jpy → "¥5,000".
 *
 * The divisor comes from the currency, not a literal 100 — a zero-decimal
 * currency stores whole major units, so dividing would show ¥50 for a ¥5,000
 * trip (`src/lib/money.ts`). The `currency` default is the shop-column default
 * rather than an assumption that money is dollars; callers with a shop row in
 * hand should always pass `shop.currency`.
 */
export function formatMoneyCents(cents: number, currency = "usd", locale = "en-US"): string {
  return cachedFormatter("num", Intl.NumberFormat, locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(minorToMajor(cents, currency));
}

/**
 * The same amount for a reader who is **scanning** rather than reconciling:
 * 9500 usd → "$95", 6250 usd → "$62.50", 5000 jpy → "¥5,000".
 *
 * Dive-shop prices are whole numbers almost always, so `formatMoneyCents`
 * renders the same two characters down every row of a list — twelve `.00`s in
 * one scroll of a shop's public schedule, which is exactly what principle 9's
 * cross-out test removes. The minor units are dropped **only when there are
 * none to lose**: an amount that is not a whole major unit formats identically
 * to `formatMoneyCents`, so a $62.50 half-day never reads "$62.5" or "$63".
 *
 * That conditional is the whole reason this is a second function rather than an
 * option on the first. Money being *reconciled* — an order's rows and total, a
 * refund, an invoice, the monthly report, the export — keeps
 * `formatMoneyCents`, because a column of figures only aligns on its decimal
 * point if every figure has one, and because an exact amount in a ledger should
 * look exact (principle 6).
 */
export function formatMoneyScanned(cents: number, currency = "usd", locale = "en-US"): string {
  const major = minorToMajor(cents, currency);
  return cachedFormatter("num", Intl.NumberFormat, locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    // Zero-decimal currencies need no help here: `minorToMajor` already made
    // ¥5000 the integer 5000, so this branch is taken and `Intl` renders the
    // yen it would have rendered anyway.
    ...(Number.isInteger(major) ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
  }).format(major);
}

/**
 * `timeZone` is **required** on every date/time formatter in this file, and
 * that is the whole point rather than an inconvenience.
 *
 * Timestamps are stored as UTC instants and rendered in the shop's own zone
 * (`shops.timezone`) — see docs/architecture/overview.md. When `timeZone` was
 * optional, omitting it did not fail: `Intl.DateTimeFormat` silently falls back
 * to the *host* zone, which in production and CI is **UTC**. A missed argument
 * therefore rendered a 7:30 AM Key Largo departure as "11:30 AM" — plausible
 * enough to ship, wrong enough to put a diver on the dock four hours late, and
 * invisible to every test running on a UTC box (which is all of them).
 *
 * Making the parameter required converts that silent mis-render into a compile
 * error, which is the only enforcement that scales: the invariant spans ~143
 * call sites across pages, emails, SMS, and the calendar feed, and no reviewer
 * reliably notices a third argument that isn't there. Callers with a shop row
 * in hand pass `shop.timezone`; a genuinely zone-free value (a date-only
 * calendar date, a wall-clock time of day) belongs in `src/lib/calendar-date.ts`
 * or `formatScheduleDayTime`, which format through a fixed UTC reference on
 * purpose — not here with the argument dropped.
 */
export function formatShortDate(date: Date, locale = "en-US", timeZone: string): string {
  return cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}

export function formatTime(date: Date, locale = "en-US", timeZone: string): string {
  return cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

/**
 * A timezone as a **name a person says out loud** — "Eastern Daylight Time",
 * not `America/New_York`.
 *
 * An IANA id is a database value, and design/principles.md §4 keeps that
 * vocabulary off the screen: a manifest that labels its column "Shop time:
 * America/New_York" is showing the reader our storage format. The long name is
 * what a captain already calls the zone, and it stays honest about the
 * invariant — the id still decides the instant, this only spells it.
 *
 * Read through the clock (`nowDate`) because the answer moves with DST: the
 * same zone is "Eastern Standard Time" in January. The e2e fleet freezes that
 * clock, so the rendered name is stable for visual regression.
 *
 * Falls back to the id when a runtime has no long name for the zone — a raw id
 * is worse than a name, and far better than an empty label.
 */
/**
 * A bare hour of the day — "8:00 AM" — for a setting that names an hour rather
 * than an instant, like a shop's send window (`src/lib/send-window.ts`).
 *
 * `timeZone: "UTC"` deliberately, and it is not the shop's zone going missing:
 * a wall-clock hour has no instant in it, so there is nothing to convert. The
 * shop's own zone is what the hour is *read in*, which the label beside the
 * field says in words. `24` renders as midnight, which is what an exclusive end
 * of 24 means.
 */
export function formatHourOfDay(hour: number, locale = "en-US"): string {
  return formatTime(new Date(Date.UTC(2000, 0, 1, hour)), locale, "UTC");
}

export function formatTimeZoneName(locale = "en-US", timeZone: string, now = nowDate()): string {
  const parts = cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    timeZone,
    timeZoneName: "long",
  }).formatToParts(now);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

/**
 * A byte count as a human-readable size ("42.3 MB"), in the reader's locale.
 * Decimal units (1 MB = 1,000,000 bytes) because that is what every storage
 * console the number will be compared against reports.
 */
export function formatByteSize(bytes: number, locale = "en-US"): string {
  const units = [
    { unit: "gigabyte", threshold: 1e9 },
    { unit: "megabyte", threshold: 1e6 },
    { unit: "kilobyte", threshold: 1e3 },
  ] as const;
  const match = units.find((candidate) => bytes >= candidate.threshold);
  const unit = match?.unit ?? "byte";
  const value = match ? bytes / match.threshold : bytes;
  return cachedFormatter("num", Intl.NumberFormat, locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

/**
 * Operational timestamp with an explicit timezone — signed evidence, safety
 * events, and "last updated at".
 *
 * **To the minute, deliberately.** The public booking page's forecast note used
 * to build its own timestamp with a bare `toLocaleString`, and `Intl`'s default
 * field set for that includes **seconds** — so a diver deciding what to pack
 * read "Updated 8/22/2026, 10:33:06 AM EDT" (issue #799). A forecast is
 * accurate to hours and that timestamp claimed a second; letting machine
 * precision into a human sentence is what principle 4 is about.
 *
 * Which is the argument for one formatter rather than a per-surface field list:
 * a call site that picks its own fields is a call site that can pick wrong, and
 * nothing downstream would notice.
 */
export function formatDateTimeTz(date: Date, locale = "en-US", timeZone: string): string {
  return cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(date);
}

/** "7:30 AM – 11:00 AM" — en dash, no repeated day. */
export function formatTimeRange(
  start: Date,
  end: Date,
  locale = "en-US",
  timeZone: string,
): string {
  return `${formatTime(start, locale, timeZone)} – ${formatTime(end, locale, timeZone)}`;
}

/**
 * "7:30 AM – 11:00 AM EDT" — for operational surfaces (manage pages,
 * confirmations) where an unlabeled time is a trust failure. The public
 * schedule stays bare: local time is the honest default there.
 */
export function formatTimeRangeTz(
  start: Date,
  end: Date,
  locale = "en-US",
  timeZone: string,
): string {
  const endWithZone = cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(end);
  return `${formatTime(start, locale, timeZone)} – ${endWithZone}`;
}

/**
 * The pieces of a calendar-agenda date block — weekday cap, day numeral, month
 * cap — for surfaces that lay the date out as a block rather than a sentence
 * (the public schedule's day headers). Same options object as
 * `formatShortDate`, so the two share one cached formatter; `formatToParts`
 * hands each localized piece back separately so the layout, not string
 * splitting, decides where they sit.
 */
export function formatDayParts(
  date: Date,
  locale = "en-US",
  timeZone: string,
): { weekday: string; day: string; month: string } {
  const parts = cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: pick("weekday"), day: pick("day"), month: pick("month") };
}

/** The calendar day a date falls on in a given timezone, as a UTC-midnight instant — for day-granularity diffs, never for display. */
function calendarDayMs(date: Date, timeZone: string): number {
  const iso = cachedFormatter("dt", Intl.DateTimeFormat, "en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
}

/**
 * "today" / "tomorrow" / "in 3 days" (or the past-tense equivalents), from
 * the calendar day `date` falls on in `timeZone` relative to the calendar day
 * `now` falls on there — a raw millisecond difference would misreport a trip
 * departing at 6am tomorrow as "today" once the diver reads this the same
 * evening. `Intl.RelativeTimeFormat`'s `numeric: "auto"` picks the day-name
 * wording automatically per locale, so this never hard-codes English.
 */
export function formatRelativeDay(
  date: Date,
  now: Date,
  locale = "en-US",
  timeZone: string,
): string {
  const diffDays = Math.round(
    (calendarDayMs(date, timeZone) - calendarDayMs(now, timeZone)) / 86_400_000,
  );
  return cachedFormatter("rel", Intl.RelativeTimeFormat, locale, { numeric: "auto" }).format(
    diffDays,
    "day",
  );
}

/**
 * The seven weekday names, Sunday first, in the given locale — "Sun", "Mon", …
 * or their equivalents in the reader's own language.
 *
 * Calendar data, not copy: `Intl` knows these for every locale the app
 * negotiates, so a `weekdayMon` key in each bundle would be seven strings per
 * language to maintain for something the platform hands over correct. The order
 * matches the weekday numbering of `src/lib/recurrence.ts` (0 = Sunday), which
 * is `Date#getUTCDay`'s.
 *
 * Formatted from a fixed reference week (2024-01-07 is a Sunday) rather than
 * from the clock, so the labels are identical in every render — including a
 * frozen-clock e2e run. `timeZone: "UTC"` because a weekday *name* has no
 * instant in it; the reference dates are a calendar, not a moment.
 */
export function weekdayNames(locale = "en-US", width: "short" | "narrow" = "short"): string[] {
  const format = cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    weekday: width,
    timeZone: "UTC",
  });
  return Array.from({ length: 7 }, (_, day) => format.format(new Date(Date.UTC(2024, 0, 7 + day))));
}

/**
 * Localized ordinal representation (e.g. 1st, 2nd, 3rd, 4th in English; 1.º, 2.º, 4.º in Spanish).
 */
export function formatOrdinal(count: number, locale = "en-US"): string {
  if (locale.startsWith("es")) {
    return `${count}.º`;
  }
  const suffixes: Record<string, string> = {
    one: "st",
    two: "nd",
    few: "rd",
    other: "th",
  };
  const rule = cachedFormatter("ordinal", Intl.PluralRules, locale, { type: "ordinal" }).select(
    count,
  );
  const suffix = suffixes[rule] ?? "th";
  return `${count}${suffix}`;
}
