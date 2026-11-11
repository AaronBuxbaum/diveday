import { describe, expect, it } from "vitest";
import { diverTranslator } from "./messages";
import { includedGearList, includesScubaUnitOnly } from "./packing-labels";

describe("included gear words", () => {
  it("names personal kit alongside the scuba unit in both languages", () => {
    expect(
      includedGearList(["bcd", "regulator", "weights"], diverTranslator("en-US"), "en-US", [
        "snorkel",
        "boots",
      ]),
    ).toMatch(/Snorkel.*Boots/);
    expect(includedGearList([], diverTranslator("es-ES"), "es-ES", ["snorkel"])).toBe(
      diverTranslator("es-ES")("trip.personalGear.snorkel"),
    );
    expect(includesScubaUnitOnly(["bcd", "regulator", "weights"], ["snorkel"])).toBe(false);
  });
});
