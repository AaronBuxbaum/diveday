import { describe, expect, it } from "vitest";
import { RENTAL_FIT_TEXT_LIMITS } from "@/lib/rentals";
import {
  catalogItemLabel,
  rentableItemLabel,
  rentalFitLineText,
  rentalItemLabel,
  statedSizesText,
} from "./rental-labels";
import { staffTranslator } from "./staff-messages";

const t = staffTranslator("en-US");

/** U+00A0: a space the line may not break at. */
const NBSP = "\u00A0";

/** The longest stretch a line cannot break inside, in characters. */
function longestRun(text: string): number {
  return Math.max(...text.split(" ").map((run) => run.length));
}

describe("rental item labels", () => {
  it("resolves a dive-prep packing-list item's word, including boots", () => {
    expect(rentalItemLabel(t, "bcd")).toBe("BCD");
    expect(rentalItemLabel(t, "boots")).toBe("Boots");
    expect(rentalItemLabel(t, "mask_fins")).toBe("Mask & fins");
  });

  it("resolves a shop catalog gear item's word", () => {
    expect(rentableItemLabel(t, "wetsuit")).toBe("Wetsuit");
  });

  it("resolves a catalog entry's word, including the synthetic nitrox row", () => {
    expect(catalogItemLabel(t, "gopro")).toBe("GoPro");
    expect(catalogItemLabel(t, "nitrox")).toBe("Nitrox fills");
  });
});

describe("rentalFitLineText", () => {
  it("reads the not-recorded and own-kit states", () => {
    expect(rentalFitLineText(t, "en-US", { state: "not_recorded" })).toBe(
      "No fit on file, not asked yet",
    );
    expect(rentalFitLineText(t, "en-US", { state: "own_kit" })).toBe("Own kit");
  });

  it("reads the needs-staff-fit state, with and without a note", () => {
    expect(rentalFitLineText(t, "en-US", { state: "needs_staff_fit", note: null })).toBe(
      "Needs staff fit at check-in",
    );
    expect(rentalFitLineText(t, "en-US", { state: "needs_staff_fit", note: "No L BCD" })).toBe(
      "Needs staff fit — No L BCD",
    );
  });

  it("reads a rents line as a locale-joined list of items and sizes", () => {
    expect(
      rentalFitLineText(t, "en-US", {
        state: "rents",
        items: [
          { kind: "bcd", size: "M" },
          { kind: "regulator", size: null },
          { kind: "wetsuit", size: "5mm M" },
        ],
      }),
    ).toBe(`BCD${NBSP}M, Regulator, Wetsuit${NBSP}5mm${NBSP}M`);
  });

  it("wraps only between pieces, never inside one", () => {
    // "Weights 6 / kg" broke on the manifest's person panel at 390, where the
    // subtitle column is about 165px wide (K-66). Each piece is one unit; the
    // list's own separator is the only place a line may end.
    const text = rentalFitLineText(t, "en-US", {
      state: "rents",
      items: [
        { kind: "weights", size: "6 kg" },
        { kind: "mask_fins", size: "L" },
        { kind: "bcd", size: "M" },
      ],
    });
    expect(text).toBe(`Weights${NBSP}6${NBSP}kg, Mask${NBSP}&${NBSP}fins${NBSP}L, BCD${NBSP}M`);
    expect(text.split(", ").every((piece) => !piece.includes(" "))).toBe(true);
  });

  it("binds a measurement in a sentence-length size, and lets the sentence wrap", () => {
    // Gluing the whole free-text size made "Weights e.g. 16 lb with a 3 mm
    // suit" one run of about 250px, in a subtitle column about 165px wide on
    // the manifest's person sheet, which then scrolled sideways. The item holds
    // on to the size's first word, a number holds on to its unit, and every
    // other space is still a place the line may end.
    const text = rentalFitLineText(t, "en-US", {
      state: "rents",
      items: [{ kind: "weights", size: "e.g. 16 lb with a 3 mm suit" }],
    });
    expect(text).toBe(`Weights${NBSP}e.g. 16${NBSP}lb with a 3${NBSP}mm suit`);
    expect(text).toContain(" ");
  });

  it("wraps a weights answer as long as the field allows between its words", () => {
    const size =
      "Usually 12 lb with my 3 mm suit and 16 lb in the 7 mm; add 2 lb with an aluminium tank, less in fresh water at the lakes";
    expect(size).toHaveLength(RENTAL_FIT_TEXT_LIMITS.weightPreference);
    const text = rentalFitLineText(t, "en-US", {
      state: "rents",
      items: [
        { kind: "bcd", size: "M" },
        { kind: "weights", size },
      ],
    });
    expect(text).toContain(`, Weights${NBSP}Usually 12${NBSP}lb with my 3${NBSP}mm suit and `);
    // "Weights Usually" is the longest stretch the line has to keep together.
    expect(longestRun(text)).toBe("Weights Usually".length);
  });

  it("keeps a size system with its number inside a longer size", () => {
    // The fin-size field's own example is "US 9 / EU 42": four words, so not
    // one unit, but "US / 9" is the same split as "6 / kg".
    expect(
      rentalFitLineText(t, "en-US", {
        state: "rents",
        items: [{ kind: "mask_fins", size: "US 9 / EU 42" }],
      }),
    ).toBe(`Mask${NBSP}&${NBSP}fins${NBSP}US${NBSP}9 / EU${NBSP}42`);
  });

  it("keeps a no-longer-rented piece whole, while its explanation can still wrap", () => {
    expect(
      rentalFitLineText(t, "en-US", {
        state: "rents",
        items: [{ kind: "drysuit", size: "ML", notOffered: true }],
      }),
    ).toBe(`Drysuit${NBSP}ML (shop no longer rents this)`);
  });

  it("says a drysuit diver's fins have to clear the boot, with and without a size", () => {
    // The stated size is a shoe size (dive-prep.ts's `rentedItems`), so the
    // rail never reads it as the pair to hand over.
    expect(
      rentalFitLineText(t, "en-US", {
        state: "rents",
        items: [
          { kind: "mask_fins", size: "US 9", drysuitFinFit: true },
          { kind: "drysuit", size: "ML" },
        ],
      }),
    ).toBe(`Mask & fins over a drysuit boot, shoe US${NBSP}9, Drysuit${NBSP}ML`);
    expect(
      rentalFitLineText(t, "en-US", {
        state: "rents",
        items: [{ kind: "mask_fins", size: null, drysuitFinFit: true }],
      }),
    ).toBe("Mask & fins over a drysuit boot");
  });
});

describe("statedSizesText", () => {
  it("keeps each stated size with its item, and breaks only between them", () => {
    expect(
      statedSizesText(t, "en-US", [
        { kind: "bcd", size: "L" },
        { kind: "boots", size: "US 9" },
      ]),
    ).toBe(`BCD${NBSP}L, Boots${NBSP}US${NBSP}9`);
  });

  it("lets a sentence-length stated size wrap between its words", () => {
    // PrepBody's "asked for" line, where a size field holds 40 characters.
    const text = statedSizesText(t, "en-US", [
      { kind: "wetsuit", size: "3 mm shorty, or a 5 mm full when cold" },
    ]);
    expect(text).toBe(`Wetsuit${NBSP}3${NBSP}mm shorty, or a 5${NBSP}mm full when cold`);
    expect(longestRun(text)).toBe("Wetsuit 3 mm".length);
  });
});
