/**
 * Properties of `netOfRefund` (src/features/money/trip-money/rules.ts): what
 * is left of a part of a payment once some of the payment went back.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { property } from "@/test/property";
import { netOfRefund } from "./rules";

/** A payment split into parts that sum to it, and a refund of up to all of it. */
const arbSplit = fc
  .array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 6 })
  .chain((parts) => {
    const total = parts.reduce((sum, part) => sum + part, 0);
    return fc.tuple(fc.constant(parts), fc.constant(total), fc.integer({ min: 0, max: total }));
  });

describe("netOfRefund", () => {
  /** A part's net of refund is whole cents between 0 and the part. */
  property("stays between 0 and the part", [arbSplit], ([parts, total, refunded]) => {
    for (const part of parts) {
      const net = netOfRefund(part, total, refunded);
      expect(Number.isSafeInteger(net) && net >= 0 && !Object.is(net, -0)).toBe(true);
      expect(net).toBeLessThanOrEqual(part);
    }
  });

  /**
   * Splitting never creates a cent: the parts' nets sum to at most what the
   * payment kept, and floor rounding loses less than one cent per part. (It is
   * not conserving: `allocateSettledTotal` is the allocator that is.)
   */
  property("the parts never sum above what was kept", [arbSplit], ([parts, total, refunded]) => {
    const kept = total - refunded;
    const sum = parts.reduce((acc, part) => acc + netOfRefund(part, total, refunded), 0);
    expect(sum).toBeLessThanOrEqual(kept);
    expect(kept - sum).toBeLessThan(parts.length);
  });
});
