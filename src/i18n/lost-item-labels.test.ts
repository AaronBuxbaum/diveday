import { describe, expect, it } from "vitest";
import { foundItemsText } from "./lost-item-labels";
import { staffTranslator } from "./staff-messages";

describe("foundItemsText", () => {
  it("names each item in the crew's own words", () => {
    expect(foundItemsText(staffTranslator("en-US"), ["Blue mask, black strap"])).toBe(
      "In lost and found: Blue mask, black strap",
    );
    expect(foundItemsText(staffTranslator("es-ES"), ["Blue mask", "Fins"])).toBe(
      "En objetos perdidos: Blue mask · Fins",
    );
  });
});
