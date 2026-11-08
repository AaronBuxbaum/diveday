import { describe, expect, it } from "vitest";
import {
  NITROX_PLANNING_MIXES,
  NITROX_PLANNING_PPO2_TENTHS,
  nitroxModFor,
  nitroxPlanningLines,
} from "./rules";

/**
 * **Safety-adjacent: the nitrox MOD line on `/ready`** (loop 5, row 9). A
 * planning aid, never a fill authorization: it is derived from the mix and the
 * 1.4 ceiling here, never taken from a caller, rounds every figure toward the
 * surface, and shows only once a verified card backs a nitrox request.
 */
describe("nitroxModFor", () => {
  it("says the row's own example: 32% stays above 33 m / 110 ft", () => {
    expect(nitroxModFor(32)).toEqual({ o2Percent: 32, meters: 33, feet: 110 });
  });

  it("rounds 36% toward the surface, never to the table's 29 m", () => {
    // Exactly 28.89 m and 94.8 ft; a rounded 29 m is deeper than the limit.
    expect(nitroxModFor(36)).toEqual({ o2Percent: 36, meters: 28, feet: 94 });
  });

  it("is exact where the arithmetic is exact, with no float drift", () => {
    // 1.4 / 0.40 is 3.4999… in floating point; integer arithmetic says 25 m.
    expect(nitroxModFor(40)).toEqual({ o2Percent: 40, meters: 25, feet: 82 });
    expect(nitroxModFor(28)).toEqual({ o2Percent: 28, meters: 40, feet: 131 });
  });

  it("never reports a depth deeper than the exact MOD at 1.4", () => {
    for (let o2 = 22; o2 <= 40; o2 += 1) {
      const mod = nitroxModFor(o2);
      if (!mod) throw new Error(`no MOD for ${o2}`);
      // Exact MOD × O2% = 1400 − 10 × O2%, compared in integers so the
      // reference carries no float drift of its own.
      const exactTimesO2 = 1400 - 10 * o2;
      expect(mod.meters * o2).toBeLessThanOrEqual(exactTimesO2);
      expect((mod.meters + 1) * o2).toBeGreaterThan(exactTimesO2);
      expect(mod.feet * o2 * 100_000).toBeLessThanOrEqual(exactTimesO2 * 328_084);
      expect((mod.feet + 1) * o2 * 100_000).toBeGreaterThan(exactTimesO2 * 328_084);
    }
  });

  it("refuses anything that is not a nitrox mix the shop may fill", () => {
    for (const bad of [21, 41, 0, -32, 100, 32.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(nitroxModFor(bad)).toBeNull();
    }
  });

  it("gives a richer mix a shallower limit, so a fill that analyzes rich is never covered by the 32% line", () => {
    // Dive-domain review, row 9, F2: a 33% fill read against "32%: 33 m" is a metre deep.
    const richer = nitroxModFor(33);
    const named = nitroxModFor(32);
    if (!richer || !named) throw new Error("no MOD");
    expect(richer.meters).toBeLessThan(named.meters);
    expect(richer.feet).toBeLessThan(named.feet);
  });

  it("plans at a ppO2 of 1.4, the recreational working ceiling", () => {
    expect(NITROX_PLANNING_PPO2_TENTHS).toBe(14);
  });
});

describe("nitroxPlanningLines", () => {
  const verified = { wantsNitrox: true, cardVerified: true, offered: true };

  // #3916: a card records no oxygen range, so a diver trained to EAN32 only
  // must never read a 36% line beside "Your nitrox card is verified".
  it("names 32% alone once a verified card backs the request", () => {
    expect(nitroxPlanningLines(verified)).toEqual([{ o2Percent: 32, meters: 33, feet: 110 }]);
    expect(NITROX_PLANNING_MIXES).toEqual([32]);
  });

  it("never names a mix richer than 32%, whatever the request", () => {
    for (const wantsNitrox of [true, false]) {
      for (const cardVerified of [true, false]) {
        for (const offered of [true, false]) {
          const lines = nitroxPlanningLines({ wantsNitrox, cardVerified, offered });
          expect(lines.every((line) => line.o2Percent <= 32)).toBe(true);
        }
      }
    }
  });

  it("shows nothing on an unverified, pending or self-declared card", () => {
    expect(nitroxPlanningLines({ ...verified, cardVerified: false })).toEqual([]);
  });

  it("shows nothing to a diver who has not asked for nitrox", () => {
    expect(nitroxPlanningLines({ ...verified, wantsNitrox: false })).toEqual([]);
  });

  it("shows nothing where this seat cannot be given nitrox at all", () => {
    expect(nitroxPlanningLines({ ...verified, offered: false })).toEqual([]);
  });
});
