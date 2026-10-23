import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { shops } from "@/db/schema";
import { SHOP_BOOLEAN_COVERAGE, STAFF_DESTINATION_COVERAGE } from "./feature-coverage";
import { ALL_SWITCHES_ON, SHOP_FEATURE_COLUMNS, SHOP_FEATURES } from "./shop-features";
import { STAFF_DESTINATIONS } from "./staff-destinations";

/**
 * **The guard** (Aaron, 2026-10-23): a feature a shop could run without gets
 * a Features switch, on by default, or a `core` entry saying why not. Each
 * failure below names what to classify and where.
 */
describe("every feature is considered for the Features page", () => {
  const switches = Object.keys(ALL_SWITCHES_ON);

  it("classifies every boolean column on shops", () => {
    const booleans = Object.entries(getTableColumns(shops))
      .filter(([, column]) => column.dataType === "boolean")
      .map(([name]) => name);
    const unclassified = booleans.filter((name) => !(name in SHOP_BOOLEAN_COVERAGE));
    expect(
      unclassified,
      "add each to SHOP_BOOLEAN_COVERAGE in src/lib/feature-coverage.ts: a switch, or { core: why }",
    ).toEqual([]);
    // And nothing classified that is not there any more.
    expect(Object.keys(SHOP_BOOLEAN_COVERAGE).filter((name) => !booleans.includes(name))).toEqual(
      [],
    );
  });

  it("maps every optional feature's column back to that feature", () => {
    for (const feature of SHOP_FEATURES) {
      expect(SHOP_BOOLEAN_COVERAGE[SHOP_FEATURE_COLUMNS[feature]], feature).toBe(feature);
    }
  });

  it("names only switches that exist, and a reason for every core entry", () => {
    for (const coverage of [
      ...Object.values(STAFF_DESTINATION_COVERAGE),
      ...Object.values(SHOP_BOOLEAN_COVERAGE),
    ]) {
      if (typeof coverage === "string") expect(switches).toContain(coverage);
      else if ("anyOf" in coverage) {
        expect(coverage.anyOf.length).toBeGreaterThan(1);
        for (const one of coverage.anyOf) expect(switches).toContain(one);
      } else expect(coverage.core.trim().length).toBeGreaterThan(0);
    }
    expect(Object.keys(STAFF_DESTINATION_COVERAGE).sort()).toEqual(
      STAFF_DESTINATIONS.map((destination) => destination.id).sort(),
    );
  });
});
