import { canViewShopReports, type Role } from "@/lib/authz";
import {
  type CalendarDate,
  calendarDateInTimezone,
  calendarDateWeekday,
  shiftCalendarDate,
} from "@/lib/calendar-date";
import { DEFAULT_SEND_WINDOW, isWithinSendWindow } from "@/lib/send-window";
import type { TodayAction, TodayActionKind } from "@/lib/today";
import { wallTimeToUtc } from "@/lib/zoned";

/**
 * **The Monday email** — a shop's week, sent to its owner as service mail
 * (market audit item 51; H-20260724-channel-sends-booking-waiver: the owner is staff, so this is transactional,
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
  thisWeek: {
    departures: number;
    seatsFilled: number;
    seats: number;
    /** The week's emptiest boat no deal has gone out for; Reports grade only. */
    weakest: WeakestDeparture | null;
  };
  /** Divers on this week's boats still owing a waiver, and on how many boats. */
  waiversOutstanding: { divers: number; departures: number };
  reviews: { received: number; awaitingModeration: number };
  dateRequestsWaiting: number;
  overdueTodayItems: number;
  /**
   * What last week made, for the Reports grade only (third UX review, item
   * 33): revenue after tax and pass-through on last week's departures and the
   * tips settled on them, Reports' own month query cut to the week, and the
   * orders still open shop-wide. Zero in the staff grade, so the section is
   * never built for a crew member.
   */
  money: {
    revenueCents: number;
    /**
     * What the same week a year before took, on the same basis (fifth loop,
     * item 29); null until the shop has a departure in that week.
     */
    lastYearRevenueCents: number | null;
    tipsCents: number;
    /** What the shop is owed (`readOwed`, fourth UX review, item 23). */
    owed: WeeklyDigestOwed;
    currency: string;
  };
  /**
   * Units whose service clock is overdue or due soon, as Today lists them
   * (fourth UX review, item 24). Reports grade only; zero for staff.
   */
  gearServiceDue: number;
  /**
   * The week's safety sentence, Reports grade only (fourth UX review, item
   * 24): roll calls Today still holds open, departures in the horizon with no
   * crew on them, and incident reports filed last week. Zero for staff.
   */
  safety: WeeklyDigestSafety;
  /**
   * Last week's emergency reads of a diver's medical alert (issue #2990):
   * how many, how many each reader opened, and the first of them in the order
   * they happened. Reports grade only (the owner and managers, who read the
   * diver's trail anyway); none for staff, so the section is never built for
   * crew.
   */
  emergencyReads: WeeklyDigestEmergencyReads;
};

/**
 * **Every emergency read last week, however many** (domain review 1, S1;
 * security L2). The email is the deterrent that keeps the emergency read from
 * becoming the normal way to read alerts, so a busy week never hides volume:
 * `total` counts them all, `byReader` says who opened how many (the habit
 * shows even when the rows are cut), and `listed` holds the first
 * {@link EMERGENCY_READS_LISTED}, oldest first; the email says how many more.
 */
export type WeeklyDigestEmergencyReads = {
  total: number;
  /** Most reads first. */
  byReader: readonly { reader: string | null; count: number }[];
  listed: readonly WeeklyDigestEmergencyRead[];
};

/** At most this many emergency reads are listed line by line; the rest are counted. */
export const EMERGENCY_READS_LISTED = 50;

/** At most this many readers get their own count: far more staff than a shop has. */
export const EMERGENCY_READERS_LISTED = 100;

/** No emergency read last week: the staff grade's, and a quiet week's. */
export const NO_EMERGENCY_READS: WeeklyDigestEmergencyReads = {
  total: 0,
  byReader: [],
  listed: [],
};

/**
 * One `medical_alert_emergency_read` line, as the Monday email names it
 * (issue #2990). A name the trail holds blank is `null`, and the email says
 * "a diver", "a staffer" or "a departure" instead: one malformed line never
 * stops the owner's email (domain review 1, N4; security L3).
 */
export type WeeklyDigestEmergencyRead = {
  diver: string | null;
  departureTitle: string | null;
  departureStartsAt: Date;
  reader: string | null;
  at: Date;
};

