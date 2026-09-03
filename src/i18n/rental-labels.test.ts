import { describe, expect, it } from "vitest";
import {
  catalogItemLabel,
  rentableItemLabel,
  rentalFitLineText,
  rentalItemLabel,
} from "./rental-labels";
import { staffTranslator } from "./staff-messages";

const t = staffTranslator("en-US");

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
    ).toBe("BCD M, Regulator, Wetsuit 5mm M");
  });
});
