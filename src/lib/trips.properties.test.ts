/**
 * Properties of `spotsRemaining`, `isFull` and `capacityLabel`
 * (src/lib/trips.ts): what a departure says about its open seats; and
 * `hasSailed`/`hasReturned`, the clock ladder's two named questions.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { arbMoment, property } from "@/test/property";
import { capacityLabel, hasReturned, hasSailed, isFull, spotsRemaining } from "./trips";

const arbCount = fc.record({
  capacity: fc.integer({ min: 0, max: 200 }),
  booked: fc.integer({ min: 0, max: 250 }),
});

describe("open seats", () => {
  /**
   * Open seats are never negative and never more than capacity less those
   * held; a full boat reports no open seats and says "full".
   */
  property("a full boat never reports open seats", [arbCount], (trip) => {
    const open = spotsRemaining(trip);
    expect(Number.isSafeInteger(open) && open >= 0).toBe(true);
    expect(open).toBeLessThanOrEqual(Math.max(0, trip.capacity - trip.booked));
    if (trip.booked >= trip.capacity) {
      expect(open).toBe(0);
      expect(isFull(trip)).toBe(true);
      expect(capacityLabel(trip)).toEqual({ kind: "full" });
    } else {
      expect(isFull(trip)).toBe(false);
      expect(capacityLabel(trip)).toEqual({ kind: "left", remaining: open });
    }
  });
});

const HOUR = 60 * 60 * 1000;

describe("sailed and returned", () => {
  /** Once a departure has sailed or returned, a later instant never says it has not. */
  property(
    "hasSailed and hasReturned are monotonic in time",
    [
      arbMoment,
      fc.integer({ min: -12 * HOUR, max: 12 * HOUR }),
      fc.integer({ min: 0, max: 10 * HOUR }),
    ],
    (scheduled, offset, later) => {
      const now = new Date(scheduled.getTime() + offset);
      const after = new Date(now.getTime() + later);
      if (hasSailed(scheduled, now)) expect(hasSailed(scheduled, after)).toBe(true);
      if (hasReturned(scheduled, now)) expect(hasReturned(scheduled, after)).toBe(true);
    },
  );
});
