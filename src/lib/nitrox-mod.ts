/**
 * **The nitrox MOD line on `/ready`** (loop 5, row 9; glossary "Nitrox planning
 * line"): "32%: stay above 33 m / 110 ft", for a diver whose verified nitrox
 * card backs their nitrox request. A planning aid for the dive briefing and the
 * diver's own computer, **never a fill authorization**: the fill gate is
 * `authorizesNitroxFill` (`src/db/nitrox.ts`), the mix the diver breathes is the
 * one they analyze at the dock, and nothing here is read by a fill, the prep
 * list, readiness or the manifest.
 *
 * Boring on purpose. The depth is derived here from the mix and the ceiling,
 * never taken from a caller; the arithmetic is in integers, so 40% is 25 m and
 * not 24.99; and every figure rounds toward the surface, so the line is never
 * deeper than the exact maximum operating depth. Seawater, 10 m per bar: fresh
 * water would allow a little more, so this is the conservative reading.
 */

/** The ppO2 the line plans at, in tenths of a bar: the recreational working ceiling. */
export const NITROX_PLANNING_PPO2_TENTHS = 14;

/** The two mixes a shop most often fills, and the two the line names. */
export const NITROX_PLANNING_MIXES = [32, 36] as const;

/** The mixes a shop may fill at all (the counter's own 22 to 40, `TANK_FILL_O2_PERCENT`). */
const MIN_O2 = 22;
const MAX_O2 = 40;

/** Feet per metre, as a ratio of integers: 3.28084. */
const FEET_NUMERATOR = 328_084;
const FEET_DENOMINATOR = 100_000;

export type NitroxMod = { o2Percent: number; meters: number; feet: number };

/**
 * The maximum operating depth of one mix at a ppO2 of 1.4, in whole metres and
 * whole feet, each rounded down. Null for anything that is not a whole
 * percentage between 22 and 40.
 *
 * MOD (m) = 10 × (ppO2 / FO2 − 1) = (10 × ppO2 × 100 − 10 × O2%) / O2%, here
 * (1400 − 10 × O2%) / O2% with ppO2 in tenths.
 */
export function nitroxModFor(o2Percent: number): NitroxMod | null {
  if (!Number.isInteger(o2Percent) || o2Percent < MIN_O2 || o2Percent > MAX_O2) return null;
  const numerator = NITROX_PLANNING_PPO2_TENTHS * 100 - 10 * o2Percent;
  const meters = Math.floor(numerator / o2Percent);
  const feet = Math.floor((numerator * FEET_NUMERATOR) / (o2Percent * FEET_DENOMINATOR));
  return { o2Percent, meters, feet };
}

/**
 * The lines `/ready` shows: one per common mix, and only when the diver asked
 * for nitrox on this seat, the shop can give it to this seat, and a verified
 * card authorizes the fill. Anything less shows nothing, because a depth beside
 * a card nobody has checked reads as permission.
 */
export function nitroxPlanningLines(input: {
  wantsNitrox: boolean;
  /** `authorizesNitroxFill` holds for the diver right now (`ReadyPageData.nitroxCardVerified`). */
  cardVerified: boolean;
  /** This seat may be given nitrox at all (`nitroxAvailableOn`). */
  offered: boolean;
}): NitroxMod[] {
  if (!input.wantsNitrox || !input.cardVerified || !input.offered) return [];
  return NITROX_PLANNING_MIXES.map((mix) => nitroxModFor(mix)).filter(
    (mod): mod is NitroxMod => mod !== null,
  );
}
