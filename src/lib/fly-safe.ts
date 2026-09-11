import { HOUR_MS } from "./clock";
import { hasReturned } from "./trips";

/**
 * **"Earliest flight"** — when a diver may board a plane after a day's diving
 * (issue #1425, N-04; owner decision 2026-09-07).
 *
 * Informs, never gates. DAN's published guidance is a *minimum* preflight
 * surface interval — 12 hours after a single no-decompression dive, 18 after
 * repetitive dives or multiple days of diving — and a shop may ask its divers
 * to wait longer. So the hours are the shop's own pair (`shops.fly_safe_hours_*`,
 * defaults 18 and 24), and the floors below are DAN's minimums. The sentence
 * a diver reads names the shop as the author of the figure and DAN as the
 * practice behind it ("{shop} asks for 24 hours after your last dive,
 * following DAN's guidance") rather than putting the figure in DAN's mouth:
 * DAN publishes 12 and 18, so a sentence reading "24 hours, by DAN's
 * guidance" misquotes it, and a setting under DAN's floor would leave even
 * the weaker claim false.
 *
 * For the same reason the lead-in states the interval rather than a verdict.
 * It read "Fly-safe from {when}:" until issue #1433: a minimum that lowers DCS
 * risk does not remove it, "safe" was the only word in the sentence that read
 * as a promise, and DAN's own term is *minimum preflight surface interval*.
 * The Spanish carried the verdict twice over — "Puedes volar a partir del" is
 * literally *you can fly* — so both locales moved together.
 *
 * Three limits worth knowing before this is extended, and none of them can be
 * closed from inside this module.
 *
 * DAN's guidance covers **no-decompression** recreational diving — a dive that
 * took stops needs substantially longer, and nothing in DiveDay records
 * whether one did.
 *
 * The only dives it can see are the ones booked at *this* shop: a diver who
 * spent the week with another operator and made one dive here today still
 * reads *single*, because nothing in DiveDay records the week.
 *
 * And it sees an earlier day only when both days resolve to one `people` row.
 * A booking taken without an email always inserts a fresh person (the unique
 * index is partial, so nulls never collide), so the cash walk-up who dives
 * Monday and comes back Tuesday is two people as far as this is concerned —
 * and walk-ups are a large share of a busy shop's multi-day divers. Issue
 * #1439 widened this to a second day at this shop; it did not make the shop's
 * records of a person complete.
 *
 * Two things this deliberately does not do. It never computes from a dive
 * profile — depth and bottom time are a computer's business, and DiveDay is
 * not a dive computer. And it never chooses the shorter reading when the
 * record is ambiguous: a day whose record disagrees with its plan takes the
 * repetitive hours, and a record short of its plan or missing its last exit
 * time anchors on the boat's scheduled return rather than on an earlier dive.
 */
export type FlySafeBasis = "single" | "repetitive";

/** Where the clock started: the last recorded exit, or the boat's scheduled return. */
export type FlySafeAnchor = "last_dive" | "scheduled_return";

/**
 * Why the basis is what it is. `one_dive` is the single-dive case; the other
 * three each reach `repetitive`, and only `earlier_day` is invisible on the
 * surface that renders the answer.
 */
export type FlySafeReason = "one_dive" | "dives_recorded" | "dives_planned" | "earlier_day";

export type FlySafeHours = { single: number; repetitive: number };

export const DEFAULT_FLY_SAFE_HOURS: FlySafeHours = { single: 18, repetitive: 24 };

/**
 * What each field accepts — the Settings form's `min`/`max`, the action that
 * refuses a forged submission, and the table's CHECK constraints all read from
 * here. The floors are DAN's own minimums (see above); the ceiling is three
 * days, past which the number has stopped describing a preflight interval.
 */
export const FLY_SAFE_LIMITS = {
  single: { min: 12, max: 72 },
  repetitive: { min: 18, max: 72 },
} as const satisfies Record<keyof FlySafeHours, { min: number; max: number }>;

export const FLY_SAFE_FIELDS = ["single", "repetitive"] as const satisfies ReadonlyArray<
  keyof FlySafeHours
>;

