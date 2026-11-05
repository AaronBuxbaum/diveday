import { DAY_MS, HOUR_MS } from "./clock";

/**
 * **The departure's clock**: every window measured from when a departure leaves
 * or is due back is one rung on one ladder, here, and a question about the
 * clock is a named question on it (issue #2714). A module that needs "has it
 * sailed", "is push live", "is the recap due" asks this file; it does not
 * spell its own offset from `startsAt` or `endsAt`.
 *
 * **What this is not.** `trip-stages.ts` is what the crew said (a tap on the
 * manifest) and `trip-phase.ts` is the staff page's orientation, which lets a
 * tap beat the clock. This is what the clock alone implies, so the two stay two
 * things by design. The one window anchored on *now* rather than on a
 * departure, the horizon (`operational-window.ts`), is not here either.
 *
 * **The hour of grace.** Trips run late, so a departure is not "sailed" until
 * an hour past its scheduled time, nor "returned" until an hour past its
 * scheduled return ({@link DEPARTURE_BUFFER_MS}). `hasSailed` and `hasReturned`
 * in `trips.ts` are one-line questions over the `sailed` and `returned` rungs,
 * and `scripts/check-departure-buffer.mjs` refuses a fresh offset anywhere else.
 *
 * First slice (issue #2714): the rungs the push window, the sailed/returned
 * pair and the recap delay already spelled. The reminder buckets
 * (`reminders.ts`), the arrivals window and the stage-stale offset still keep
 * their own offsets and are the next rungs to move here.
 */

/** The standing late-arrival buffer: an hour past a scheduled time before "sailed" or "returned". */
export const DEPARTURE_BUFFER_MS = HOUR_MS;

type Anchor = "startsAt" | "endsAt";

/**
 * **The ladder, in order**: each rung is an instant on a departure's own
 * timeline, an offset from the scheduled start or end.
 *
 * - `day_before`: the 24-hour dock reminder's lead.
 * - `morning_of`: push opens, six hours ahead, the morning of rather than the
 *   week before (ADR 20260804-manifest-web-push).
 * - `boarding`: the scheduled departure.
 * - `sailed`: an hour past it ({@link DEPARTURE_BUFFER_MS}).
 * - `returned`: an hour past the scheduled return.
 * - `settled`: four hours past the scheduled return, when the automatic recap
 *   is due. It waits after a boat already counted as home.
 * - `past`: twelve hours past the end, strictly after which push is shut, so a
 *   late-running day still reaches the boat.
 */
const OFFSETS = {
  day_before: { anchor: "startsAt", ms: -DAY_MS },
  morning_of: { anchor: "startsAt", ms: -6 * HOUR_MS },
  boarding: { anchor: "startsAt", ms: 0 },
  sailed: { anchor: "startsAt", ms: DEPARTURE_BUFFER_MS },
  returned: { anchor: "endsAt", ms: DEPARTURE_BUFFER_MS },
  settled: { anchor: "endsAt", ms: 4 * HOUR_MS },
  past: { anchor: "endsAt", ms: 12 * HOUR_MS },
} as const satisfies Record<string, { anchor: Anchor; ms: number }>;

export type DepartureRung = keyof typeof OFFSETS;

/** Earliest first. A departure's phase is the last of these it has reached. */
export const DEPARTURE_RUNGS = [
  "day_before",
  "morning_of",
  "boarding",
  "sailed",
  "returned",
  "settled",
  "past",
] as const satisfies readonly DepartureRung[];

/** Where a departure is on its own timeline: before the first rung it is `week_out`. */
export type DeparturePhase = "week_out" | DepartureRung;

/** The scheduled instants a rung is measured from; a question names only the one its rung needs. */
type Anchors<R extends DepartureRung> = Record<(typeof OFFSETS)[R]["anchor"], Date>;

/** The offset of a rung from its anchor, for a module that must name the delay (the recap's). */
export function rungOffsetMs(rung: DepartureRung): number {
  return OFFSETS[rung].ms;
}

/** The instant a rung falls on for these scheduled times. */
export function rungTime<R extends DepartureRung>(rung: R, anchors: Anchors<R>): Date {
  const { anchor, ms } = OFFSETS[rung];
  const base = (anchors as Record<Anchor, Date>)[anchor];
  return new Date(base.getTime() + ms);
}

/** True from the rung's instant on. */
export function hasReached<R extends DepartureRung>(
  rung: R,
  anchors: Anchors<R>,
  now: Date,
): boolean {
  return now.getTime() >= rungTime(rung, anchors).getTime();
}

/** True strictly after the rung's instant. */
export function hasPassed<R extends DepartureRung>(
  rung: R,
  anchors: Anchors<R>,
  now: Date,
): boolean {
  return now.getTime() > rungTime(rung, anchors).getTime();
}

/**
 * **Where a departure is on its own timeline**, from the clock alone: the last
 * rung it has reached, `past` only once strictly past it (the instant push
 * closes still belongs to `settled`).
 */
export function departurePhase(trip: { startsAt: Date; endsAt: Date }, now: Date): DeparturePhase {
  let phase: DeparturePhase = "week_out";
  for (const rung of DEPARTURE_RUNGS) {
    const reached = rung === "past" ? hasPassed(rung, trip, now) : hasReached(rung, trip, now);
    if (!reached) break;
    phase = rung;
  }
  return phase;
}

/**
 * **Is manifest push live?** From the `morning_of` rung until the `past` rung
 * after the trip's own end. A row whose end is at or before its start (the
 * schema forbids it for schedule days, not for trips) never closes before the
 * departure it is about.
 */
export function pushIsLive(trip: { startsAt: Date; endsAt: Date }, now: Date): boolean {
  const end = trip.endsAt.getTime() > trip.startsAt.getTime() ? trip.endsAt : trip.startsAt;
  return hasReached("morning_of", trip, now) && !hasPassed("past", { endsAt: end }, now);
}
