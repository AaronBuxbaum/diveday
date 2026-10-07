import {
  type CalendarDate,
  calendarDateInTimezone,
  calendarDateToUtcMidnight,
  calendarDateWeekday,
  shiftCalendarDate,
} from "./calendar-date";
import { DAY_MS } from "./clock";

/**
 * **The numbers DiveDay's founder reads on Monday morning**, and nothing a
 * shop ever sees (ADR 20261007-founder-metrics).
 *
 * Three questions, each with one definition here so the query and the mail
 * cannot disagree about it:
 *
 * 1. **The north star** — dive days run end to end in DiveDay per week
 *    (docs/product/rollout.md, "Metrics — the scoreboard"): a shop's local day
 *    counts when a departure that day had a diver *boarded at the departure
 *    roll call*. That one fact carries the whole definition, because the
 *    departure roll call refuses to board a diver whose readiness has not
 *    cleared (`recordRollCall`, src/db/manifests.ts): a boarded diver is a
 *    booking, a readiness clearance and a recorded checkpoint at once.
 * 2. **The funnel** — demo entries and set-up requests by the page that sent
 *    them, counted from DiveDay's own rows rather than from a dashboard.
 * 3. **Activation** — the steps a new shop takes into running its days here,
 *    and which shops have stopped between two of them.
 *
 * Pure: no database, no clock of its own (every function takes `now`).
 */

/**
 * The milestones a shop can reach, as codes. `first_paid_month` is the seam
 * billing fills in: it can be recorded like the others, but nothing writes it
 * yet, so it is not on {@link ACTIVATION_PATH} — a step nobody can reach would
 * report every shop as stalled in front of it. When billing records it, it
 * joins the path and the stall check covers it with no other change.
 */
export const SHOP_MILESTONES = [
  "shop_created",
  "first_departure",
  "first_public_booking",
  "first_signed_waiver",
  "first_roll_call",
  "first_paid_month",
] as const;

export type ShopMilestone = (typeof SHOP_MILESTONES)[number];

/**
 * The activation path, in the order docs/product/rollout.md names it: the shop
 * exists, schedules a departure, takes a booking from its public pages, has a
 * waiver signed, and calls a roll.
 */
export const ACTIVATION_PATH: readonly ShopMilestone[] = [
  "shop_created",
  "first_departure",
  "first_public_booking",
  "first_signed_waiver",
  "first_roll_call",
];

/** How long a shop may sit between two steps before the founder hears about it. */
export const STALL_DAYS = 7;

export type ReachedMilestones = Partial<Record<ShopMilestone, Date>>;

export type ActivationStall = {
  /** The last step the shop took — what the alert is recorded against. */
  lastReached: ShopMilestone;
  /** When it took it. */
  since: Date;
  /** The first step on the path it has not taken. */
  waitingFor: ShopMilestone;
};

/**
 * Whether a shop has stalled: it has not finished the path, and nothing on the
 * path has happened for {@link STALL_DAYS} days.
 *
 * Shops take steps out of order — a staff-seated diver signs a waiver before
 * any public booking arrives — so "waiting for" is the first step on the path
 * not yet taken, and "since" is the most recent step taken, whichever it was.
 * The stall is identified by that most recent step, which is what makes
 * "alert once per stall" mean something: a shop alerted while sitting after
 * its first departure is alerted again only after it moves and stops again.
 */
export function activationStall(reached: ReachedMilestones, now: Date): ActivationStall | null {
  const waitingFor = ACTIVATION_PATH.find((step) => !reached[step]);
  if (!waitingFor) return null;

  let lastReached: ShopMilestone | null = null;
  let since: Date | null = null;
  for (const step of ACTIVATION_PATH) {
    const at = reached[step];
    if (at && (!since || at.getTime() >= since.getTime())) {
      lastReached = step;
      since = at;
    }
  }
  if (!lastReached || !since) return null;
  if (now.getTime() - since.getTime() < STALL_DAYS * DAY_MS) return null;
  return { lastReached, since, waitingFor };
}