/**
 * How far back "multiple days of diving" reaches: this many **local calendar
 * days** in the shop's own zone, counted back from the departure's day (issue
 * #1439). Two means yesterday and the day before.
 *
 * DAN publishes no window for that clause at all — 18 hours covers
 * "repetitive dives or multiple days of diving" and stops there — so the
 * figure is DiveDay's reading, not a quotation. What is *not* a judgement call
 * is the unit: DAN's clause counts days, and so does this. A span of hours got
 * three ordinary cases wrong at once — two 8 AM departures on consecutive days
 * are exactly 24 hours apart, the same pair is 25 across a fall-back boundary,
 * and Monday morning to Tuesday afternoon is 30 — and each error fell toward
 * the shorter advice.
 *
 * Two rather than one because a diver on a three-day package who takes a day
 * off the boat is still diving multiple days; more than two starts describing
 * a holiday rather than a surface interval. Erring wide costs a diver hours
 * ashore and nothing else: {@link parseFlySafeHours} refuses a `repetitive`
 * shorter than a `single`, so reading repetitive can only ever lengthen a
 * wait.
 */
export const FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS = 2;

/**
 * A submitted pair, or `null` if either is not a whole number inside its own
 * bounds, or the repetitive wait is shorter than the single one — a shop that
 * asked less of a two-tank day than of a one-tank day has typed them the wrong
 * way round, and the honest answer is to refuse rather than to swap them.
 */
export function parseFlySafeHours(
  values: Partial<Record<keyof FlySafeHours, unknown>>,
): FlySafeHours | null {
  const parsed = {} as FlySafeHours;
  for (const field of FLY_SAFE_FIELDS) {
    const hours = Number(values[field]);
    const { min, max } = FLY_SAFE_LIMITS[field];
    if (!Number.isInteger(hours) || hours < min || hours > max) return null;
    parsed[field] = hours;
  }
  if (parsed.repetitive < parsed.single) return null;
  return parsed;
}

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
  now: Date;
  hours: FlySafeHours;
};

export type FlySafeResult = {
  from: Date;
  basis: FlySafeBasis;
  /**
   * Which of the three routes reached this basis. The diver's sentence reads
   * it for one reason: on `earlier_day`, two divers who did the identical
   * thing today read different numbers, and nothing on a recap of *today*
   * shows the cause. The other two routes need no explanation — the day's own
   * dive count is on the same page.
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
 *   None of the three can ever *shorten* a wait: {@link parseFlySafeHours}
 *   refuses a `repetitive` shorter than `single`, so reaching repetitive is
 *   monotonic by construction.
 * - **Anchor.** The latest recorded exit, provided the record is whole — as
 *   many dives logged as the departure planned, none of them later-numbered
 *   and missing its exit. Otherwise the boat's scheduled return, and only once
 *   {@link hasReturned} says it is home — an earliest-flight time for a boat
 *   still at sea would be a guess dressed as a fact.
 */
export function flySafeFrom(input: FlySafeInput): FlySafeResult | null {
  const { executedDives, plannedDives, endsAt, divedRecently, now, hours } = input;
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
  // A tank the crew never opened a row for is the same hole as one logged
  // without its exit, and the basis above already reads it that way. The
  // anchor has to agree: on a two-tank morning charter with only tank one
  // logged, its exit is around 09:45 against a 12:15 return, so anchoring
  // there hands the diver a time two and a half hours early — at the
  // settable minimum of 18 repetitive hours, a real interval of about 15.5,
  // under DAN's floor in a sentence that ends by citing DAN.
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
    // A dive the crew never logged, or logged without an exit time: the
    // return is the only instant on the record that is not before the day's
    // real last dive ended.
    const anchorAt = lastExit
      ? new Date(Math.max(lastExit.exitedAt.getTime(), endsAt.getTime()))
      : endsAt;
    return {
      from: new Date(anchorAt.getTime() + wait * HOUR_MS),
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
 * Only `earlier_day` gets its own sentence. The other two routes to
 * *repetitive* are visible on the page that renders the answer — the day's own
 * dive record is a few lines above it — but a dive on an earlier day appears
 * nowhere on a recap of today, so two divers who did the identical thing today
 * read different numbers with nothing saying why. That is the one clause here
 * that carries something the surface cannot show on its own.
 */
export type FlySafeMessageKey =
  | "flySafeAfterDive"
  | "flySafeAfterReturn"
  | "flySafeAfterDiveEarlierDay"
  | "flySafeAfterReturnEarlierDay";

export function flySafeMessageKey(
  result: Pick<FlySafeResult, "anchor" | "reason">,
): FlySafeMessageKey {
  const anchor = result.anchor === "last_dive" ? "flySafeAfterDive" : "flySafeAfterReturn";
  return result.reason === "earlier_day" ? (`${anchor}EarlierDay` as const) : anchor;
}
