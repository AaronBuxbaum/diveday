import { describe, expect, it } from "vitest";
import { dayLoadOutLine } from "./load-out-labels";
import { staffTranslator } from "./staff-messages";

const t = staffTranslator("en-US");

describe("dayLoadOutLine", () => {
  it("says the tanks with their split, the pieces and the boats", () => {
    expect(
      dayLoadOutLine(t, {
        departures: 3,
        tanks: { total: 42, air: 36, nitrox: 6 },
        rentalPieces: 29,
      }),
    ).toBe("42 tanks to fill (36 air, 6 nitrox) · 29 rental pieces to pick · 3 departures");
  });

  it("drops the split with no nitrox and the pieces with none to pick", () => {
    expect(
      dayLoadOutLine(t, { departures: 1, tanks: { total: 1, air: 1, nitrox: 0 }, rentalPieces: 0 }),
    ).toBe("1 tank to fill · 1 departure");
  });

  it("speaks Spanish", () => {
    expect(
      dayLoadOutLine(staffTranslator("es-ES"), {
        departures: 2,
        tanks: { total: 12, air: 10, nitrox: 2 },
        rentalPieces: 1,
      }),
    ).toBe(
      "12 tanques por llenar (10 de aire, 2 de nitrox) · 1 pieza de alquiler por preparar · 2 salidas",
    );
  });
});
