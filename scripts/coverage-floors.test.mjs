import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  branchCoverage,
  compareFloors,
  FLOORS_PATH,
  matchedSafetyFiles,
  nextFloors,
  SAFETY_FILES,
  safetyFilesOnDisk,
} from "./coverage-floors.mjs";

const root = path.join(import.meta.dirname, "..");
const all = (pct) => Object.fromEntries(SAFETY_FILES.map((file) => [file, pct]));
const summaryEntry = (covered, total) => ({ branches: { covered, total, pct: 0 } });

describe("coverage-floors", () => {
  it.each([
    {},
    { covered: 1 },
    { total: 10 },
    { covered: null, total: 10 },
    { covered: "1", total: 10 },
    { covered: 1, total: "10" },
    { covered: -1, total: 10 },
    { covered: 1, total: -10 },
    { covered: 11, total: 10 },
    { covered: 0.5, total: 10 },
    { covered: Number.NaN, total: 10 },
    { covered: 1, total: Number.POSITIVE_INFINITY },
    { covered: 1e308, total: 1e308 },
    { covered: 1, total: 0 },
  ])("rejects malformed branch counts %j", (branches) => {
    expect(() => branchCoverage({ "src/lib/readiness.ts": { branches } })).toThrow(
      /invalid branch counts/,
    );
  });

  it.each([null, [], "bad"])("rejects a malformed summary %j", (summary) => {
    expect(() => branchCoverage(summary)).toThrow(/summary must be an object/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 101, "90", null])(
    "refuses malformed current and saved values in check and write mode: %s",
    (bad) => {
      const floors = all(80);
      const current = { ...all(90), "src/lib/readiness.ts": bad };
      const before = { ...floors };
      expect(compareFloors(floors, current).failures.join(" ")).toContain("invalid current");
      expect(nextFloors(floors, current, "approved fall").refused.join(" ")).toContain(
        "invalid current",
      );
      const malformed = { ...floors, "src/lib/readiness.ts": bad };
      expect(compareFloors(malformed, all(90)).failures.join(" ")).toContain("invalid saved");
      expect(nextFloors(malformed, all(90), "approved fall").refused.join(" ")).toContain(
        "invalid saved",
      );
      expect(floors).toEqual(before);
    },
  );

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

  it("requires a floor for every non-test substrate and feature file the safety reviewer patterns match", () => {
    const fixture = [
      "src/db/readiness.ts",
      "src/db/readiness.test.ts",
      "src/features/seat-diver/store.ts",
      "src/db/seed-nitrox.ts",
      "src/db/seed-medical-alert.ts",
      "src/features/waiver-guardian-copy/store.ts",
      "src/test/substrate-fixtures/db/erasure-coverage-keeps.test-support.ts",
      "src/features/guardian-erasure/store.ts",
      "src/db/schema/erasure.ts",
      "src/features/anonymization/rules.ts",
      "src/lib/payments/erasure-failure.ts",
      "src/lib/waiver-copy.ts",
      "src/lib/format-date.ts",
      "src/db/shops.ts",
      "src/app/shop/manifests/page.tsx",
      "src/i18n/locales/en-US/diver.json",
      "scripts/manifest-thing.mjs",
    ];
    expect(matchedSafetyFiles(fixture)).toEqual([
      "src/db/readiness.ts",
      "src/db/schema/erasure.ts",
      "src/features/anonymization/rules.ts",
      "src/features/guardian-erasure/store.ts",
      "src/features/seat-diver/store.ts",
      "src/features/waiver-guardian-copy/store.ts",
      "src/lib/payments/erasure-failure.ts",
    ]);
  });

  it("holds every file on disk the patterns match to a floor", () => {
    const floors = JSON.parse(readFileSync(path.join(root, FLOORS_PATH), "utf8"));
    expect(SAFETY_FILES).toEqual(safetyFilesOnDisk(root));
    for (const file of ["src/db/readiness.ts", "src/db/manifests.ts", "src/db/nitrox.ts"]) {
      expect(SAFETY_FILES).toContain(file);
      expect(typeof floors[file], file).toBe("number");
    }
  });
});

describe("feature safety ownership", () => {
  it("keeps moved and future feature logic under coverage floors", () => {
    expect(
      matchedSafetyFiles([
        "src/features/check-in/store.ts",
        "src/features/card-restore/store.ts",
        "src/features/future-medical/store.ts",
        "src/features/future-medical/store.test.ts",
      ]),
    ).toEqual([
      "src/features/card-restore/store.ts",
      "src/features/check-in/store.ts",
      "src/features/future-medical/store.ts",
    ]);
  });
});

describe("branchless public contracts", () => {
  it("excludes only source-proven re-exports, retaining executable indexes", async () => {
    const { isReexportOnlyContract } = await import("./coverage-safety-files.mjs");
    expect(
      isReexportOnlyContract(
        '/** contract */\nexport { recordThing, type Thing } from "./store";\nexport type { Kind } from "./rules";',
      ),
    ).toBe(true);
    for (const source of [
      'export function readThing(input) { return input ? "yes" : "no"; }',
      "export const cap = process.env.CAP ? 1 : 2;",
      'import "./side-effects"; export { recordThing } from "./store";',
    ])
      expect(isReexportOnlyContract(source)).toBe(false);
  });
});
