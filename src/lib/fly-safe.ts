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
 * substantially longer, and nothing here can tell. And *repetitive* is
 * decided from this departure alone, so a single dive today after diving
 * yesterday reads as single, where DAN's 18 hours covers multiple days too
 * (issue #1439; the 18-hour default already meets that figure, and only a
 * shop that lowers `single` to DAN's 12 opens the gap).
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
 * - **Basis.** Repetitive when the day held more than one dive by *either*
 *   count — dives the crew recorded, or dives the departure planned. A record
 *   short of its plan is a crew that logged one tank of two more often than
 *   it is a day cut to one tank, and the longer wait is the one that costs a
 *   diver nothing if wrong.
 * - **Anchor.** The latest recorded exit, provided no later-numbered dive was
 *   recorded without one. Otherwise the boat's scheduled return, and only once
 *   {@link hasReturned} says it is home — a "fly-safe from" for a boat still
 *   at sea would be a guess dressed as a fact.
 */
export function flySafeFrom(input: FlySafeInput): FlySafeResult | null {
  const { executedDives, plannedDives, endsAt, now, hours } = input;
  const diveCount = Math.max(executedDives.length, plannedDives);
  const basis: FlySafeBasis = diveCount > 1 ? "repetitive" : "single";
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
