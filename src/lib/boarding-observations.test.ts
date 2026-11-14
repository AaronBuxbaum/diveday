import { describe, expect, it } from "vitest";
import {
  BOARDING_OBSERVATION_CONFLICTS,
  isBoardingObservationConflict,
  type ObservedSeatFacts,
  observationPrecheck,
  SEAT_WAITING_CONFLICTS,
} from "./boarding-observations";

const startsAt = new Date("2026-11-14T13:00:00Z");
const before = new Date("2026-11-14T12:50:00Z");
const after = new Date("2026-11-14T13:10:00Z");

function facts(overrides: {
  seat?: Partial<NonNullable<ObservedSeatFacts["seat"]>> | null;
  trip?: Partial<NonNullable<ObservedSeatFacts["trip"]>> | null;
  now?: Date;
}): ObservedSeatFacts {
  return {
    observedTripId: "trip-a",
    seat:
      overrides.seat === null
        ? null
        : {
            tripId: "trip-a",
            status: "no_show",
            turnedAwayAt: null,
            anonymizedAt: null,
            ...overrides.seat,
          },
    trip: overrides.trip === null ? null : { status: "scheduled", startsAt, ...overrides.trip },
    now: overrides.now ?? after,
  };
}

/**
 * What stops a dock sighting taking its seat back before the boat is counted
 * (issue #4474). The observation itself always stands; these only say why the
 * seat does not come back yet.
 */
describe("observationPrecheck", () => {
  it.each([
    ["a released seat on a running boat is counted", facts({}), { kind: "count" }],
    [
      "a seat already held again is satisfied",
      facts({ seat: { status: "booked" } }),
      { kind: "applied" },
    ],
    ["a missing seat", facts({ seat: null }), { kind: "conflict", code: "seat_cancelled" }],
    [
      "a cancelled seat",
      facts({ seat: { status: "cancelled" } }),
      { kind: "conflict", code: "seat_cancelled" },
    ],
    [
      "an erased diver, even with the seat held again",
      facts({ seat: { status: "booked", anonymizedAt: after } }),
      { kind: "conflict", code: "diver_erased" },
    ],
    [
      "a seat moved to another departure",
      facts({ seat: { tripId: "trip-b" } }),
      { kind: "conflict", code: "seat_moved" },
    ],
    [
      "a seat moved and then held there is still moved, not applied",
      facts({ seat: { tripId: "trip-b", status: "booked" } }),
      { kind: "conflict", code: "seat_moved" },
    ],
    [
      "a seat in some other state",
      facts({ seat: { status: "pending_payment" } }),
      { kind: "conflict", code: "seat_cancelled" },
    ],
    ["a deleted departure", facts({ trip: null }), { kind: "conflict", code: "seat_cancelled" }],
    [
      "a called-off departure",
      facts({ trip: { status: "cancelled" } }),
      { kind: "conflict", code: "trip_cancelled" },
    ],
    [
      "a diver turned away once the boat has left",
      facts({ seat: { turnedAwayAt: before } }),
      { kind: "conflict", code: "turned_away_departed" },
    ],
    [
      "a diver turned away before the boat left is counted",
      facts({ seat: { turnedAwayAt: before }, now: before }),
      { kind: "count" },
    ],
    [
      "an automatic pass once the boat has sailed",
      { ...facts({ now: new Date("2026-11-14T15:00:00Z") }), automatic: true },
      { kind: "conflict", code: "boat_left" },
    ],
    [
      "a staffer at the desk once the boat has sailed",
      facts({ now: new Date("2026-11-14T15:00:00Z") }),
      { kind: "count" },
    ],
    [
      "an automatic pass before the boat sails",
      { ...facts({}), automatic: true },
      { kind: "count" },
    ],
  ] as const)("%s", (_name, input, expected) => {
    expect(observationPrecheck(input)).toEqual(expected);
  });
});

describe("conflict codes", () => {
  it("knows every code it lists and nothing else", () => {
    for (const code of BOARDING_OBSERVATION_CONFLICTS) {
      expect(isBoardingObservationConflict(code)).toBe(true);
    }
    expect(isBoardingObservationConflict("boat_full")).toBe(false);
    expect(isBoardingObservationConflict(null)).toBe(false);
  });

  it("keeps only room and course gates waiting for this departure's seat", () => {
    expect([...SEAT_WAITING_CONFLICTS].sort()).toEqual(
      BOARDING_OBSERVATION_CONFLICTS.filter(
        (code) =>
          code === "trip_full" ||
          code === "divers_full" ||
          code === "course_unstaffed" ||
          code === "course_ratio_full",
      ).sort(),
    );
  });
});
