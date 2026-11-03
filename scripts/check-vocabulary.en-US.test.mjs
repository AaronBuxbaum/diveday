import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { allowances, findRefusedWords } from "./check-vocabulary.mjs";

/** The key paths the check objected to in one bundle. */
function flagged(bundle, file = "staff/trips.json") {
  return findRefusedWords(bundle, { locale: "en-US", file }).violations.map(
    (violation) => violation.keyPath,
  );
}

describe("everyone says seat", () => {
  it("reads nested keys and counts every string it passed", () => {
    const result = findRefusedWords(
      { a: { b: { c: "3 seats left" } }, d: "Full", e: 7 },
      { locale: "en-US" },
    );
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
    expect(flagged(hint, "staff/incidents.json")).toEqual([]);
    expect(flagged(hint, "trips.json")).toEqual(["form.locationHint"]);
  });

  it("lets the walk-ins idiom through in the marketing content section only", () => {
    const page = { featurePages: { checkIn: { summary: "Walk-ins added on the spot." } } };
    expect(flagged(page, "content/marketing.json")).toEqual([]);
    expect(flagged(page, "marketing.json")).toEqual(["featurePages.checkIn.summary"]);
  });

  it("lets a field-guide species say spot, in the diver bundle only", () => {
    const guide = {
      marineLife: { species: { "lane-snapper": { description: "a dark spot high on the flank" } } },
    };
    expect(flagged(guide, "diver.json")).toEqual([]);
    expect(flagged(guide, "staff/trips.json")).toEqual([
      "marineLife.species.lane-snapper.description",
    ]);
    expect(flagged({ marineLife: { heading: "3 spots left" } }, "diver.json")).toEqual([
      "marineLife.heading",
    ]);
  });

  it("is never read in the words bundle, which holds no capacity word", () => {
    expect(flagged({ busy: "3 spots" }, "words.json")).toEqual([]);
  });

  it("names only allowed strings that still exist and still say the refused word", async () => {
    for (const { locales, entry } of allowances()) {
      const [file, keyPath] = entry.split(":");
      for (const locale of locales) {
        const where = `../src/i18n/locales/${locale}/${file}`;
        const bundle = JSON.parse(await readFile(new URL(where, import.meta.url), "utf8"));
        const value = keyPath
          .replace(/\.$/, "")
          .split(".")
          .reduce((node, key) => node?.[key], bundle);
        expect(value, entry).toBeDefined();
        if (!keyPath.endsWith(".")) expect(value, entry).toMatch(/\bspots?\b/i);
      }
    }
  });
});
