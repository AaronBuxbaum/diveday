/**
 * Properties of `refundOnCancellation` (src/lib/deposits.ts): what an
 * automated cancellation returns. Example tests: deposits.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { arbMoment, property } from "@/test/property";
import { refundOnCancellation } from "./deposits";

const HOUR = 60 * 60 * 1000;

describe("refundOnCancellation", () => {
  /**
   * A cancellation refund is whole cents between 0 and what was paid, at any
   * moment and under any stated window; a refund outcome needs a stated window.
   */
  property(
    "never returns more than was paid",
    [
      fc.integer({ min: -1_000_000, max: 100_000_000 }),
      arbMoment,
      arbMoment,
      fc.option(fc.integer({ min: 0, max: 24 * 30 }), { nil: null }),
    ],
    (paid, startsAt, now, hours) => {
      const decision = refundOnCancellation(
        { startsAt, cancellationWindowHours: hours },
        paid,
        now,
      );
      expect(Number.isSafeInteger(decision.refundCents)).toBe(true);
      expect(decision.refundCents).toBeGreaterThanOrEqual(0);
      expect(decision.refundCents).toBeLessThanOrEqual(Math.max(0, paid));
      if (!hours) expect(decision.outcome).toBe("no_policy");
    },
  );

  /**
   * A refund automates only inside the stated window: money comes back only
   * when the shop stated a window and the cancellation is before its
   * deadline; at or after the deadline the seat is forfeit and nothing moves.
   */
  property(
    "refunds only before the stated deadline",
    [
      fc.integer({ min: 1, max: 100_000_000 }),
      arbMoment,
      fc.integer({ min: 0, max: 24 * 30 }),
      fc.integer({ min: -3 * HOUR, max: 3 * HOUR }),
    ],
    (paid, startsAt, hours, fromDeadline) => {
      const deadline = startsAt.getTime() - hours * HOUR;
      const now = new Date(deadline + fromDeadline);
      const decision = refundOnCancellation(
        { startsAt, cancellationWindowHours: hours },
        paid,
        now,
      );
      if (decision.refundCents > 0) {
        expect(hours > 0 && now.getTime() < deadline).toBe(true);
      }
      if (hours > 0 && now.getTime() >= deadline) {
        expect(decision).toEqual({ refundCents: 0, outcome: "forfeit" });
      }
    },
  );
});
