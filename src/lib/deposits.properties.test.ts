/**
 * Properties of `refundOnCancellation` (src/lib/deposits.ts): what an
 * automated cancellation returns. Example tests: deposits.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { arbMoment, property } from "@/test/property";
import { refundOnCancellation } from "./deposits";

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
});
