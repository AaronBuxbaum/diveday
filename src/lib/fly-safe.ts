import { HOUR_MS } from "./clock";
import { hasReturned } from "./trips";

/**
 * **"Fly-safe from"** — when a diver may board a plane after a day's diving
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
 * Two limits worth knowing before this is extended. DAN's guidance covers
 * **no-decompression** recreational diving — a dive that took stops needs
 * substantially longer, and nothing here can tell. And the only dives it can
 * see are the ones booked at *this* shop: a diver who spent the week with
 * another operator and made one dive here today still reads *single*, because
 * nothing in DiveDay records the week (issue #1439 closed the narrower gap —
 * an earlier day at this shop — and left this one, which no amount of code
 * here can close).
 *
 * Two things this deliberately does not do. It never computes from a dive
 * profile — depth and bottom time are a computer's business, and DiveDay is
 * not a dive computer. And it never chooses the shorter reading when the
 * record is ambiguous: a day whose record disagrees with its plan takes the
 * repetitive hours, and a record missing its last exit time anchors on the
 * boat's scheduled return rather than on an earlier dive.
 */
export type FlySafeBasis = "single" | "repetitive";

/** Where the clock started: the last recorded exit, or the boat's scheduled return. */
export type FlySafeAnchor = "last_dive" | "scheduled_return";

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
 * How far back "multiple days of diving" reaches, counted back from this
 * departure's start (issue #1439).
 *
 * DAN publishes no window at all — 18 hours covers "repetitive dives or
 * multiple days of diving" and stops there — so this figure is a reading, not
 * a quotation: a dive the previous calendar day is inside it, a dive three
 * days ago is not. 24 rather than the more conservative 72 because the error
 * it makes is already in the safe direction — {@link parseFlySafeHours}
 * refuses a `repetitive` shorter than `single`, so reading repetitive can only
 * ever lengthen a wait — and a window wide enough to catch a dive nobody
 * would call recent buys nothing for that.
 */
export const FLY_SAFE_MULTI_DAY_LOOKBACK_HOURS = 24;

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
   * This diver has a dive recorded at *this shop* inside
   * {@link FLY_SAFE_MULTI_DAY_LOOKBACK_HOURS} before this departure — DAN's
   * "multiple days of diving", which its 18 hours covers alongside repetitive
   * dives on one boat. A fact about a *person*, not about the departure: two
   * divers on one boat may honestly differ here, and anything memoising this
   * result must be keyed accordingly.
   */
  divedRecently: boolean;
  now: Date;
  hours: FlySafeHours;
};

export type FlySafeResult = {
  from: Date;
  basis: FlySafeBasis;
  anchor: FlySafeAnchor;
  /** The hours that produced `from`, for the sentence that names them. */
  hours: number;
};

/**
 * The instant a diver may fly from, or `null` when nothing on the record can
 * honestly say.
 *
 * - **Basis.** Repetitive by any of three routes: more than one dive the crew
 *   recorded, more than one dive the departure planned, or a dive this diver
 *   already had at this shop inside
 *   {@link FLY_SAFE_MULTI_DAY_LOOKBACK_HOURS}. A record short of its plan is a
 *   crew that logged one tank of two more often than it is a day cut to one
 *   tank, and the longer wait is the one that costs a diver nothing if wrong.
 *   None of the three can ever *shorten* a wait: {@link parseFlySafeHours}
 *   refuses a `repetitive` shorter than `single`, so reaching repetitive is
 *   monotonic by construction.
 * - **Anchor.** The latest recorded exit, provided no later-numbered dive was
 *   recorded without one. Otherwise the boat's scheduled return, and only once
 *   {@link hasReturned} says it is home — a "fly-safe from" for a boat still
 *   at sea would be a guess dressed as a fact.
 */
export function flySafeFrom(input: FlySafeInput): FlySafeResult | null {
  const { executedDives, plannedDives, endsAt, divedRecently, now, hours } = input;
  const diveCount = Math.max(executedDives.length, plannedDives);
  const basis: FlySafeBasis = diveCount > 1 || divedRecently ? "repetitive" : "single";
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

  if (lastExit && !laterDiveUntimed) {
    return {
      from: new Date(lastExit.exitedAt.getTime() + wait * HOUR_MS),
      basis,
      anchor: "last_dive",
      hours: wait,
    };
  }
  if (endsAt && hasReturned(endsAt, now)) {
    // A later dive with no exit time: the return is the only instant on the
    // record that is not before that dive ended.
    const anchorAt = lastExit
      ? new Date(Math.max(lastExit.exitedAt.getTime(), endsAt.getTime()))
      : endsAt;
    return {
      from: new Date(anchorAt.getTime() + wait * HOUR_MS),
      basis,
      anchor: "scheduled_return",
      hours: wait,
    };
  }
  return null;
}
