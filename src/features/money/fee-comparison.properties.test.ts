/**
 * Properties of `compareMonth` (src/features/money/fee-comparison.ts): the
 * /pricing comparison of a month's fees.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { property } from "@/test/property";
import { compareMonth } from "./fee-comparison";

const arbTerms = fc.record({
  monthlyCents: fc.integer({ min: 0, max: 100_000 }),
  basisPoints: fc.integer({ min: 0, max: 1_000 }),
});
const arbReceived = fc.integer({ min: 0, max: 1_000_000_000 });

describe("compareMonth", () => {
  /** Every system's total is the sum of its non-negative whole-cent parts. */
  property("a total is the sum of its parts", [arbReceived, arbTerms], (received, terms) => {
    for (const cost of compareMonth(received, terms)) {
      const parts = [
        cost.subscriptionCents,
        cost.bookingFeeCents,
        cost.otaFeeCents,
        cost.processingCents,
      ];
      for (const part of parts) expect(Number.isSafeInteger(part) && part >= 0).toBe(true);
      expect(cost.totalCents).toBe(parts.reduce((sum, part) => sum + part, 0));
    }
  });

  /** Taking more money in a month never makes any system cheaper. */
  property(
    "no system gets cheaper as volume rises",
    [arbReceived, arbReceived, arbTerms],
    (a, b, terms) => {
      const [low, high] = a <= b ? [a, b] : [b, a];
      const lower = compareMonth(low, terms);
      const higher = compareMonth(high, terms);
      lower.forEach((cost, index) => {
        expect(cost.totalCents).toBeLessThanOrEqual(higher[index]?.totalCents ?? Number.NaN);
      });
    },
  );
});
