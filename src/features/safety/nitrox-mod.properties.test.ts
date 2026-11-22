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
   * At its MOD a mix never exceeds the ppO2 ceiling (the depth is rounded
   * down, never up), and the MOD is a non-negative whole number of metres.
   */
  property(
    "the ppO2 at the MOD stays at or under the ceiling",
    [fc.integer({ min: 22, max: 40 })],
    (o2) => {
      const mod = nitroxModFor(o2);
      expect(mod).not.toBeNull();
      if (!mod) return;
      expect(Number.isInteger(mod.meters) && mod.meters >= 0).toBe(true);
      // ppO2 in tenths × 1000 to stay in integers: (meters / 10 + 1) × O2% / 100.
      expect((mod.meters + 10) * o2).toBeLessThanOrEqual(NITROX_PLANNING_PPO2_TENTHS * 100);
      expect(mod.feet).toBeLessThanOrEqual(Math.ceil(mod.meters * 3.28084) + 3);
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
  /** A typed fill is blank, invalid, or a whole percentage from air (21) to 40. */
  property(
    "reads only air through 40 percent",
    [fc.oneof(fc.string(), fc.nat(120).map(String))],
    (raw) => {
      const fill = parseTankFill(raw);
      if (fill === null || fill === "invalid") return;
      expect(Number.isInteger(fill) && fill >= 21 && fill <= 40).toBe(true);
    },
  );
});
