import { HOUR_MS } from "./clock";
import { DEPARTURE_BUFFER_MS, hasReturned } from "./trips";

/**
 * **Earliest flight** after a dive day (issue #1425, N-04). This advisory
 * informs; it never gates. DiveDay uses fixed 18/24-hour intervals, above
 * DAN's published 12/18-hour minimums; ADR 20261001-logbook removed the
 * per-shop setting. Wording names the shop as the one asking and calls the
 * interval a minimum, not a promise of safety or DAN's own figure (issue
 * #1433).
 *
 * This covers only no-decompression diving. An explicitly flagged departure,
 * or an earlier flagged dive, yields no answer (H-84, #1555); absent flags are
 * treated as unflagged. Evidence is limited to this shop and its person
 * records; the two-day lookback (#1439) can miss walk-ups without a shared
 * person row. Recap surfaces reach bookings, not crew, so crew coverage
 * remains deferred under H-75/#1557. This does not calculate from dive
 * profiles or model other altitude exposure.
 *
 * When records are incomplete or disagree with the plan, use the buffered
 * return only after `hasReturned`; never anchor an earlier answer on a partial
 * dive log.
 */
export type FlySafeBasis = "single" | "repetitive";

/**
 * Where the clock started: the last recorded exit, or the buffered return —
 * the scheduled return plus {@link DEPARTURE_BUFFER_MS}, which is the instant
 * the rest of the product calls the boat home.
 */
export type FlySafeAnchor = "last_dive" | "scheduled_return";

/**
 * Why the basis is what it is. `one_dive` is the single-dive case; the other
 * three each reach `repetitive`. Two of those three name something the diver
 * has no way to check, and {@link flySafeMessageKey} is where that becomes
 * words.
 */
export type FlySafeReason = "one_dive" | "dives_recorded" | "dives_planned" | "earlier_day";

export type FlySafeHours = { single: number; repetitive: number };

/**
 * **The fixed rule.** Both figures sit above DAN's published minimums (12 and
 * 18), and the repetitive wait is longer than the single one, so reaching
 * `repetitive` can only ever lengthen a wait — `fly-safe.test.ts` pins both.
 */
export const DEFAULT_FLY_SAFE_HOURS: FlySafeHours = { single: 18, repetitive: 24 };

/**
 * The two preceding **local calendar days** in the shop's zone (issue #1439).
 * Calendar days preserve the intended unit across departure times and DST;
 * an elapsed-hours window can miss a prior day at a boundary.
 */
export const FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS = 2;

export type FlySafeInput = {
  /**
   * The day's `executed_dives`, live rows only. `exitedAt` is null when the
   * crew recorded the dive without a time out.
   */
  executedDives: ReadonlyArray<{ diveNumber: number; exitedAt: Date | null }>;
  /** What the departure planned (`trips.planned_dives`). */
  plannedDives: number;
  /** The departure's scheduled return, or null for a departure with none. */
  endsAt: Date | null;
  /**
   * This diver already had a dive day at *this shop* on one of the
   * {@link FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS} local days before this departure
   * — DAN's "multiple days of diving", which its 18 hours covers alongside
   * repetitive dives on one boat. A fact about a *person*, not about the
   * departure: two divers on one boat may honestly differ here, and anything
   * memoising this result must be keyed accordingly.
   */
  divedRecently: boolean;
  /**
   * The shop marked this departure as past no-decompression limits
   * (`trips.exceeds_no_deco_limits`, H-84). Absent reads as no, which is the
   * column's own default.
   */
  exceedsNoDecoLimits?: boolean;
  /**
   * This diver sailed on an *earlier* departure in the same lookback window
   * that the shop marked past no-decompression limits — a morning
   * decompression boat before this afternoon one. A fact about a person, like
   * {@link FlySafeInput.divedRecently}. Absent reads as no.
   */
  decompressionRecently?: boolean;
  now: Date;
  /** Always {@link DEFAULT_FLY_SAFE_HOURS} in the product; a parameter so the arithmetic stays pure. */
  hours: FlySafeHours;
};

export type FlySafeResult = {
  from: Date;
  basis: FlySafeBasis;
  /**
   * Which of the three routes reached this basis. Not a label: it picks the
   * sentence the diver reads, and on two of the routes that sentence carries a
   * reason clause. Which two, and why neither surface can show the cause on
   * its own, is on {@link flySafeMessageKey}.
   */
  reason: FlySafeReason;
  anchor: FlySafeAnchor;
  /** The hours that produced `from`, for the sentence that names them. */
  hours: number;
};

