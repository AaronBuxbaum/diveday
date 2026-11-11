import { describe, expect, it } from "vitest";
import { collectionShareCents } from "./collection-money";

describe("collection proration", () => {
  it("rounds half up in minor units, including zero-decimal currency amounts", () => {
    expect(collectionShareCents(1, 1, 2)).toBe(1);
    expect(collectionShareCents(5_000, 8_000, 10_000)).toBe(4_000);
  });
  it("does not lose a unit when intermediate multiplication is beyond float precision", () => {
    expect(collectionShareCents(2_000_000_001, 1_999_999_999, 2_000_000_000)).toBe(2_000_000_000);
  });
  it("refuses unknown, fractional or invalid money rather than guessing", () => {
    expect(() => collectionShareCents(1, 1, 0)).toThrow("collection_share_invalid_money");
    expect(() => collectionShareCents(1.2, 1, 2)).toThrow("collection_share_invalid_money");
  });
});