/** A departure this week worth a last-minute deal (fifth loop, item 29). */
export type WeakestDeparture = {
  tripId: string;
  title: string;
  startsAt: Date;
  booked: number;
  capacity: number;
};

/**
 * **The boat to send a deal for**: of this week's departures still to leave,
 * the one with the smallest share of its seats booked, under half, that no
 * last-minute deal has gone out for. Earliest first on a tie, since the
 * nearer boat has less time to fill. Null when every boat is at least half
 * full or already had its deal.
 */
export function weakestDeparture(
  trips: readonly {
    id: string;
    title: string;
    startsAt: Date;
    booked: number;
    capacity: number;
  }[],
  neverSentDeal: ReadonlySet<string>,
  now: Date,
): WeakestDeparture | null {
  let weakest: WeakestDeparture | null = null;
  for (const trip of trips) {
    if (trip.startsAt.getTime() <= now.getTime()) continue;
    if (trip.capacity <= 0 || trip.booked * 2 >= trip.capacity) continue;
    if (!neverSentDeal.has(trip.id)) continue;
    const share = trip.booked / trip.capacity;
    const best = weakest ? weakest.booked / weakest.capacity : Number.POSITIVE_INFINITY;
    if (
      share < best ||
      (weakest && share === best && trip.startsAt.getTime() < weakest.startsAt.getTime())
    ) {
      weakest = {
        tripId: trip.id,
        title: trip.title,
        startsAt: trip.startsAt,
        booked: trip.booked,
        capacity: trip.capacity,
      };
    }
  }
  return weakest;
}

export type WeeklyDigestOwed = {
  orderCents: number;
  orderCount: number;
  seatCents: number;
  seatCount: number;
};

export type WeeklyDigestSafety = { openRollCalls: number; uncrewed: number; incidents: number };

export const NO_SAFETY: WeeklyDigestSafety = { openRollCalls: 0, uncrewed: 0, incidents: 0 };

/**
 * The same week told twice: once for someone who may read Reports and once
 * for everyone else. Reports' gate (`canViewShopReports`) decides two things in
 * the email — last week's bookings and seat fill, whose link is Reports itself,
 * and the money and platform chores Today only shows that gate's holders
 * (`includeOpsAlerts`). Opt-in stays open to all staff; what a crew member who
 * asked for the email reads is the staff-grade week.
 */
export type WeeklyDigestFactGrades = {
  reports: WeeklyDigestFacts;
  staff: WeeklyDigestFacts;
};

/** Which grade of the week this person may read, by their live roles. */
export function weeklyDigestGrade(roles: readonly Role[]): keyof WeeklyDigestFactGrades {
  return canViewShopReports(roles) ? "reports" : "staff";
}

/** The staff-grade money: nothing, so the money section is never built. */
export function noMoney(currency: string): WeeklyDigestFacts["money"] {
  return {
    revenueCents: 0,
    lastYearRevenueCents: null,
    tipsCents: 0,
    owed: { orderCents: 0, orderCount: 0, seatCents: 0, seatCount: 0 },
    currency,
  };
}

/** The staff-grade last week: nothing, so the Reports section is never built. */
export const NO_LAST_WEEK: WeeklyDigestFacts["lastWeek"] = {
  bookingsMade: 0,
  departures: 0,
  seatsFilled: 0,
  seats: 0,
};

