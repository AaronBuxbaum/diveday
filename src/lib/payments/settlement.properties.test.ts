/**
 * Properties of `netOfPercentDiscount` and `allocateSettledTotal`
 * (src/lib/payments/settlement.ts): what a percent-off code leaves, and how
 * one settled payment splits across a party. Example tests: settlement.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { arbCents, property } from "@/test/property";
import { allocateSettledTotal, netOfPercentDiscount } from "./settlement";

const arbPercent = fc.integer({ min: 0, max: 100 });

/** A non-negative integer that is not -0. */
function isCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

describe("netOfPercentDiscount", () => {
  /** What a discount leaves is whole cents between nothing and the full price. */
  property("stays between 0 and the price", [arbCents, arbPercent], (total, percent) => {
    const net = netOfPercentDiscount(total, percent);
    expect(isCents(net)).toBe(true);
    expect(net).toBeLessThanOrEqual(total);
  });

  /** A larger discount never leaves more to collect. */
  property(
    "never rises as the discount rises",
    [arbCents, arbPercent, arbPercent],
    (total, a, b) => {
      const [low, high] = a <= b ? [a, b] : [b, a];
      expect(netOfPercentDiscount(total, high)).toBeLessThanOrEqual(
        netOfPercentDiscount(total, low),
      );
    },
  );

  /** A 100% code leaves nothing, and a 0% code leaves the price. */
  property("100% is free and 0% is the price", [arbCents], (total) => {
    expect(netOfPercentDiscount(total, 100)).toBe(0);
    expect(netOfPercentDiscount(total, 0)).toBe(total);
  });
});

const arbShares = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 6 })
  .chain((keys) =>
    fc.tuple(
      fc.constant(keys),
      fc.array(fc.integer({ min: 0, max: 1_000_000 }), {
        minLength: keys.length,
        maxLength: keys.length,
      }),
    ),
  )
  .map(([keys, asked]) => keys.map((key, index) => ({ key, askedCents: asked[index] ?? 0 })));

describe("allocateSettledTotal", () => {
  /**
   * Splitting one settled payment across a party conserves it: the shares are
   * whole non-negative cents that sum to exactly the settled total, and when
   * the total is at most what was asked, no share exceeds its own ask.
   */
  property(
    "conserves the settled total and caps each share at its ask",
    [arbShares, fc.integer({ min: 0, max: 1_000 })],
    (shares, permille) => {
      const asked = shares.reduce((sum, share) => sum + share.askedCents, 0);
      const settled = Math.floor((asked * permille) / 1_000);
      const allocation = allocateSettledTotal(shares, settled);
      let sum = 0;
      for (const share of shares) {
        const cents = allocation.get(share.key) ?? Number.NaN;
        expect(isCents(cents)).toBe(true);
        if (asked > 0) expect(cents).toBeLessThanOrEqual(share.askedCents);
        sum += cents;
      }
      expect(sum).toBe(settled);
    },
  );
});
