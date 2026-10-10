import { describe, expect, it } from "vitest";

import {
  dealSpecs,
  dealVisualTests,
  EXCLUDED_SPECS,
  estimateCost,
  listedTests,
  listSpecs,
  partition,
  readDurations,
  summarizeBins,
  testListLine,
  weigh,
} from "./e2e-shard.mjs";

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

/**
 * A deterministic heavy-tailed sample: most items a few seconds, a few ten
 * times that — the shape a browser suite's durations have, and the one an
 * equal-count cut handles worst.
 */
function heavyTail(count, seed = 7) {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  return Array.from({ length: count }, () => Math.round(1_000 + 2_000 * (1 / (next() + 0.05))));
}

const spreadOf = (bins) => {
  const loads = bins.map((bin) => bin.load);
  return (Math.max(...loads) - Math.min(...loads)) / Math.max(...loads);
};

describe("recorded durations", () => {
  it("weighs a recorded item by what it took, and a new one by its estimate on the same scale", () => {
    const weighted = weigh(
      [
        { item: "a", key: "a", estimate: 100 },
        { item: "b", key: "b", estimate: 300 },
        { item: "new", key: "new", estimate: 200 },
      ],
      { a: 10_000, b: 30_000 },
    );
    // 40,000 ms recorded over 400 estimated units: 100 ms a unit.
    expect(weighted).toEqual([
      { item: "a", weight: 10_000 },
      { item: "b", weight: 30_000 },
      { item: "new", weight: 20_000 },
    ]);
  });

  it("is exactly the estimate when nothing is recorded", () => {
    expect(weigh([{ item: "a", key: "a", estimate: 7 }], {})).toEqual([{ item: "a", weight: 7 }]);
  });

  it("deals the real tree within 10% on recorded durations, every spec once", async () => {
    const specs = await listSpecs();
    const sample = heavyTail(specs.length);
    const durations = Object.fromEntries(specs.map((spec, index) => [spec, sample[index]]));
    const bins = await dealSpecs(SHARDS, process.cwd(), durations);
    const dealt = bins.flatMap((bin) => bin.items);
    expect(dealt.slice().sort()).toEqual(specs);
    expect(spreadOf(bins)).toBeLessThan(0.1);
  });

  it("reads the committed file as two maps, and nothing when it is missing", async () => {
    const committed = await readDurations();
    expect(Object.keys(committed)).toEqual(["functional", "visual"]);
    expect(await readDurations("/nonexistent")).toEqual({ functional: {}, visual: {} });
  });
});

describe("the visual deal", () => {
  /** A `playwright test --list --reporter=json` report of `count` tests in two modes. */
  function listReport(count) {
    const half = count / 2;
    const suite = (mode) => ({
      title: mode,
      specs: Array.from({ length: half }, (_, index) => ({
        title: `surface ${index} renders true to the design (${mode})`,
        tests: [{ projectName: "chromium" }],
      })),
    });
    return {
      suites: [
        {
          title: "visual.spec.ts",
          file: "visual.spec.ts",
          suites: [suite("light"), suite("dark")],
        },
      ],
    };
  }

  it("names each test the way Playwright's --test-list reads it", () => {
    expect(listedTests(listReport(2))).toEqual([
      "visual.spec.ts › light › surface 0 renders true to the design (light)",
      "visual.spec.ts › dark › surface 0 renders true to the design (dark)",
    ]);
  });

  it("puts every test in exactly one of eight shards", () => {
    const report = listReport(548);
    const bins = dealVisualTests(report, 8);
    const dealt = bins.flatMap((bin) => bin.items);
    expect(dealt).toHaveLength(548);
    expect(new Set(dealt)).toEqual(new Set(listedTests(report)));
    expect(bins.every((bin) => bin.items.length > 0)).toBe(true);
  });

  it("balances eight shards within 10% on recorded durations", () => {
    const report = listReport(548);
    const lines = listedTests(report);
    const sample = heavyTail(lines.length, 11);
    const durations = Object.fromEntries(lines.map((line, index) => [line, sample[index]]));
    expect(spreadOf(dealVisualTests(report, 8, durations))).toBeLessThan(0.1);
    // What the index cut does to the same figures: contiguous equal-count slices.
    const cut = Array.from({ length: 8 }, (_, shard) => ({
      load: sample
        .slice((shard * 548) / 8, ((shard + 1) * 548) / 8)
        .reduce((sum, ms) => sum + ms, 0),
    }));
    expect(spreadOf(cut)).toBeGreaterThan(spreadOf(dealVisualTests(report, 8, durations)));
  });

  it("weighs a capture with no record at the mean of the recorded ones", () => {
    const report = listReport(4);
    const [a, b, c, d] = listedTests(report);
    // Two recorded at 10s and 30s; the two new ones each weigh the 20s mean,
    // so they share one bin and the recorded pair the other — 40s each. Had
    // they weighed nothing, all four would have been dealt around the 30s one.
    const bins = dealVisualTests(report, 2, { [a]: 10_000, [b]: 30_000 });
    expect(bins.map((bin) => bin.load)).toEqual([40_000, 40_000]);
    expect(bins.find((bin) => bin.items.includes(b)).items.sort()).toEqual([a, b].sort());
    expect(bins.flatMap((bin) => bin.items).sort()).toEqual([a, b, c, d].sort());
  });

  it("refuses a title a --test-list cannot name, rather than dropping the test", () => {
    expect(() => testListLine("visual.spec.ts", ["mode", "a › b"])).toThrow(/cannot be named/);
    expect(() => testListLine("visual.spec.ts", ["mode", " padded"])).toThrow(/cannot be named/);
    expect(testListLine("visual.spec.ts", ["mode", "a > b"])).toBe("visual.spec.ts › mode › a > b");
  });

  it("refuses two tests with one title path", () => {
    const report = listReport(2);
    report.suites[0].suites[1].title = "light";
    report.suites[0].suites[1].specs[0].title = report.suites[0].suites[0].specs[0].title;
    expect(() => listedTests(report)).toThrow(/share one title path/);
  });
});

describe("summarizeBins", () => {
  it("prints every bin's weight, marks this shard, and states the spread", () => {
    const text = summarizeBins(
      [
        { load: 90_000, items: ["a", "b"] },
        { load: 100_000, items: ["c"] },
      ],
      { title: "Playwright deal (2 shards)", shard: 2, recordedShare: 0.5 },
    );
    expect(text).toContain("### Playwright deal (2 shards)");
    expect(text).toContain("Spread 10.0%");
    expect(text).toContain("50% of items recorded");
    expect(text).toContain("| 1 | 90.0s | 2 |");
    expect(text).toContain("| **2** | 100.0s | 1 |");
  });

  it("prints estimate units, not seconds, before anything is recorded", () => {
    const text = summarizeBins([{ load: 4075, items: ["a"] }], {
      title: "t",
      shard: 1,
      unit: "units",
    });
    expect(text).toContain("| **1** | 4075 | 1 |");
  });
});
