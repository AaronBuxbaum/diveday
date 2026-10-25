import { describe, expect, it } from "vitest";
import {
  MEMBRANE_PREMIX_O2_CLEAN_UP_TO,
  o2CleanWarnsForFill,
  TANK_FILL_O2_PERCENT,
} from "./counter-rentals";
import { NITROX_FILL_METHODS, parseNitroxFillMethod } from "./nitrox-fill";

/**
 * **Safety: when Rent out says a tank's oxygen cleaning is missing** (issue
 * 3004). Blending, the default, warns on every EANx fill, because pure oxygen
 * goes into the tank at any mix; membrane or premix warns only above 40%.
 * Advisory: nothing here gates a fill.
 */
describe("o2CleanWarnsForFill", () => {
  it("warns a blending shop above air, 22 to 40", () => {
    expect(o2CleanWarnsForFill("blending", 21)).toBe(false);
    expect(o2CleanWarnsForFill("blending", 22)).toBe(true);
    expect(o2CleanWarnsForFill("blending", 32)).toBe(true);
    expect(o2CleanWarnsForFill("blending", 40)).toBe(true);
  });

  it("warns a membrane or premix shop only above 40", () => {
    expect(o2CleanWarnsForFill("membrane_premix", 21)).toBe(false);
    expect(o2CleanWarnsForFill("membrane_premix", 32)).toBe(false);
    expect(o2CleanWarnsForFill("membrane_premix", 40)).toBe(false);
    expect(o2CleanWarnsForFill("membrane_premix", 41)).toBe(true);
  });

  it("says nothing for an unreadable fill", () => {
    for (const method of NITROX_FILL_METHODS) {
      expect(o2CleanWarnsForFill(method, Number.NaN)).toBe(false);
    }
  });
});

describe("parseNitroxFillMethod", () => {
  it("reads the two methods and nothing else", () => {
    expect(parseNitroxFillMethod("blending")).toBe("blending");
    expect(parseNitroxFillMethod("membrane_premix")).toBe("membrane_premix");
    for (const value of ["", "membrane", "BLENDING", null, undefined, 40]) {
      expect(parseNitroxFillMethod(value)).toBeNull();
    }
  });
});

/**
 * The fill menu stops at 40%, so a membrane or premix shop is never warned
 * today, and the Rentals hint says exactly that. Raising the menu above the
 * membrane/premix line would start warning those shops without the hint or
 * this decision being revisited, so it fails here first (issue 3004 review).
 */
describe("the fill menu's cap and the membrane/premix line", () => {
  it("keeps the menu's highest mix at or below the line", () => {
    expect(TANK_FILL_O2_PERCENT.max).toBeLessThanOrEqual(MEMBRANE_PREMIX_O2_CLEAN_UP_TO);
    expect(o2CleanWarnsForFill("membrane_premix", TANK_FILL_O2_PERCENT.max)).toBe(false);
  });
});
