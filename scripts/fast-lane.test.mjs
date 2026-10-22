import { describe, expect, it } from "vitest";

import {
  FAST_LANE_BUDGET_MS,
  ONE_TEST_MS,
  OWN_BUDGET_MS,
  pickCost,
  planFastLane,
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
    });
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
    });
    expect(text).toContain("the Playwright and visual capture shards still decide this run");
    expect(text).toContain("`e2e/a.spec.ts`");
    expect(text).toContain("capture: x (light)");
    expect(text).toContain("about 0.7 recorded CI-minutes");
    expect(text).toContain("Left to the shards by the budget: 1 pick(s).");
  });
});
