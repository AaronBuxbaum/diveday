import type { Role } from "@/lib/authz";
import {
  type CalendarDate,
  calendarDateInTimezone,
  calendarDateWeekday,
  shiftCalendarDate,
} from "@/lib/calendar-date";
import { isWithinSendWindow } from "@/lib/send-window";
import type { TodayAction, TodayActionKind } from "@/lib/today";
import { wallTimeToUtc } from "@/lib/zoned";

/**
 * **The Monday email** — a shop's week, sent to its owner as service mail
 * (market audit item 51; H-09: the owner is staff, so this is transactional,
 * not marketing). This module is the whole of *what goes in it*: which weeks
 * it reads, who gets one, when it is due, and which sections have something
 * to say. Pure and framework-free; the reads are `src/db/weekly-digest.ts`
 * and the words are `src/lib/notifications/weekly-digest-email.ts`.
 *
 * Codes and numbers only. A section that has nothing to say is not in the
 * list at all, and a list with nothing in it means no email that week.
 */

/** Monday, as `calendarDateWeekday` numbers it. */
const MONDAY = 1;

/**
 * The two weeks a digest is about, in the shop's own calendar.
 *
 * `weekOf` is this week's Monday — the key that keeps the email to one a week
 * (`weekly_digest_sends.week_of`). Last week is the seven days before it, this
 * week the seven days from it, and the instants are the shop-local midnights
 * that bound them, so a Saturday-night departure is counted in the week the
 * shop sailed it rather than the one UTC filed it under.
 */
export type DigestWeeks = {
  weekOf: CalendarDate;
  lastWeek: { from: CalendarDate; to: CalendarDate; startUtc: Date; endUtc: Date };
  thisWeek: { from: CalendarDate; to: CalendarDate; startUtc: Date; endUtc: Date };
};

function midnightUtc(date: CalendarDate, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return wallTimeToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone);
}

/** The Monday on or before `date`. */
export function mondayOnOrBefore(date: CalendarDate): CalendarDate {
  const weekday = calendarDateWeekday(date);
  // Sunday is 0, and it belongs to the week that started six days earlier.
  return shiftCalendarDate(date, -((weekday + 6) % 7));
}

export function digestWeeks(now: Date, timeZone: string): DigestWeeks {
  const weekOf = mondayOnOrBefore(calendarDateInTimezone(now, timeZone));
  const lastMonday = shiftCalendarDate(weekOf, -7);
  const nextMonday = shiftCalendarDate(weekOf, 7);
  return {
    weekOf,
    lastWeek: {
      from: lastMonday,
      to: shiftCalendarDate(weekOf, -1),
      startUtc: midnightUtc(lastMonday, timeZone),
      endUtc: midnightUtc(weekOf, timeZone),
    },
    thisWeek: {
      from: weekOf,
      to: shiftCalendarDate(nextMonday, -1),
      startUtc: midnightUtc(weekOf, timeZone),
      endUtc: midnightUtc(nextMonday, timeZone),
    },
  };
}

/**
 * Whether the hourly pass should send this shop's email now: it is Monday on
 * the shop's own calendar, inside the hours every automated message keeps
 * (`isWithinSendWindow`, 08:00–20:00 shop time). The first pass past 08:00
 * sends it; the claim row keeps every later pass that day from sending again.
 * A Monday the pass never reached is skipped rather than sent on Tuesday — a
 * week summary that arrives a day late is about a week nobody is reading.
 */
export function isWeeklyDigestDue(now: Date, timeZone: string): boolean {
  const today = calendarDateInTimezone(now, timeZone);
  return calendarDateWeekday(today) === MONDAY && isWithinSendWindow(now, timeZone);
}

/**
 * Whether this person gets the email: their own answer when they gave one,
 * otherwise their role's default — on for an owner, off for everyone else.
 * The owner is the person the email is for; anyone else asked for it.
 */
export function weeklyDigestWanted(choice: boolean | null, roles: readonly Role[]): boolean {
  return choice ?? roles.includes("owner");
}

