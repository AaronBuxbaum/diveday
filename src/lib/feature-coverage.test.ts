import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FEATURE_ROWS } from "@/app/shop/[shopSlug]/settings/features/feature-rows";
import { shops } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
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
      else expect(coverage.core.trim().length).toBeGreaterThan(0);
    }
    expect(Object.keys(STAFF_DESTINATION_COVERAGE).sort()).toEqual(
      STAFF_DESTINATIONS.map((destination) => destination.id).sort(),
    );
  });

  it("draws every switch as exactly one row on the Features page", () => {
    expect(FEATURE_ROWS.map((row) => row.id).sort()).toEqual([...switches].sort());
  });

  it.each(["en-US", "es-ES"])("gives every row its words in %s", (locale) => {
    const t = staffTranslator(locale);
    const keys = FEATURE_ROWS.flatMap((row) => [
      row.headingKey,
      ...((SHOP_FEATURES as readonly string[]).includes(row.id)
        ? [`settings.main.features.${row.id}.label`, `settings.main.features.${row.id}.description`]
        : []),
    ]);
    for (const key of keys) {
      const words = t(key as Parameters<typeof t>[0]);
      expect(words, key).not.toBe(key);
      expect(words.trim().length, key).toBeGreaterThan(0);
    }
  });
});
