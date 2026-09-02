import { describe, expect, it } from "vitest";
import {
  estimateCost,
  PER_FILE_DB_COST,
  PER_FILE_PLAIN_COST,
  PER_TEST_DB_COST,
  PER_TEST_PLAIN_COST,
  partition,
} from "./shard-sequencer";

describe("estimateCost", () => {
  it("charges a database-backed file per test, at the hydration rate", () => {
    const source = `import { seededTestDb } from "@/test/db";
describe("x", () => {
  it("a", async () => {});
  it.each([1, 2])("b %s", async () => {});
  test("c", async () => {});
});`;
    expect(estimateCost(source)).toBe(PER_FILE_DB_COST + 3 * PER_TEST_DB_COST);
  });

  it("recognises the slow path taken without the helper", () => {
    const source = `import { createTestDb } from "@/db/client";
it("a", async () => { const db = await createTestDb(); });`;
    expect(estimateCost(source)).toBe(PER_FILE_DB_COST + PER_TEST_DB_COST);
  });

  it("charges a pure file almost nothing per test", () => {
    const source = `describe("x", () => {\n  it("a", () => {});\n  it("b", () => {});\n});`;
    expect(estimateCost(source)).toBe(PER_FILE_PLAIN_COST + 2 * PER_TEST_PLAIN_COST);
  });

  it("does not count a describe, a comment, or a mention in prose as a test", () => {
    const source = `// it("not a test")\ndescribe("it (the thing)", () => {\n  const it2 = 1;\n});`;
    expect(estimateCost(source)).toBe(PER_FILE_PLAIN_COST);
  });
});

describe("partition", () => {
  const weighted = (weights: number[]) => weights.map((weight, i) => ({ item: `f${i}`, weight }));

  it("puts every item in exactly one bin", () => {
    const items = weighted([9, 1, 8, 2, 7, 3, 6, 4, 5]);
    const bins = [1, 2, 3, 4].map((index) => partition(items, index, 4));
    expect(bins.flat().sort()).toEqual(items.map((i) => i.item).sort());
  });

  it("balances load rather than count", () => {
    // One heavy file and many light ones: an equal-count deal would give the
    // heavy file's bin a quarter of the light ones too.
    const items = weighted([100, ...Array(30).fill(1)]);
    const loads = [1, 2, 3, 4].map((index) =>
      partition(items, index, 4).reduce(
        (sum, item) => sum + items.find((i) => i.item === item)?.weight,
        0,
      ),
    );
    expect(loads[0]).toBe(100);
    expect(Math.max(...loads.slice(1)) - Math.min(...loads.slice(1))).toBeLessThanOrEqual(1);
  });

  it("is deterministic for a given order, and ties keep that order", () => {
    const items = weighted([5, 5, 5, 5, 5]);
    expect(partition(items, 1, 2)).toEqual(["f0", "f2", "f4"]);
    expect(partition(items, 2, 2)).toEqual(["f1", "f3"]);
    expect(partition(items, 1, 2)).toEqual(partition(items, 1, 2));
  });

  it("degrades to one bin holding everything", () => {
    const items = weighted([3, 1, 2]);
    expect(partition(items, 1, 1)).toEqual(["f0", "f2", "f1"]);
  });
});
