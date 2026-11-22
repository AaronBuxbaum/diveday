/**
 * Properties of `nitroxModFor` (src/features/safety/nitrox-mod.ts) and
 * `parseTankFill` (src/lib/counter-rentals.ts): only 22 to 40 percent O2 is a
 * nitrox mix, and MOD derives from the mix and the ppO2 ceiling. The function
 * takes no MOD from its caller (its one parameter is the mix), so "a
 * caller-supplied MOD is never trusted" is pinned by its signature, not here.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import { parseTankFill } from "@/lib/counter-rentals";
import { property } from "@/test/property";
import { NITROX_PLANNING_PPO2_TENTHS, nitroxModFor } from "./nitrox-mod";

const arbPercent = fc.oneof(
  fc.constantFrom(20, 21, 22, 40, 41, 42, 21.9, 40.1),
  fc.integer({ min: 15, max: 50 }),
  fc.integer({ min: -10, max: 120 }),
  fc.double({ min: 15, max: 50 }),
  fc.double(),
);

describe("nitroxModFor", () => {
  /** A MOD exists exactly for a whole percentage from 22 to 40. */
  property("accepts only whole 22 to 40 percent", [arbPercent], (o2) => {
    const accepted = Number.isInteger(o2) && o2 >= 22 && o2 <= 40;
    expect(nitroxModFor(o2) !== null).toBe(accepted);
  });

  /**
   * The MOD is the deepest whole metre, and the deepest whole foot, at which
   * the mix stays at or under the ppO2 ceiling: one more metre or foot would
   * exceed it (rounded down, never up, and never shallower than that).
   */
  property(
    "the MOD is the deepest whole metre and foot within the ppO2 ceiling",
    [fc.integer({ min: 22, max: 40 })],
    (o2) => {
      const mod = nitroxModFor(o2);
      expect(mod).not.toBeNull();
      if (!mod) return;
      expect(Number.isInteger(mod.meters) && mod.meters >= 0).toBe(true);
      // In integers: ppO2 × 1000 at depth d metres is (d + 10) × O2%.
      const ceiling = NITROX_PLANNING_PPO2_TENTHS * 100;
      expect((mod.meters + 10) * o2).toBeLessThanOrEqual(ceiling);
      expect((mod.meters + 11) * o2).toBeGreaterThan(ceiling);
      // Feet, with 3.28084 ft per metre as 328084 / 100000.
      const feetAtCeiling = (ceiling - 10 * o2) * 328_084;
      expect(mod.feet * 100_000 * o2).toBeLessThanOrEqual(feetAtCeiling);
      expect((mod.feet + 1) * 100_000 * o2).toBeGreaterThan(feetAtCeiling);
    },
  );

  /** A richer mix never has a deeper MOD, in metres or in feet. */
  property(
    "MOD never deepens as O2 rises",
    [fc.integer({ min: 22, max: 40 }), fc.integer({ min: 22, max: 40 })],
    (a, b) => {
      const [lean, rich] = a <= b ? [a, b] : [b, a];
      const leanMod = nitroxModFor(lean);
      const richMod = nitroxModFor(rich);
      expect(richMod?.meters ?? Number.NaN).toBeLessThanOrEqual(leanMod?.meters ?? Number.NaN);
      expect(richMod?.feet ?? Number.NaN).toBeLessThanOrEqual(leanMod?.feet ?? Number.NaN);
    },
  );
});

describe("parseTankFill", () => {
  /**
   * A typed fill is never rounded into a different mix: it is accepted
   * exactly when it reads "air" or a whole 21 to 40, and then it is that
   * number (air is 21); blank is "not recorded"; anything else is invalid.
   */
  property(
    "reads only air or a whole 21 to 40, never rounding",
    [
      fc.oneof(
        fc.string(),
        fc.nat(120).map(String),
        fc.constantFrom("32.5", "32%", "EAN32", "41", "20", " Air ", "32.0", "032", "21", "40", ""),
        fc
          .tuple(fc.integer({ min: 15, max: 45 }), fc.constantFrom("", ".5", ".0", "%", " "))
          .map(([n, suffix]) => `${n}${suffix}`),
      ),
    ],
    (raw) => {
      const fill = parseTankFill(raw);
      const text = raw.trim().toLowerCase();
      if (text === "") {
        expect(fill).toBeNull();
        return;
      }
      const accepted = /^(air|2[1-9]|3\d|40)$/.test(text);
      expect(fill).toBe(accepted ? (text === "air" ? 21 : Number(text)) : "invalid");
    },
  );
});
