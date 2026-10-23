import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { ALL_SWITCHES_ON, SHOP_FEATURES } from "@/lib/shop-features";
import { FEATURE_ROWS } from "./feature-rows";

/**
 * **Every switch has its row** (the guard in `src/lib/feature-coverage.ts`):
 * a switch the page does not draw could never be turned off, and a row with
 * no words would draw a key.
 */
describe("the Features page rows", () => {
  const switches = Object.keys(ALL_SWITCHES_ON);

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
