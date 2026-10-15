import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIVER_LOCALES } from "./settings";

/**
 * **An email subject joins with a colon, never a dash** (fourth review,
 * item 49). A trip title often carries its own dash ("Two-Tank Reef — Benwood
 * & Molasses"), so "You’re on the boat — {tripTitle}" stacked two in an
 * inbox line. Every subject in the diver bundle is read here, in every locale.
 */
function subjects(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === "string") {
    return /subject/i.test(path.at(-1) ?? "") ? [[path.join("."), node]] : [];
  }
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) => subjects(value, [...path, key]));
  }
  return [];
}

describe("diver email subjects", () => {
  for (const locale of DIVER_LOCALES) {
    it(`never join with a dash in ${locale}`, () => {
      const bundle = JSON.parse(
        readFileSync(join(__dirname, "locales", locale, "diver.json"), "utf8"),
      ) as unknown;
      const found = subjects(bundle);
      expect(found.length).toBeGreaterThan(5);
      expect(found.filter(([, text]) => text.includes("—"))).toEqual([]);
    });
  }
});
