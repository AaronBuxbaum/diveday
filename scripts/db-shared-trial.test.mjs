import { describe, expect, it } from "vitest";
import { compareTrial, TRIAL_SEEDS } from "./db-shared-trial.mjs";

const receipts = () =>
  TRIAL_SEEDS.flatMap((seed) =>
    ["isolated", "shared"].flatMap((mode) =>
      Array.from({ length: 6 }, (_, i) => ({
        seed,
        mode,
        shard: i + 1,
        shards: 6,
        sha: "same-head",
        runner: "linux-x64-ubuntu24",
        nodeMajor: 24,
        coverage: true,
        elapsedSeconds: mode === "shared" ? 90 + i : 120 + i,
        tests: 10,
        passedTests: 9,
        pendingTests: 1,
        files: [`src/file-${i}.test.ts`],
        success: true,
        exitCode: 0,
      })),
    ),
  );

describe("shared database trial evidence", () => {
  it("compares every paired shard and the actual slowest shard", () => {
    const report = compareTrial(receipts());
    expect(report).toContain("| 441601 | 6 | 125 | 95 |");
    expect(report).toContain("| 441603 | slowest | 125 | 95 |");
  });
  it("refuses incomplete or duplicate fleets", () => {
    expect(() => compareTrial(receipts().slice(1))).toThrow("36 receipts");
    const rows = receipts();
    rows[1] = rows[0];
    expect(() => compareTrial(rows)).toThrow("Duplicate");
  });
  it.each(["sha", "runner", "nodeMajor"])("refuses mixed %s provenance", (field) => {
    const rows = receipts();
    rows[0][field] = "different";
    expect(() => compareTrial(rows)).toThrow("provenance");
  });
  it.each([
    { success: false },
    { exitCode: 124 },
    { coverage: false },
    { elapsedSeconds: 0 },
    { files: [] },
  ])("refuses failed, unmeasured or uncovered runs: %j", (patch) => {
    const rows = receipts();
    Object.assign(rows[0], patch);
    expect(() => compareTrial(rows)).toThrow("incomplete");
  });
  it("refuses changed file sets, shard membership, duplicate execution and test counts", () => {
    for (const patch of [
      { files: ["other.test.ts"] },
      { tests: 9 },
      { passedTests: 8, pendingTests: 2 },
    ]) {
      const rows = receipts();
      Object.assign(rows[0], patch);
      expect(() => compareTrial(rows)).toThrow();
    }
    const rows = receipts();
    rows[1].files = rows[0].files;
    expect(() => compareTrial(rows)).toThrow("multiple shards");
  });
});
