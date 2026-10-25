import { describe, expect, it } from "vitest";

import {
  FAST_LANE_BUDGET_MS,
  HOT_MAX,
  ONE_TEST_MS,
  OWN_BUDGET_MS,
  pickCost,
  planFastLane,
  readHotSpecs,
  readNearBudget,
  renderSummary,
} from "./fast-lane.mjs";

const record = {
  "e2e/a.spec.ts": 30_000,
  "e2e/b.spec.ts": 90_000,
  "e2e/c.spec.ts": 200_000,
  "e2e/huge.spec.ts": 366_000,
  "e2e/booking.spec.ts": 150_000,
  "e2e/red.spec.ts": 120_000,
};

const strong = (entries) => new Map(entries.map(([pick, why]) => [pick, new Set(why)]));

describe("pickCost", () => {
  it("reads a spec's recorded time, and a default for one never recorded", () => {
    expect(pickCost("e2e/a.spec.ts", record)).toBe(30_000);
    expect(pickCost("e2e/new.spec.ts", record)).toBe(60_000);
  });

  it("charges a file:line pick one test, never more than its whole spec", () => {
    expect(pickCost("e2e/booking.spec.ts:12", record)).toBe(ONE_TEST_MS);
    expect(pickCost("e2e/a.spec.ts:3", record)).toBe(30_000);
  });
});

describe("planFastLane", () => {
  it("runs strong picks inside about four CI-minutes, edited specs first, smoke last", () => {
    const plan = planFastLane({
      record,
      strong: strong([
        ["e2e/booking.spec.ts:40", ["smoke"]],
        ["e2e/c.spec.ts", ["edited"]],
        ["e2e/a.spec.ts", ['quotes "Book now"']],
        ["e2e/b.spec.ts", ["/shop/[shopSlug]/trips"]],
      ]),
    });
    expect(FAST_LANE_BUDGET_MS).toBe(240_000);
    // c (200 s, edited) then a (30 s) fit; b (90 s) would pass 240 s; the smoke test (60 s) too.
    expect(plan.specs).toEqual(["e2e/c.spec.ts", "e2e/a.spec.ts"]);
    expect(plan.left).toEqual(["e2e/b.spec.ts", "e2e/booking.spec.ts:40"]);
    expect(plan.strongMs).toBe(230_000);
  });

  it("skips a spec bigger than the whole budget and keeps filling with the cheaper ones", () => {
    const plan = planFastLane({
      record,
      strong: strong([
        ["e2e/huge.spec.ts", ["edited"]],
        ["e2e/a.spec.ts", ["edited"]],
      ]),
    });
    expect(plan.specs).toEqual(["e2e/a.spec.ts"]);
    expect(plan.left).toEqual(["e2e/huge.spec.ts"]);
  });

  it("puts the previous red run's specs and captures first, on a budget of their own", () => {
    const plan = planFastLane({
      record,
      strong: strong([
        ["e2e/red.spec.ts", ["edited"]],
        ["e2e/c.spec.ts", ["edited"]],
      ]),
      own: { specs: ["e2e/red.spec.ts"], captures: ["a station names a blocker aboard (light)"] },
      captureCost: () => 12_000,
    });
    expect(plan.specs).toEqual(["e2e/red.spec.ts", "e2e/c.spec.ts"]);
    expect(plan.captures).toEqual(["a station names a blocker aboard (light)"]);
    expect(plan.ownMs).toBe(132_000);
    expect(plan.strongMs).toBe(200_000);
  });

  it("bounds the previous run's list too, cheapest first", () => {
    const plan = planFastLane({
      record,
      own: { specs: ["e2e/huge.spec.ts", "e2e/c.spec.ts", "e2e/a.spec.ts", "e2e/b.spec.ts"] },
    });
    expect(OWN_BUDGET_MS).toBe(480_000);
    // a 30 + b 90 + c 200 = 320 s fit; huge (366 s) would pass 480 s.
    expect(plan.specs).toEqual(["e2e/a.spec.ts", "e2e/b.spec.ts", "e2e/c.spec.ts"]);
    expect(plan.left).toEqual(["e2e/huge.spec.ts"]);
  });

  it("leaves out a spec the branch deleted, and a smoke test whose file already runs", () => {
    const plan = planFastLane({
      record,
      strong: strong([
        ["e2e/gone.spec.ts", ["edited"]],
        ["e2e/a.spec.ts:7", ["smoke"]],
        ["e2e/a.spec.ts", ['quotes "Book now"']],
      ]),
      exists: (file) => file !== "e2e/gone.spec.ts",
    });
    expect(plan.specs).toEqual(["e2e/a.spec.ts"]);
    expect(plan.left).toEqual([]);
  });

  it("reads the CLI's JSON shape (an object of arrays) as well as Maps", () => {
    const plan = planFastLane({ record, strong: { "e2e/a.spec.ts": ["edited"] } });
    expect(plan.specs).toEqual(["e2e/a.spec.ts"]);
  });

  it("runs nothing when nothing is named", () => {
    expect(planFastLane({ record })).toEqual({
      specs: [],
      captures: [],
      left: [],
      strongMs: 0,
      ownMs: 0,
      fillMs: 0,
      filled: [],
    });
  });

  it("fills what the diff left with recent failures, newest first, then near-budget tests", () => {
    const plan = planFastLane({
      record,
      strong: strong([["e2e/c.spec.ts", ["edited"]]]),
      // c is the diff's (200 s), so 40 s is left: a (30 s) fits, b (90 s) does not, and the
      // near-budget test in a spec already running is covered by it.
      hot: ["e2e/c.spec.ts", "e2e/b.spec.ts", "e2e/a.spec.ts"],
      slow: ["e2e/a.spec.ts:9", "e2e/red.spec.ts:4"],
    });
    expect(plan.specs).toEqual(["e2e/c.spec.ts", "e2e/a.spec.ts"]);
    expect(plan.filled).toEqual(["e2e/a.spec.ts"]);
    expect(plan.fillMs).toBe(30_000);
    expect(plan.left).toEqual([]);
  });

  it("caps the fill at the budget, runs near-budget tests after the hot specs, and never a capture spec", () => {
    const plan = planFastLane({
      record,
      hot: ["e2e/visual-staff.spec.ts", "e2e/c.spec.ts", "e2e/gone.spec.ts"],
      slow: ["e2e/booking.spec.ts:12", "e2e/huge.spec.ts:3"],
      exists: (file) => file !== "e2e/gone.spec.ts",
    });
    // c 200 s, then one booking test (60 s) would pass 240 s; huge's test is charged 60 s too.
    expect(plan.specs).toEqual(["e2e/c.spec.ts"]);
    expect(plan.fillMs).toBe(200_000);
    expect(plan.fillMs + plan.strongMs).toBeLessThanOrEqual(FAST_LANE_BUDGET_MS);
    const roomy = planFastLane({
      record,
      hot: ["e2e/a.spec.ts"],
      slow: ["e2e/booking.spec.ts:12", "e2e/huge.spec.ts:3"],
    });
    expect(roomy.specs).toEqual(["e2e/a.spec.ts", "e2e/booking.spec.ts:12", "e2e/huge.spec.ts:3"]);
    expect(roomy.fillMs).toBe(150_000);
  });
});

