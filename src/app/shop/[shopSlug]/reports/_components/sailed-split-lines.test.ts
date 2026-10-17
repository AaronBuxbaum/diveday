import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { sailedSplitLines } from "./sailed-split-lines";

describe("sailedSplitLines", () => {
  it("words the split once for each figure, in both locales", () => {
    const split = {
      seats: { sailed: 104, toSail: 25 },
      fill: { sailed: 0.8, toSail: null },
      revenueCents: { sailed: 590_000, toSail: 63_900 },
    };
    const money = (cents: number) => `$${cents / 100}`;
    expect(sailedSplitLines(staffTranslator("en-US"), split, money)).toEqual({
      revenue: "Sailed $5900 · Still to sail $639",
      seats: "Sailed 104 · Still to sail 25",
      fill: "Sailed 80% · Still to sail —",
    });
    expect(sailedSplitLines(staffTranslator("es-ES"), split, money)?.seats).toBe(
      "Zarpado 104 · Por zarpar 25",
    );
    expect(sailedSplitLines(staffTranslator("en-US"), null, money)).toBeNull();
  });
});
