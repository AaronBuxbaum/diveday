import { nowDate } from "@/lib/clock";

/**
 * A departure that only runs if enough people book it (a long-range charter, a
 * night dive: fuel and crew cost the same whether two or ten are aboard).
 *
 * The policy is two numbers on the trip: how many seats it needs, and how many
 * hours before departure the shop makes the call. Both null means the boat goes
 * with whoever booked, and nothing in this file has an opinion.
 *
 * **The deadline is a promise to the diver, not a reminder for the shop.** It
 * is published on the booking page before anyone pays ("runs with at least 4
 * divers; we'll confirm by Thu 14 Aug, 7:30 AM"), which makes the automatic
 * cancellation fair: the answer arrives at a time the diver was told in
 * advance, early enough to make another plan.
 */

/**
 * How long before departure the call is made, when a shop names a minimum but
 * not a window. Two days: far enough out that a diver can still book something
 * else, or a travelling one can change a flight, and late enough that the
 * weekend walk-ups a small boat lives on have had their chance to book.
 */
export const MINIMUM_SEATS_DECISION_HOURS_DEFAULT = 48;

/** The window a shop may set, in hours before departure. */
export const MIN_DECISION_HOURS = 1;
/** Two weeks. Past that the "decision" is not about how the trip is filling. */
export const MAX_DECISION_HOURS = 336;

/** The largest minimum a shop can name — the capacity ceiling trips share. */
export const MAX_MINIMUM_BOOKINGS = 60;

export type MinimumSeatsPolicy = {
  /** Seats needed for the trip to run; null = no minimum. */
  minimumBookings: number | null;
  /** Hours before departure the call is made; null = the default above. */
  minimumDecisionHours: number | null;
};

export type MinimumSeatsState =
  /** No minimum named — the boat goes with whoever booked. */
  | { kind: "none" }
  /** Enough seats sold. The trip is on regardless of what happens next. */
  | { kind: "met"; minimum: number; decidesAt: Date }
  /** Short, and the shop has not had to decide yet. */
  | { kind: "short"; minimum: number; shortfall: number; decidesAt: Date }
  /**
   * Short, and the deadline has passed: this departure is owed a cancellation.
   * The sweep (`src/db/trips-minimum.ts`) is what actually cancels it, so a
   * surface rendering this state is showing a trip the next pass will take
   * off the board — which is exactly what staff need to see in the window
   * where they can still ring around and save it.
   */
  | { kind: "due"; minimum: number; shortfall: number; decidesAt: Date };

/**
 * A minimum a trip can actually reach. A shop that sets a minimum of 6 and then
 * drops the boat to a 4-seat RIB has written a trip that can never run, and the
 * honest reading of that is "every seat", not "cancel it whatever happens".
 * Applied on read rather than on write so a later capacity change cannot strand
 * a departure — the same fail-open direction the age gate takes (H-20260724-certification-levels-agency-rules).
 */
export function effectiveMinimum(policy: MinimumSeatsPolicy, capacity: number): number | null {
  if (policy.minimumBookings === null) return null;
  return Math.min(policy.minimumBookings, capacity);
}

/** When the shop makes the call, or null when there is no minimum to call. */
export function minimumSeatsDecisionAt(trip: MinimumSeatsPolicy & { startsAt: Date }): Date | null {
  if (trip.minimumBookings === null) return null;
  const hours = trip.minimumDecisionHours ?? MINIMUM_SEATS_DECISION_HOURS_DEFAULT;
  return new Date(trip.startsAt.getTime() - hours * 60 * 60 * 1000);
}

export function minimumSeatsState(
  trip: MinimumSeatsPolicy & { startsAt: Date; capacity: number },
  booked: number,
  now: Date = nowDate(),
): MinimumSeatsState {
  const minimum = effectiveMinimum(trip, trip.capacity);
  const decidesAt = minimumSeatsDecisionAt(trip);
  if (minimum === null || decidesAt === null) return { kind: "none" };
  if (booked >= minimum) return { kind: "met", minimum, decidesAt };
  const shortfall = minimum - booked;
  // `>=`, so a trip whose deadline falls exactly now is already due. The sweep
  // uses the same comparison, and a surface that said "short" about a trip the
  // next pass will cancel would be a screen disagreeing with the database.
  return {
    kind: now.getTime() >= decidesAt.getTime() ? "due" : "short",
    minimum,
    shortfall,
    decidesAt,
  };
}

/**
 * **The sweep's cadence: hourly, at `:00`.** The deadline is printed on the
 * booking page to the minute, and an hourly pass makes that promise true to
 * within an hour, the resolution a shop states its window in (ADR
 * 20260813-minimum-head-count-departures). It keeps `:00`, the minute closest
 * to the printed deadline, as the first of the hourly passes staggered across
 * the minutes pinned in `src/lib/cron-schedule.test.ts` (one database wake an
 * hour).
 *
 * Mirrors `vercel.json`, and `src/lib/cron-schedule.test.ts` fails if the two
 * drift.
 */
export const MINIMUM_SEATS_CRON_CRONTAB = "0 * * * *";
