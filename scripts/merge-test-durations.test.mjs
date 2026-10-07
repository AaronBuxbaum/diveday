import { describe, expect, it } from "vitest";
import { mergeDurations } from "./merge-test-durations.mjs";

describe("mergeDurations", () => {
  it("is the union of every shard, sorted by path", () => {
    expect(
      mergeDurations([{ "src/b.test.ts": 20 }, { "src/a.test.ts": 10, "infra/c.test.ts": 5.4 }]),
    ).toEqual({ "infra/c.test.ts": 5, "src/a.test.ts": 10, "src/b.test.ts": 20 });
    expect(Object.keys(mergeDurations([{ b: 1 }, { a: 1 }]))).toEqual(["a", "b"]);
  });

  it("keeps the larger figure when two inputs name the same file", () => {
    expect(mergeDurations([{ a: 10 }, { a: 30 }, { a: 20 }])).toEqual({ a: 30 });
  });

  it("refuses an input that is not a map of durations", () => {
    expect(() => mergeDurations([[1, 2]])).toThrow(/one JSON object/);
    expect(() => mergeDurations([{ a: "slow" }])).toThrow(/not a duration/);
    expect(() => mergeDurations([{ a: -1 }])).toThrow(/not a duration/);
  });
});
