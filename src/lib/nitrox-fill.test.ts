import { describe, expect, it } from "vitest";
import { o2CleanWarnsForFill } from "./counter-rentals";
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
