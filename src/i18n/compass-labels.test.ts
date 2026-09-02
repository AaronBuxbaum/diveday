import { describe, expect, it } from "vitest";
import { CARDINAL_DIRECTIONS } from "@/lib/marine-forecast";
import { compassText } from "./compass-labels";
import { staffTranslator } from "./staff-messages";

const en = staffTranslator("en-US");
const es = staffTranslator("es-ES");

/**
 * **The test the codes existed for, and that nobody had written** (issue
 * #1270). Both surfaces that render a bearing called `.toUpperCase()` on the
 * code, so `"w"` read as `"W"` to a Spanish captain and `"so"` read as `"SO"`
 * to an English one — and every one of the eight bundle keys had no reader.
 */
describe("compass labels", () => {
  it("writes west with the reader's own letter, not English's", () => {
    // The whole reason `marine-forecast.ts` returns a code: O, not W.
    expect(compassText(en, "w")).toBe("W");
    expect(compassText(es, "w")).toBe("O");
    expect(compassText(en, "w")).not.toBe(compassText(es, "w"));
  });

  it("carries the letter through the two corners that touch west", () => {
    expect([compassText(es, "sw"), compassText(es, "nw")]).toEqual(["SO", "NO"]);
    expect([compassText(en, "sw"), compassText(en, "nw")]).toEqual(["SW", "NW"]);
  });

  it("answers for every direction the forecast can return", () => {
    // A code with no key would throw here rather than at a captain's screen.
    for (const code of CARDINAL_DIRECTIONS) {
      expect(compassText(en, code)).toMatch(/^[A-Z]{1,2}$/);
      expect(compassText(es, code)).toMatch(/^[A-Z]{1,2}$/);
    }
  });

  it("changes the wind line a captain actually reads, not just a letter", () => {
    // The composed sentence, through the same ICU template both surfaces use.
    // A live capture of this needs an Open-Meteo response, so the template is
    // where the fix is provable without one.
    const line = (t: typeof en, direction: string) =>
      t("trips.conditions.automatedWind", { speed: 14, direction, gusts: 0, hasGusts: "no" });
    expect(line(en, compassText(en, "w"))).toBe("14 kt W");
    expect(line(es, compassText(es, "w"))).toBe("14 kt O");
  });

  it("answers empty for an absent bearing, so its sentence still reads", () => {
    // Wave, wind and current directions arrive independently and any one can
    // be missing; every call site interpolates this into an ICU template.
    expect(compassText(en, null)).toBe("");
    expect(compassText(en, undefined)).toBe("");
  });
});
