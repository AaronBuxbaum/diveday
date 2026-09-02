import { describe, expect, it } from "vitest";
import {
  estimateCost,
  PER_FILE_DB_COST,
  PER_FILE_FILE_SCOPED_DB_COST,
  PER_FILE_PLAIN_COST,
  PER_TEST_DB_COST,
  PER_TEST_FILE_SCOPED_DB_COST,
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

  /**
   * The bug of issue #1302: both helpers are exported from `@/test/db`, so the
   * import alone cannot tell a file that hydrates once from one that hydrates
   * per test — and the two are an order of magnitude apart. Measured on the
   * tree, `dive-sites` (per test) and `trips-queries` (file-scoped) ran 30 and
   * 29 tests for 46.6s and 1.9s.
   */
  it("charges a file-scoped file once for its database, not once per test", () => {
    const source = `import { fileScopedShopContext } from "@/test/db";
const ctx = fileScopedShopContext();
it("a", async () => {});
it("b", async () => {});`;
    expect(estimateCost(source)).toBe(
      PER_FILE_FILE_SCOPED_DB_COST + 2 * PER_TEST_FILE_SCOPED_DB_COST,
    );
  });

  /**
   * Two sources of the same shape and test count, differing only in the helper,
   * must not land near each other — which is exactly what the old estimate did,
   * billing them within 3% while they ran 11x apart.
   */
  it("separates the two helpers by more than the noise they were confused within", () => {
    // Thirty tests, the size of the pair this was measured on.
    const body = `\nit("t", async () => {});`.repeat(30);
    const perTest = estimateCost(
      `import { seededShopContext } from "@/test/db";\nconst c = await seededShopContext();${body}`,
    );
    const fileScoped = estimateCost(
      `import { fileScopedShopContext } from "@/test/db";\nconst ctx = fileScopedShopContext();${body}`,
    );
    expect(perTest).toBeGreaterThan(fileScoped * 2);
  });

  /**
   * The fixed term is shared, so from two tests up the cheap branch must cost
   * *less* than the expensive one at the same size. Raising `PER_FILE_DB_COST`
   * on the file-scoped branch alone put the crossover at about eight tests
   * instead, billing a small file-scoped file above a per-test one and handing
   * it to `partition` first — the packer wrong in a new place.
   *
   * One test is the degenerate size and is deliberately not asserted: both
   * files then hydrate exactly once, so the file-scoped one does the same work
   * plus a transaction, and costing marginally more is correct.
   */
  it("bills a file-scoped file below a per-test file of the same size", () => {
    for (const count of [2, 5, 10, 30, 90]) {
      const body = `\nit("t", async () => {});`.repeat(count);
      const perTest = estimateCost(
        `import { seededShopContext } from "@/test/db";\nconst c = await seededShopContext();${body}`,
      );
      const fileScoped = estimateCost(
        `import { fileScopedShopContext } from "@/test/db";\nconst ctx = fileScopedShopContext();${body}`,
      );
      expect(fileScoped, `at ${count} test(s)`).toBeLessThan(perTest);
    }
  });

  /**
   * `divers.test.ts` is this shape: file-scoped at the top, and one
   * `seededShopContext()` deep inside a single test. It pays a real hydration
   * for that test, so the cheap branch would under-bill it — and under-billing
   * is the worse direction, since `partition` then deals it last, onto a bin
   * that is already full.
   */
  it("bills a file using both helpers at the per-test rate", () => {
    const source = `import { fileScopedShopContext, seededShopContext } from "@/test/db";
const ctx = fileScopedShopContext();
it("a", async () => {});
it("b", async () => { const own = await seededShopContext(); });`;
    expect(estimateCost(source)).toBe(PER_FILE_DB_COST + 2 * PER_TEST_DB_COST);
  });

  /**
   * `today.test.ts` names `seededShopContext()` in the prose explaining why it
   * stopped using it, and `manifests.test.ts` names `fileScopedShopContext` in
   * the comment where it declines it. Neither mention is a call, and reading
   * either as one puts the file on the wrong branch — the same discipline
   * `TEST_DECLARATION` needs for `// it("not a test")` above.
   */
  it("reads a helper named in a comment as prose, not as a call", () => {
    const stillFileScoped = `import { fileScopedShopContext } from "@/test/db";
/**
 * This file was 72 tests each hydrating inside \`seededShopContext()\`, which
 * tripped the 20s ceiling on a contending shard.
 */
const ctx = fileScopedShopContext();
it("a", async () => {});`;
    expect(estimateCost(stillFileScoped)).toBe(
      PER_FILE_FILE_SCOPED_DB_COST + PER_TEST_FILE_SCOPED_DB_COST,
    );

    const stillPerTest = `import { seededShopContext } from "@/test/db";
// Declines fileScopedShopContext(): its inner transaction would become a savepoint.
it("a", async () => { const c = await seededShopContext(); });`;
    expect(estimateCost(stillPerTest)).toBe(PER_FILE_DB_COST + PER_TEST_DB_COST);
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
        (sum, item) => sum + (items.find((i) => i.item === item)?.weight ?? 0),
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