/**
 * The instant a diver may fly from, or `null` when nothing on the record can
 * honestly say.
 *
 * - **Basis.** Repetitive by any of three routes, and `reason` says which: more
 *   than one dive the crew recorded, more than one dive the departure planned,
 *   or a dive day this diver already had at this shop inside
 *   {@link FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS}. A record short of its plan is a
 *   crew that logged one tank of two more often than it is a day cut to one
 *   tank, and the longer wait is the one that costs a diver nothing if wrong.
 *   None of the three can ever *shorten* a wait: {@link DEFAULT_FLY_SAFE_HOURS}
 *   has a `repetitive` longer than its `single`, so reaching repetitive is
 *   monotonic by construction.
 * - **Past no-decompression limits.** A departure the shop marked so, or a
 *   diver who sailed on an earlier one in the lookback window, gets null
 *   before anything else is read (H-84).
 * - **Anchor.** The latest recorded exit, provided the record is whole — as
 *   many dives logged as the departure planned, none of them later-numbered
 *   and missing its exit. Otherwise the *buffered* return — the scheduled time
 *   plus {@link DEPARTURE_BUFFER_MS} — and only once {@link hasReturned} says
 *   the boat is home: an earliest-flight time for a boat still at sea would be
 *   a guess dressed as a fact, and one computed as if a late boat tied up on
 *   time is the same guess with the gate already conceding otherwise.
 */
export function flySafeFrom(input: FlySafeInput): FlySafeResult | null {
  const { executedDives, plannedDives, endsAt, divedRecently, now, hours } = input;
  // H-84: DAN gives no figure for decompression diving.
  if (input.exceedsNoDecoLimits || input.decompressionRecently) return null;
  // The recorded count is read first so a day the crew logged as two tanks
  // says so, rather than being explained by a plan or by yesterday.
  const reason: FlySafeReason =
    executedDives.length > 1
      ? "dives_recorded"
      : plannedDives > 1
        ? "dives_planned"
        : divedRecently
          ? "earlier_day"
          : "one_dive";
  const basis: FlySafeBasis = reason === "one_dive" ? "single" : "repetitive";
  const wait = basis === "repetitive" ? hours.repetitive : hours.single;

  let lastExit: { diveNumber: number; exitedAt: Date } | null = null;
  for (const dive of executedDives) {
    if (!dive.exitedAt) continue;
    if (!lastExit || dive.exitedAt.getTime() > lastExit.exitedAt.getTime()) {
      lastExit = { diveNumber: dive.diveNumber, exitedAt: dive.exitedAt };
    }
  }
  const laterDiveUntimed =
    lastExit !== null &&
    executedDives.some((dive) => dive.exitedAt === null && dive.diveNumber > lastExit.diveNumber);
  // A missing planned dive is incomplete evidence; do not use an earlier exit.
  const recordShortOfPlan = executedDives.length < plannedDives;

  if (lastExit && !laterDiveUntimed && !recordShortOfPlan) {
    return {
      from: new Date(lastExit.exitedAt.getTime() + wait * HOUR_MS),
      basis,
      reason,
      anchor: "last_dive",
      hours: wait,
    };
  }
  if (endsAt && hasReturned(endsAt, now)) {
    // For incomplete logs, the buffered return is the conservative floor.
    const scheduledHome = endsAt.getTime() + DEPARTURE_BUFFER_MS;
    const anchorAt = lastExit
      ? Math.max(lastExit.exitedAt.getTime(), scheduledHome)
      : scheduledHome;
    return {
      from: new Date(anchorAt + wait * HOUR_MS),
      basis,
      reason,
      anchor: "scheduled_return",
      hours: wait,
    };
  }
  return null;
}

/**
 * The message key for a diver's fly-safe sentence, given where the clock
 * started and why the basis is what it is.
 *
 * One function rather than a condition spelled at each of the two call sites,
 * because the page and the email must never word this differently — the whole
 * point of the shared result is that a diver reads one fact twice. Callers
 * prefix it with their own namespace (`recap.` on the page,
 * `notifications.tripRecap.` in the inbox).
 *
 * Two of the four routes carry a reason clause, and what decides is not what
 * the surface happens to show — **neither surface shows the day's dive count
 * at all**. The record card's "{n} dives logged" line was removed on
 * 2026-08-28 (see `DiveRecord`) because it counted
 * `max(trips.planned_dives, sites.length)` rather than what this diver did,
 * and the recap email is a greeting, the day's sites, this sentence and a
 * link. What decides is whether the diver can account for the figure from the
 * day they remember.
 *
 * `dives_recorded` they can: they were in the water for those dives, and no
 * clause can tell them anything they did not do. `one_dive` is the base case.
 *
 * `dives_planned` they cannot, and this is the route where the number argues
 * with them: it comes from what the shop *planned*, which is by construction
 * more than the crew logged and may be more than the diver dived, so someone
 * who made one dive reads the two-dive figure with nothing to account for it.
 * A number a diver decides is a bug is a number they ignore, and this one is
 * about their body. `earlier_day` they cannot either, for its own reason: the
 * day it rests on is not on a recap of today anywhere.
 *
 * `dives_planned` needs only the return-anchored key, because it can only
 * reach that anchor — the route requires a record short of its plan, which is
 * exactly what sends {@link flySafeFrom} to the buffered return. If that ever
 * stops being true the sentence drops its reason in silence, so
 * `fly-safe.test.ts` pins both halves together.
 */
