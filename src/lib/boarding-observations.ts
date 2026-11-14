import type { CourseAdmissionRefusal } from "./course-admission";

/**
 * **Why a boarding observation cannot take its seat back yet** (issue #4474).
 *
 * The observation stands either way: the desk saw the diver, and that is kept.
 * These codes say what stops the seat coming back, so the departure and the
 * board can say it until someone sorts it out.
 *
 * - `trip_full` / `divers_full`: the freed seat was sold, or the divers' places
 *   are gone. The observation keeps counting, so it takes the next seat.
 * - A course gate (`course_*`): the session cannot take the student back.
 * - `trip_cancelled`: the departure was called off.
 * - `turned_away_departed`: the desk turned this diver away and the boat has
 *   left; putting them back would show them aboard.
 * - `seat_moved`: the seat was moved to another departure after the tap.
 * - `seat_cancelled`: the seat was removed after the tap.
 * - `diver_erased`: the diver's personal data was erased after the tap.
 */
export type BoardingObservationConflict =
  | "trip_full"
  | "divers_full"
  | CourseAdmissionRefusal
  | "trip_cancelled"
  | "turned_away_departed"
  | "seat_moved"
  | "seat_cancelled"
  | "diver_erased";

export const BOARDING_OBSERVATION_CONFLICTS = [
  "trip_full",
  "divers_full",
  "course_unstaffed",
  "course_prerequisite",
  "course_min_age",
  "course_ratio_full",
  "trip_cancelled",
  "turned_away_departed",
  "seat_moved",
  "seat_cancelled",
  "diver_erased",
] as const satisfies readonly BoardingObservationConflict[];

/**
 * The conflicts that still want **this** departure's seat: no room, or a
 * course gate that a staffer can clear. While one stands the seat keeps
 * counting as held (`seatAwaitedAtDock`, src/db/trips-queries.ts), so it is
 * the next seat to open. The others hold nothing: the boat is called off, the
 * diver is ashore or elsewhere.
 */
export const SEAT_WAITING_CONFLICTS = [
  "trip_full",
  "divers_full",
  "course_unstaffed",
  "course_prerequisite",
  "course_min_age",
  "course_ratio_full",
] as const satisfies readonly BoardingObservationConflict[];

export function isBoardingObservationConflict(
  value: string | null | undefined,
): value is BoardingObservationConflict {
  return (BOARDING_OBSERVATION_CONFLICTS as readonly string[]).includes(value ?? "");
}

/** What the seat looks like when the allocation reads it under the departure's lock. */
export type ObservedSeatFacts = {
  /** The departure the observation was made at. */
  observedTripId: string;
  seat: {
    tripId: string;
    status: string;
    turnedAwayAt: Date | null;
    /** The diver's erasure, if one has run since the tap. */
    anonymizedAt: Date | null;
  } | null;
  trip: { status: string; startsAt: Date } | null;
  now: Date;
};

/**
 * The part of the allocation that needs no count: the seat still released, on
 * the departure the diver was seen at, on a departure still running. Capacity
 * and the course gates are asked after this, under the same lock.
 *
 * - `applied`: the seat is already held again (another tap or the rail took it
 *   back), so the observation is satisfied with nothing to write.
 * - `count`: go on and measure the boat.
 * - a conflict code: the observation stays open and says why.
 */
export function observationPrecheck(
  facts: ObservedSeatFacts,
):
  | { kind: "applied" }
  | { kind: "count" }
  | { kind: "conflict"; code: BoardingObservationConflict } {
  const { seat, trip } = facts;
  if (!seat || seat.status === "cancelled") return { kind: "conflict", code: "seat_cancelled" };
  if (seat.anonymizedAt !== null) return { kind: "conflict", code: "diver_erased" };
  if (seat.tripId !== facts.observedTripId) return { kind: "conflict", code: "seat_moved" };
  if (seat.status === "booked") return { kind: "applied" };
  if (seat.status !== "no_show") return { kind: "conflict", code: "seat_cancelled" };
  if (!trip) return { kind: "conflict", code: "seat_cancelled" };
  if (trip.status === "cancelled") return { kind: "conflict", code: "trip_cancelled" };
  // The same boundary `undoBookingNoShow` always kept: a diver turned away is
  // ashore once the scheduled start has passed (dde-3 #2).
  if (seat.turnedAwayAt !== null && facts.now.getTime() >= trip.startsAt.getTime()) {
    return { kind: "conflict", code: "turned_away_departed" };
  }
  return { kind: "count" };
}