describe("the fill's readings", () => {
  it("fails open when GitHub cannot be read, saying why", () => {
    const down = () => {
      throw new Error("could not resolve api.github.com");
    };
    expect(readHotSpecs("o/r", { request: down }).unknown).toMatch(/api\.github\.com/);
    expect(readNearBudget("o/r", { request: down }).unknown).toMatch(/api\.github\.com/);
  });

  it("reads the last main run's tests over 90% of their budget, worst first", () => {
    const request = (url) => {
      if (url.includes("/workflows/")) return { workflow_runs: [{ id: 7, head_sha: "abc123" }] };
      if (url.includes("/jobs")) {
        return {
          jobs: [
            { id: 1, name: "Playwright shard 1/6" },
            { id: 2, name: "Build" },
          ],
        };
      }
      return [
        { path: "e2e/a.spec.ts", start_line: 9, title: "e2e test at 91% of its budget" },
        { path: "e2e/b.spec.ts", start_line: 3, title: "e2e test at 104% of its budget" },
        { path: "e2e/c.spec.ts", start_line: 5, title: "e2e test at 85% of its budget" },
        { path: "e2e/d.spec.ts", start_line: 1, title: "Some other warning" },
      ];
    };
    expect(readNearBudget("o/r", { request })).toEqual({
      picks: ["e2e/b.spec.ts:3", "e2e/a.spec.ts:9"],
      sha: "abc123",
    });
  });

  it("reads recent-failure specs newest first, at most eight", () => {
    const request = (url) => {
      if (url.includes("/workflows/")) return { workflow_runs: [{ id: 1 }] };
      if (url.includes("/jobs"))
        return { jobs: [{ id: 5, name: "Playwright shard 2/6", conclusion: "failure" }] };
      return Array.from({ length: 10 }, (_, i) => ({
        path: `e2e/s${i}.spec.ts`,
        annotation_level: "failure",
      }));
    };
    const { specs } = readHotSpecs("o/r", { request, now: Date.parse("2026-10-24") });
    expect(HOT_MAX).toBe(8);
    expect(specs).toHaveLength(8);
    expect(specs[0]).toBe("e2e/s0.spec.ts");
  });
});

describe("renderSummary", () => {
  it("says the shards still decide, and lists what runs", () => {
    const text = renderSummary({
      plan: {
        specs: ["e2e/a.spec.ts"],
        captures: ["x (light)"],
        left: ["e2e/b.spec.ts"],
        strongMs: 30_000,
        ownMs: 12_000,
      },
      ownLine: "red (abcdef123).",
      strongLine: "1 strong pick(s) against origin/main.",
      hotLine: "skipped (CI history unreadable: offline).",
    });
    expect(text).toContain("- Recent failures: skipped (CI history unreadable: offline).");
    expect(text).toContain("the Playwright and visual capture shards still decide this run");
    expect(text).toContain("`e2e/a.spec.ts`");
    expect(text).toContain("capture: x (light)");
    expect(text).toContain("about 0.7 recorded CI-minutes");
    expect(text).toContain("Left to the shards by the budget: 1 pick(s).");
  });
});
