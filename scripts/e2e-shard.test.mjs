import { describe, expect, it } from "vitest";

import { dealSpecs, EXCLUDED_SPECS, estimateCost, listSpecs, partition } from "./e2e-shard.mjs";

const SHARDS = 4;

/**
 * The two properties that matter, in order of how badly they fail.
 *
 * **Coverage** is the one that fails silently. A deal that dropped a spec would
 * leave a green run over a suite that never ran it, and a deal that placed one
 * twice would only waste a minute. Both are pinned against the real tree, not a
 * fixture, because the tree is what CI deals.
 *
 * **Balance** is the point of the exercise: on the green main run of
 * 2026-08-31 the four shards took 4:09, 4:58, 4:38 and 7:39 with 124 or 125
 * tests each, because `--shard` cuts the sorted test list into equal-count
 * contiguous groups and the expensive specs cluster.
 */
describe("dealing the real e2e tree", () => {
  it("puts every spec in exactly one shard", async () => {
    const bins = await dealSpecs(SHARDS);
    const dealt = bins.flatMap((bin) => bin.items);
    const specs = await listSpecs();

    expect(specs.length).toBeGreaterThan(50);
    expect(dealt.slice().sort()).toEqual(specs.slice().sort());
    expect(new Set(dealt).size).toBe(dealt.length);
  });

  it("never deals the visual spec, which has its own shards and baselines", async () => {
    const bins = await dealSpecs(SHARDS);
    expect(bins.flatMap((bin) => bin.items)).not.toContain(EXCLUDED_SPECS[0]);
  });

  it("balances the shards far better than an equal-count cut would", async () => {
    const bins = await dealSpecs(SHARDS);
    const loads = bins.map((bin) => bin.load);
    const spread = (Math.max(...loads) - Math.min(...loads)) / Math.max(...loads);
    // The run is only as fast as its slowest shard, so the spread is the whole
    // measure. Generous enough to survive the suite growing; tight enough that
    // a regression to contiguous slicing fails it.
    expect(spread).toBeLessThan(0.15);
  });

  it("deals the same way twice, so two shards never disagree", async () => {
    // Not decoration: each of the four CI jobs computes this deal
    // independently, from its own checkout. If two disagreed, a spec would run
    // twice or not at all — and the second is a green run over nothing.
    const first = await dealSpecs(SHARDS);
    const second = await dealSpecs(SHARDS);
    expect(second.map((bin) => bin.items)).toEqual(first.map((bin) => bin.items));
  });
});

describe("estimateCost", () => {
  const spec = (body) => `import { test, expect } from "./fixtures";\n${body}`;

  it("counts one test per declaration", () => {
    const one = estimateCost(spec(`test("a", async () => {});`));
    const three = estimateCost(
      spec(`test("a", async () => {});\ntest("b", async () => {});\ntest("c", async () => {});`),
    );
    expect(three).toBeGreaterThan(one);
  });

  it("counts a modified declaration, and never a grouping or a hook", () => {
    const declarations = estimateCost(
      spec(`test.skip("a", async () => {});\ntest.only("b", async () => {});`),
    );
    const statics = estimateCost(
      spec(
        `test.describe("g", () => {});\ntest.use({ x: 1 });\ntest.beforeEach(async () => {});\ntest.setTimeout(1);`,
      ),
    );
    expect(declarations).toBeGreaterThan(statics);
    // Nothing but the per-file overhead: none of those four is a test.
    expect(statics).toBe(estimateCost(spec("")));
  });

  it("weights a private-shop spec far above a plain one of the same length", () => {
    const body = `test("a", async () => {});\ntest("b", async () => {});`;
    const plain = estimateCost(spec(body));
    const minted = estimateCost(
      spec(`test("a", async ({ privateShop }) => {});\ntest("b", async () => {});`),
    );
    // The mint plus the sign-in is ~3s per test against a ~1s plain test
    // (e2e/fixtures.ts), which is the cost `--shard` cannot see at all.
    expect(minted).toBeGreaterThan(plain * 1.5);
  });

  it("charges per distinct role signed in as, not per call", () => {
    const one = estimateCost(spec(`signedInAsOwner();\ntest("a", async () => {});`));
    const three = estimateCost(
      spec(
        `signedInAs("owner");\nsignedInAs("captain");\nsignedInAs("instructor");\ntest("a", async () => {});`,
      ),
    );
    const repeated = estimateCost(
      spec(`signedInAs("owner");\nsignedInAs("owner");\ntest("a", async () => {});`),
    );
    expect(three).toBeGreaterThan(one);
    expect(repeated).toBe(one);
  });
});

describe("partition", () => {
  const weigh = (weights) => weights.map((weight, index) => ({ item: `f${index}`, weight }));

  it("does not drag a quarter of the light files along with a heavy one", () => {
    // The failure `--shard` has: one enormous spec plus eleven small ones cut
    // into four contiguous groups gives the heavy group three companions.
    // Heaviest-first packing gives it none.
    const bins = partition(weigh([100, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), 4);
    const heavy = bins.find((bin) => bin.items.includes("f0"));
    expect(heavy.items).toEqual(["f0"]);
    expect(bins.flatMap((bin) => bin.items)).toHaveLength(12);
  });

  it("spreads equal weights evenly", () => {
    const bins = partition(weigh([5, 5, 5, 5, 5, 5, 5, 5]), 4);
    expect(bins.map((bin) => bin.load)).toEqual([10, 10, 10, 10]);
  });

  it("keeps every item when there are fewer items than bins", () => {
    const bins = partition(weigh([3, 2]), 4);
    expect(bins.flatMap((bin) => bin.items).sort()).toEqual(["f0", "f1"]);
    expect(bins.filter((bin) => bin.items.length === 0)).toHaveLength(2);
  });

  it("breaks ties the same way every time", () => {
    const input = weigh([4, 4, 4, 4, 4]);
    expect(partition(input, 3).map((b) => b.items)).toEqual(
      partition(input, 3).map((b) => b.items),
    );
  });
});
