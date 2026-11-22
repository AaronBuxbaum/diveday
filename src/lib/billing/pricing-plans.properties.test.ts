/**
 * Properties of `percentFeeCents` (src/lib/billing/pricing-plans.ts): the
 * percent plan's monthly fee. Example tests: pricing-plans.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { property } from "@/test/property";
import { percentFeeCents } from "./pricing-plans";

const arbVolume = fc.integer({ min: -10_000_000, max: 1_000_000_000 });
const arbBasisPoints = fc.integer({ min: 0, max: 10_000 });

describe("percentFeeCents", () => {
  /** The fee is whole cents, never negative, and never more than the month's volume. */
  property("stays between 0 and the volume", [arbVolume, arbBasisPoints], (volume, bp) => {
    const fee = percentFeeCents(volume, bp);
    expect(Number.isSafeInteger(fee) && fee >= 0 && !Object.is(fee, -0)).toBe(true);
    expect(fee).toBeLessThanOrEqual(Math.max(0, volume));
  });

  /** More volume at the same rate never costs less. */
  property("is monotonic in volume", [arbVolume, arbVolume, arbBasisPoints], (a, b, bp) => {
    const [low, high] = a <= b ? [a, b] : [b, a];
    expect(percentFeeCents(low, bp)).toBeLessThanOrEqual(percentFeeCents(high, bp));
  });
});