/**
 * One digest's week: Monday through Sunday, as calendar dates, and the same
 * span as UTC instants (`startsAt` inclusive, `endsAt` exclusive).
 *
 * The funnel counts (demo entries, set-up requests) are read in UTC; the north
 * star is read against each shop's own calendar, so a Sunday-afternoon charter
 * in Hawaii counts on the Sunday it sailed rather than on the UTC Monday.
 */
export type DigestWeek = {
  startDate: CalendarDate;
  endDate: CalendarDate;
  startsAt: Date;
  endsAt: Date;
};

function weekStarting(monday: CalendarDate): DigestWeek {
  const endDate = shiftCalendarDate(monday, 6);
  return {
    startDate: monday,
    endDate,
    startsAt: calendarDateToUtcMidnight(monday),
    endsAt: calendarDateToUtcMidnight(shiftCalendarDate(monday, 7)),
  };
}

/** The Monday of the UTC week `now` falls in. */
function mondayOf(now: Date): CalendarDate {
  const today = calendarDateInTimezone(now, "UTC");
  const weekday = calendarDateWeekday(today); // 0 = Sunday
  return shiftCalendarDate(today, -((weekday + 6) % 7));
}

/** The week so far — what the nightly run logs. */
export function currentWeek(now: Date): DigestWeek {
  return weekStarting(mondayOf(now));
}

/** The last complete week — what Monday's digest reports. */
export function previousWeek(now: Date): DigestWeek {
  return weekStarting(shiftCalendarDate(mondayOf(now), -7));
}

/** The digest goes out on Mondays (UTC); every other night only computes. */
export function isDigestDay(now: Date): boolean {
  return calendarDateWeekday(calendarDateInTimezone(now, "UTC")) === 1;
}

export type SourceCount = { source: string; count: number };

/**
 * Counts by funnel source, largest first and then by name, so the mail reads
 * the same way every week and the biggest door is the first line.
 */
export function rankSources(rows: readonly SourceCount[]): SourceCount[] {
  return [...rows]
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

/**
 * One departure roll-call event, as the north-star count reads it: whose seat,
 * which shop, which of that shop's local days the departure sailed on, what
 * the tap said, and the three columns that order roll-call events (ADR
 * 20260815-roll-call-order-is-a-property-of-the-data).
 */
export type DepartureRollCallEvent = {
  shopId: string;
  bookingId: string;
  /** The departure's start, as a calendar date in the shop's own zone. */
  localDay: CalendarDate;
  status: "boarded" | "not_boarded" | "cleared";
  occurredAt: Date;
  createdAt: Date;
  seq: number;
};

/**
 * **The north star, counted.** A dive day is one shop's one local day on which
 * at least one diver's *current* departure roll call says boarded. Current,
 * because a tap undone (`cleared`) or corrected (`not_boarded`) is the crew
 * saying it did not happen; the newest event per booking is the answer, the
 * same reading the manifest takes.
 *
 * `shops` is how many shops ran at least one — the north star's spread, which
 * tells "one shop ran every day" apart from "five shops ran one each".
 */
export function countDiveDays(events: readonly DepartureRollCallEvent[]): {
  diveDays: number;
  shops: number;
} {
  const latest = new Map<string, DepartureRollCallEvent>();
  for (const event of events) {
    const current = latest.get(event.bookingId);
    if (!current || compareRollCallOrder(event, current) > 0) latest.set(event.bookingId, event);
  }
  const days = new Set<string>();
  const shops = new Set<string>();
  for (const event of latest.values()) {
    if (event.status !== "boarded") continue;
    days.add(`${event.shopId}/${event.localDay}`);
    shops.add(event.shopId);
  }
  return { diveDays: days.size, shops: shops.size };
}

function compareRollCallOrder(a: DepartureRollCallEvent, b: DepartureRollCallEvent): number {
  return (
    a.occurredAt.getTime() - b.occurredAt.getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.seq - b.seq
  );
}
