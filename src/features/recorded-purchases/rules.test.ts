import { describe, expect, it } from "vitest";
import { collectionShareCents } from "../../lib/collection-money";
import { remainingCounterReceipt } from "./rules";

describe("counter receipt proration", () => {
  it("keeps a zero-basis receipt excluded even at indivisible amounts", () => {
    const original = { taxCents: 1, tipCents: 1, passThroughCents: 1 };
    expect(remainingCounterReceipt(original, 3, 2)).toEqual({
      taxCents: 1,
      tipCents: 1,
      passThroughCents: 0,
    });
    expect(remainingCounterReceipt(original, 3, 1)).toEqual({
      taxCents: 0,
      tipCents: 1,
      passThroughCents: 0,
    });
  });
  it("always retains the exact ledger fee basis and never negative components", () => {
    for (let total = 1; total <= 30; total++)
      for (let tax = 0; tax <= total; tax++)
        for (let tip = 0; tip <= total - tax; tip++)
          for (let held = 0; held <= total; held++) {
            const original = {
              taxCents: tax,
              tipCents: tip,
              passThroughCents: Math.floor((total - tax - tip) / 2),
            };
            const split = remainingCounterReceipt(original, total, held);
            const excluded = split.taxCents + split.tipCents + split.passThroughCents;
            expect(excluded).toBe(
              held -
                collectionShareCents(total - tax - tip - original.passThroughCents, held, total),
            );
            expect(
              Math.min(split.taxCents, split.tipCents, split.passThroughCents),
            ).toBeGreaterThanOrEqual(0);
            expect(excluded).toBeLessThanOrEqual(held);
          }
  });
});
