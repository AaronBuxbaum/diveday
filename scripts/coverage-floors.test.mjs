import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  branchCoverage,
  compareFloors,
  FLOORS_PATH,
  nextFloors,
  SAFETY_FILES,
} from "./coverage-floors.mjs";

const root = path.join(import.meta.dirname, "..");
const all = (pct) => Object.fromEntries(SAFETY_FILES.map((file) => [file, pct]));
const summaryEntry = (covered, total) => ({ branches: { covered, total, pct: 0 } });

describe("coverage-floors", () => {
  it("keys the summary by repository path, whatever checkout the shard ran in", () => {
    const current = branchCoverage({
      total: summaryEntry(1, 2),
      "/home/runner/work/diveday/diveday/src/lib/readiness.ts": summaryEntry(166, 171),
      "/Users/ci/actions-runner/_work/diveday/diveday/src/db/bookings.ts": summaryEntry(3, 4),
      "src/lib/trips.ts": summaryEntry(0, 0),
    });
    expect(current).toEqual({
      "src/lib/readiness.ts": 97.07,
      "src/db/bookings.ts": 75,
      "src/lib/trips.ts": 100,
    });
  });

  it("rounds down, so a floor is never above what was measured", () => {
    expect(branchCoverage({ "src/a.ts": summaryEntry(2, 3) })["src/a.ts"]).toBe(66.66);
  });

  it("passes at the floor and reports a rise without failing", () => {
    const floors = all(90);
    const { failures, rises } = compareFloors(floors, { ...all(90), "src/lib/readiness.ts": 95 });
    expect(failures).toEqual([]);
    expect(rises).toEqual(["src/lib/readiness.ts: 90% → 95%"]);
  });

  it("fails a fall, a file with no coverage and a safety file with no floor", () => {
    const floors = { ...all(90) };
    delete floors["src/db/refunds.ts"];
    const current = { ...all(90), "src/lib/waivers.ts": 89.99 };
    delete current["src/db/checkouts.ts"];
    const { failures } = compareFloors(floors, current);
    expect(failures).toHaveLength(3);
    expect(failures.join("\n")).toMatch(/src\/lib\/waivers\.ts: branch coverage 89\.99%/);
    expect(failures.join("\n")).toMatch(/src\/db\/checkouts\.ts: no coverage recorded/);
    expect(failures.join("\n")).toMatch(/src\/db\/refunds\.ts: no floor yet/);
  });

  it("leaves note keys alone", () => {
    const floors = { "//": "note", "//absorbed": [], ...all(50) };
    expect(compareFloors(floors, all(50)).failures).toEqual([]);
  });

  it("--write banks rises and refuses a fall without a reason", () => {
    const floors = all(80);
    expect(nextFloors(floors, all(85)).floors["src/lib/authz.ts"]).toBe(85);
    const fell = { ...all(85), "src/lib/authz.ts": 70 };
    expect(nextFloors(floors, fell).refused).toEqual(["src/lib/authz.ts: 80% → 70%"]);
  });

  it("--write --absorb records the fall and its reason", () => {
    const fell = { ...all(85), "src/lib/authz.ts": 70 };
    const { floors } = nextFloors(all(80), fell, "deleted a dead branch's test with the branch");
    expect(floors["src/lib/authz.ts"]).toBe(70);
    expect(floors["//absorbed"]).toEqual([
      {
        why: "deleted a dead branch's test with the branch",
        files: { "src/lib/authz.ts": "80 -> 70" },
      },
    ]);
  });

  it("refuses to write when a safety file has no coverage at all", () => {
    const current = all(90);
    delete current["src/db/promo-caps.ts"];
    expect(nextFloors(all(80), current).refused).toEqual([
      "src/db/promo-caps.ts: no coverage recorded",
    ]);
  });

  it("has a floor for every safety file and the files exist", () => {
    const floors = JSON.parse(readFileSync(path.join(root, FLOORS_PATH), "utf8"));
    for (const file of SAFETY_FILES) {
      expect(typeof floors[file], file).toBe("number");
      expect(() => readFileSync(path.join(root, file)), file).not.toThrow();
    }
  });
});