export type WeeklyDigestSection =
  | {
      kind: "last_week";
      bookingsMade: number;
      departures: number;
      seatsFilled: number;
      seats: number;
    }
  | {
      kind: "money";
      revenueCents: number;
      lastYearRevenueCents: number | null;
      tipsCents: number;
      owed: WeeklyDigestOwed;
      currency: string;
    }
  | {
      kind: "this_week";
      departures: number;
      seatsFilled: number;
      seats: number;
      weakest: WeakestDeparture | null;
    }
  | { kind: "waivers"; divers: number; departures: number }
  | { kind: "reviews"; received: number; awaitingModeration: number }
  | { kind: "date_requests"; waiting: number }
  | { kind: "overdue"; count: number }
  | ({ kind: "safety" } & WeeklyDigestSafety)
  | {
      kind: "emergency_reads";
      total: number;
      byReader: { reader: string | null; count: number }[];
      reads: WeeklyDigestEmergencyRead[];
    }
  | { kind: "gear_service"; due: number };

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
  const { money } = facts;
  const owes = money.owed.orderCents > 0 || money.owed.seatCents > 0;
  if (money.revenueCents > 0 || money.tipsCents > 0 || owes) {
    sections.push({ kind: "money", ...money });
  }
  if (thisWeek.departures > 0) sections.push({ kind: "this_week", ...thisWeek });
  if (waiversOutstanding.divers > 0) sections.push({ kind: "waivers", ...waiversOutstanding });
  const { safety } = facts;
  if (safety.openRollCalls > 0 || safety.uncrewed > 0 || safety.incidents > 0) {
    sections.push({ kind: "safety", ...safety });
  }
  // Every emergency read of a medical alert last week, beside the safety line.
  const emergency = facts.emergencyReads;
  if (emergency.total > 0) {
    sections.push({
      kind: "emergency_reads",
      total: emergency.total,
      byReader: [...emergency.byReader],
      reads: [...emergency.listed],
    });
  }
  if (reviews.received > 0 || reviews.awaitingModeration > 0) {
    sections.push({ kind: "reviews", ...reviews });
  }
  if (facts.dateRequestsWaiting > 0) {
    sections.push({ kind: "date_requests", waiting: facts.dateRequestsWaiting });
  }
  if (facts.overdueTodayItems > 0) {
    sections.push({ kind: "overdue", count: facts.overdueTodayItems });
  }
  if (facts.gearServiceDue > 0) sections.push({ kind: "gear_service", due: facts.gearServiceDue });
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
  money: ["orders"],
  this_week: ["schedule", "board"],
  waivers: [],
  reviews: ["reviews"],
  date_requests: ["requests"],
  overdue: [],
  safety: [],
  emergency_reads: ["divers"],
  gear_service: ["gear"],
};

/**
 * Hourly from Sunday to Tuesday UTC, at `:04` inside the five minutes every
 * hourly pass shares, so each shop's Monday 08:00 is reached within the hour
 * wherever it is (`isWeeklyDigestDue`). Every pass but the first on a shop's
 * Monday stops at the claim check. The other four days no shop anywhere is in
 * its Monday, so the pass is not scheduled on them at all, and the route skips
 * the database on the Sunday and Tuesday hours that are outside every zone's
 * Monday too (`weeklyDigestMayBeDueSomewhere`; code review 2026-10-10, item 11).
 */
export const WEEKLY_DIGEST_CRON_CRONTAB = "4 * * * 0-2";

/** How far ahead of UTC the earliest zone runs (Kiribati, +14:00), in minutes. */
const EARLIEST_ZONE_AHEAD_MINUTES = 14 * 60;
/** How far behind UTC the latest zone runs (Baker Island, −12:00), in minutes. */
const LATEST_ZONE_BEHIND_MINUTES = 12 * 60;
const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/**
 * Whether **any** shop, in any zone, could be inside its Monday sending hours
 * at `now` — the question the route asks before it opens the database. Monday
 * 08:00 in the earliest zone is Sunday 18:00 UTC; Monday 20:00 in the latest is
 * Tuesday 08:00 UTC. Outside that span `isWeeklyDigestDue` is false for every
 * shop whatever its zone, so the pass has nothing to do.
 */
export function weeklyDigestMayBeDueSomewhere(now: Date): boolean {
  const sinceMonday =
    ((now.getUTCDay() + 6) % 7) * MINUTES_PER_DAY + now.getUTCHours() * 60 + now.getUTCMinutes();
  const opens = DEFAULT_SEND_WINDOW.startHour * 60 - EARLIEST_ZONE_AHEAD_MINUTES;
  const closes = DEFAULT_SEND_WINDOW.endHour * 60 + LATEST_ZONE_BEHIND_MINUTES;
  // Sunday evening is the end of last week by the arithmetic above; it opens
  // this week's span, so read it as minutes before Monday.
  const position =
    sinceMonday >= MINUTES_PER_WEEK + opens ? sinceMonday - MINUTES_PER_WEEK : sinceMonday;
  return position >= opens && position < closes;
}
