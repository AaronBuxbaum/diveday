import { describe, expect, it } from "vitest";
import {
  catalogItemLabel,
  rentableItemLabel,
  rentalFitLineText,
  rentalItemLabel,
  statedSizesText,
} from "./rental-labels";
import { staffTranslator } from "./staff-messages";

const t = staffTranslator("en-US");

/** U+00A0: the only space a rental piece may hold. */
const NBSP = "\u00A0";

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
});
