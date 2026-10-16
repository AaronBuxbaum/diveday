import { DAY_MS } from "@/lib/clock";
import { type MinimumSeatsPolicy, minimumSeatsState } from "@/lib/minimum-seats";

/**
 * **A quiet day's other question: which boats could use divers** (fifth-loop
 * ideas, item 43).
 *
 * Today looks a working week ahead (`OPERATIONAL_HORIZON_DAYS`), which is the
 * right reach for readiness work and the wrong one for filling a boat: a
 * departure eight to fourteen days out never reaches Today until it is too
 * late to fill. So on a day with no boats and nothing waiting, Today looks
 * {@link THIN_BOATS_HORIZON_DAYS} ahead for departures that could use divers.
 *
 * A departure could use divers when it is short of the minimum it must reach
 * to run (and the call has not been made yet), or, with no minimum, when less
 * than half of its seats are sold. A full or half-full boat is not shown.
 */
export const THIN_BOATS_HORIZON_DAYS = 14;
export const THIN_BOATS_HORIZON_MS = THIN_BOATS_HORIZON_DAYS * DAY_MS;

/** The most thin boats a quiet day lists. */
export const THIN_BOATS_SHOWN = 5;

export type ThinBoatInput = MinimumSeatsPolicy & {
  startsAt: Date;
  /** The seats actually on sale. */
  capacity: number;
  booked: number;
};

export type ThinBoatNeed =
  /** Short of its minimum: needs `shortfall` more by `decidesAt`. */
  | { kind: "minimum"; shortfall: number; decidesAt: Date }
  /** No minimum, and under half full. */
  | { kind: "seats" };

/** Why this departure could use divers, or `null` when it could not. */
export function thinBoatNeed(trip: ThinBoatInput, now: Date): ThinBoatNeed | null {
  if (trip.capacity <= 0 || trip.booked >= trip.capacity) return null;
  const minimum = minimumSeatsState(trip, trip.booked, now);
  if (minimum.kind === "short") {
    return { kind: "minimum", shortfall: minimum.shortfall, decidesAt: minimum.decidesAt };
  }
  // Due is the sweep's to cancel; met is on regardless.
  if (minimum.kind !== "none") return null;
  return trip.booked * 2 < trip.capacity ? { kind: "seats" } : null;
}