export type FlySafeMessageKey =
  | "flySafeAfterDive"
  | "flySafeAfterReturn"
  | "flySafeAfterDiveEarlierDay"
  | "flySafeAfterReturnEarlierDay"
  | "flySafeAfterReturnDivesPlanned";

export function flySafeMessageKey(
  result: Pick<FlySafeResult, "anchor" | "reason">,
): FlySafeMessageKey {
  const anchor = result.anchor === "last_dive" ? "flySafeAfterDive" : "flySafeAfterReturn";
  if (result.reason === "earlier_day") return `${anchor}EarlierDay` as const;
  if (result.reason === "dives_planned" && result.anchor === "scheduled_return") {
    return "flySafeAfterReturnDivesPlanned";
  }
  return anchor;
}

/**
 * **The planned form, read before the boat sails** (fifth-loop ideas, item 18,
 * 2026-10-16). A visitor books a flight home before the dive, not after it, so
 * the recap's sentence arrived a day too late for the decision it is about.
 * `/ready` says the same rule ahead of time, worded as a plan.
 *
 * Every choice leans the same way as {@link flySafeFrom}'s, toward the longer
 * wait, because a plan the recap later lengthens is a flight the diver has
 * already booked:
 *
 * - **Anchor.** The buffered return, scheduled end plus
 *   {@link DEPARTURE_BUFFER_MS}: the latest instant the recap would anchor on
 *   for a boat that comes in on time. A recap with logged exits can only say an
 *   earlier time than this; only a boat later than its buffer says a later one.
 *   The sentence names the margin ("plus an hour in case we run late"),
 *   so the time is never an hour off the arithmetic the diver can do.
 * - **Basis.** Repetitive when the departure plans more than one dive, or when
 *   this diver holds a dive day at this shop inside
 *   {@link FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS} (a booked earlier day counts:
 *   it is the plan too).
 * - **Silence.** Past no-decompression limits, here or on an earlier day in
 *   the window (H-84), as the recap. A departure with no scheduled end. And a
 *   later dive with this shop that starts before the time this would name: that
 *   boat's own page says the time, and this one would be a time the diver is
 *   already booked to break.
 *
 * Informs, never gates, like the recap's.
 */
export type PlannedFlySafeInput = {
  plannedDives: number;
  endsAt: Date | null;
  divedRecently: boolean;
  exceedsNoDecoLimits?: boolean;
  decompressionRecently?: boolean;
  /** This diver's next live seat with the shop after this one, or null. */
  nextDiveStartsAt: Date | null;
  hours: FlySafeHours;
};

export type PlannedFlySafeReason = Exclude<FlySafeReason, "dives_recorded">;

export type PlannedFlySafe = { from: Date; reason: PlannedFlySafeReason; hours: number };

export function plannedFlySafeFrom(input: PlannedFlySafeInput): PlannedFlySafe | null {
  if (input.exceedsNoDecoLimits || input.decompressionRecently) return null;
  if (!input.endsAt) return null;
  const reason: PlannedFlySafeReason =
    input.plannedDives > 1 ? "dives_planned" : input.divedRecently ? "earlier_day" : "one_dive";
  const hours = reason === "one_dive" ? input.hours.single : input.hours.repetitive;
  const from = new Date(input.endsAt.getTime() + DEPARTURE_BUFFER_MS + hours * HOUR_MS);
  if (input.nextDiveStartsAt && input.nextDiveStartsAt.getTime() < from.getTime()) return null;
  return { from, reason, hours };
}

/** The planned sentence's key under `ready.`, one per reason, so the reason clause matches the recap's. */
export function plannedFlySafeMessageKey(
  reason: PlannedFlySafeReason,
): "flySafePlanned" | "flySafePlannedDivesPlanned" | "flySafePlannedEarlierDay" {
  if (reason === "dives_planned") return "flySafePlannedDivesPlanned";
  if (reason === "earlier_day") return "flySafePlannedEarlierDay";
  return "flySafePlanned";
}