/**
 * Today rows that are past due rather than coming up: work hanging off a
 * departure that has already left, or a kind whose own existence means a date
 * slipped. Everything else on Today is the coming week's work, which the
 * email's other sections already cover by count.
 */
const OVERDUE_BY_KIND: ReadonlySet<TodayActionKind> = new Set<TodayActionKind>([
  "gear_overdue",
  "owed_refund",
  "stuck_payment_operation",
  "failed_photo_deletion",
]);

export function overdueTodayActions(
  actions: readonly Pick<TodayAction, "kind" | "dueAt">[],
  now: Date,
): number {
  return actions.filter(
    (action) =>
      OVERDUE_BY_KIND.has(action.kind) ||
      (action.dueAt !== null && action.dueAt.getTime() < now.getTime()),
  ).length;
}

/** Everything the email could say, as numbers. */
export type WeeklyDigestFacts = {
  lastWeek: {
    /** Bookings made during last week, whatever date they are for. */
    bookingsMade: number;
    /** Departures that sailed last week (cancelled ones excluded). */
    departures: number;
    seatsFilled: number;
    seats: number;
  };
  thisWeek: { departures: number; seatsFilled: number; seats: number };
  /** Divers on this week's boats still owing a waiver, and on how many boats. */
  waiversOutstanding: { divers: number; departures: number };
  reviews: { received: number; awaitingModeration: number };
  dateRequestsWaiting: number;
  overdueTodayItems: number;
};

export type WeeklyDigestSection =
  | {
      kind: "last_week";
      bookingsMade: number;
      departures: number;
      seatsFilled: number;
      seats: number;
    }
  | { kind: "this_week"; departures: number; seatsFilled: number; seats: number }
  | { kind: "waivers"; divers: number; departures: number }
  | { kind: "reviews"; received: number; awaitingModeration: number }
  | { kind: "date_requests"; waiting: number }
  | { kind: "overdue"; count: number };

export type WeeklyDigestSectionKind = WeeklyDigestSection["kind"];

/**
 * The sections with something to say, in reading order: what happened, what
 * is coming, then what is waiting on the owner. Empty means no email.
 */
export function weeklyDigestSections(facts: WeeklyDigestFacts): WeeklyDigestSection[] {
  const sections: WeeklyDigestSection[] = [];
  const { lastWeek, thisWeek, waiversOutstanding, reviews } = facts;
  if (lastWeek.bookingsMade > 0 || lastWeek.departures > 0) {
    sections.push({ kind: "last_week", ...lastWeek });
  }
  if (thisWeek.departures > 0) sections.push({ kind: "this_week", ...thisWeek });
  if (waiversOutstanding.divers > 0) sections.push({ kind: "waivers", ...waiversOutstanding });
  if (reviews.received > 0 || reviews.awaitingModeration > 0) {
    sections.push({ kind: "reviews", ...reviews });
  }
  if (facts.dateRequestsWaiting > 0) {
    sections.push({ kind: "date_requests", waiting: facts.dateRequestsWaiting });
  }
  if (facts.overdueTodayItems > 0) {
    sections.push({ kind: "overdue", count: facts.overdueTodayItems });
  }
  return sections;
}

/** Whole percent of seats filled, or null for a week with no seats to fill. */
export function seatFillPercent(seatsFilled: number, seats: number): number | null {
  if (seats <= 0) return null;
  return Math.round((seatsFilled / seats) * 100);
}

/**
 * Where each section's link lands in the staff app, as path segments under
 * `/shop/<slug>/` — joined through `shopPath` by whoever builds the URL.
 */
export const WEEKLY_DIGEST_SECTION_PATHS: Record<WeeklyDigestSectionKind, readonly string[]> = {
  last_week: ["reports"],
  this_week: ["schedule", "board"],
  waivers: [],
  reviews: ["reviews"],
  date_requests: ["requests"],
  overdue: [],
};

/**
 * Hourly, on the minute every other hourly pass shares, so each shop's Monday
 * 08:00 is reached within the hour wherever it is (`isWeeklyDigestDue`). Every
 * pass but the first on a shop's Monday stops at the claim check.
 */
export const WEEKLY_DIGEST_CRON_CRONTAB = "0 * * * *";
