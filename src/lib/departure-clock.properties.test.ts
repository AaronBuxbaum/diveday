/**
 * Properties of the departure clock ladder (src/lib/departure-clock.ts): the
 * rungs keep their order for every departure, so a departure only ever moves
 * forward through its phases. Example tests: departure-clock.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { arbMoment, property } from "@/test/property";
import { DEPARTURE_PHASES, departurePhase, pushIsLive, recapIsDue } from "./departure-clock";

const HOUR = 60 * 60 * 1000;
const arbSchedule = fc
  .tuple(arbMoment, fc.integer({ min: -2 * HOUR, max: 14 * 24 * HOUR }))
  .map(([startsAt, length]) => ({ startsAt, endsAt: new Date(startsAt.getTime() + length) }));

describe("the departure clock ladder", () => {
  /**
   * The rungs are ordered: as time advances, a departure's phase never moves
   * back, whatever its length (a bad end before the start included).
   */
  property(
    "the phase never moves backward as time advances",
    [arbSchedule, fc.integer({ min: -10 * 24 * HOUR, max: 20 * 24 * HOUR }), fc.nat(3 * 24 * HOUR)],
    (trip, offset, step) => {
      const now = new Date(trip.startsAt.getTime() + offset);
      const later = new Date(now.getTime() + step);
      expect(DEPARTURE_PHASES.indexOf(departurePhase(trip, later))).toBeGreaterThanOrEqual(
        DEPARTURE_PHASES.indexOf(departurePhase(trip, now)),
      );
    },
  );

  /**
   * Push opens before the start and the recap is due only after the return:
   * push is never live before the push window opens, and the recap is never
   * due before the trip ends.
   */
  property(
    "push opens before the start; the recap waits for the return",
    [arbSchedule, fc.integer({ min: -10 * 24 * HOUR, max: 20 * 24 * HOUR })],
    (trip, offset) => {
      const now = new Date(trip.startsAt.getTime() + offset);
      if (now.getTime() < trip.startsAt.getTime() - 6 * HOUR)
        expect(pushIsLive(trip, now)).toBe(false);
      if (now.getTime() <= trip.endsAt.getTime()) expect(recapIsDue(trip.endsAt, now)).toBe(false);
      if (trip.startsAt.getTime() <= now.getTime() && now.getTime() <= trip.endsAt.getTime()) {
        expect(pushIsLive(trip, now)).toBe(true);
      }
    },
  );
});
