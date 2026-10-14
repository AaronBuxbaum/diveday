import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { allowedSpotStrings, findSpotWords } from "./check-seat-word.mjs";

/** The key paths the check objected to in one bundle. */
function flagged(bundle, file = "trips.json") {
  return findSpotWords(bundle, { file }).violations.map((violation) => violation.keyPath);
}

describe("everyone says seat", () => {
  it("reads nested keys and counts every string it passed", () => {
    const result = findSpotWords({ a: { b: { c: "3 seats left" } }, d: "Full", e: 7 });
    expect(result.strings).toBe(2);
    expect(result.violations).toEqual([]);
  });

  it("refuses the capacity word in every shape the staff pages had", () => {
    expect(flagged({ header: "{count, plural, one {# spot left} other {# spots left}}" })).toEqual([
      "header",
    ]);
    expect(flagged({ notice: { removed: "Booking canceled. The spot is open again." } })).toEqual([
      "notice.removed",
    ]);
    expect(flagged({ spine: { open: "3 Spots open" } })).toEqual(["spine.open"]);
  });

  it("refuses the diver words the booking had (fourth review, item 7)", () => {
    const diver = {
      booking: { heading: "Grab a spot", bookSpots: "Book these spots" },
      ready: { cancelSpot: "Cancel my spot" },
    };
    expect(flagged(diver, "diver.json")).toEqual([
      "booking.heading",
      "booking.bookSpots",
      "ready.cancelSpot",
    ]);
  });

  it("leaves a word that only contains the letters alone", () => {
    expect(flagged({ a: "Spotlight on the reef", b: "Spotted a turtle", c: "despot" })).toEqual([]);
  });

  it("lets the allowed string through only in its own file and key", () => {
    const hint = { form: { locationHint: "The dock, the boat deck, a spot on the reef." } };
    expect(flagged(hint, "incidents.json")).toEqual([]);
    expect(flagged(hint, "trips.json")).toEqual(["form.locationHint"]);
  });

  it("names only allowed strings that still exist and still say spot", async () => {
    for (const entry of allowedSpotStrings) {
      const [file, keyPath] = entry.split(":");
      const where =
        file === "diver.json"
          ? "../src/i18n/locales/en-US/diver.json"
          : `../src/i18n/locales/en-US/staff/${file}`;
      const bundle = JSON.parse(await readFile(new URL(where, import.meta.url), "utf8"));
      const value = keyPath.split(".").reduce((node, key) => node?.[key], bundle);
      expect(value, entry).toMatch(/\bspots?\b/i);
    }
  });
});
