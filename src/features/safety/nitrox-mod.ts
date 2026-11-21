/**
 * **The nitrox MOD line on `/ready`** (loop 5, row 9; glossary "Nitrox planning
 * line"): "32%: stay above 33 m / 110 ft", and only 32% (#3916), for a diver whose verified nitrox
 * card backs their nitrox request. A planning aid for the dive briefing and the
 * diver's own computer, **never a fill authorization**: the fill gate is
 * `authorizesNitroxFill` (`src/db/nitrox.ts`), the mix the diver breathes is the
 * one they analyze at the dock, and nothing here is read by a fill, the prep
 * list, readiness or the manifest.
 *
 * Boring on purpose. The depth is derived here from the mix and the ceiling,
 * never taken from a caller; the arithmetic is in integers, so 40% is 25 m and
 * not 24.99; and every figure rounds toward the surface, so the line is never
 * deeper than the maximum operating depth **under the table convention of 10 m
 * of seawater per bar** (feet from metres, about 32.8 ft per bar, a foot
 * shallower than 33 fsw tables). That convention, not physical seawater
 * density (about 9.95 m per bar), is the guarantee: at the mixes that divide
 * exactly (25, 28, 35, 40%) the physical limit is 0.1 to 0.2 m shallower, well
 * inside planning margin. Do not "fix" it to density believing that makes the
 * guarantee stronger; it changes the convention divers' tables and computers use.
 * The figure is the gas's oxygen limit, never the diver's depth: their
 * certification and the dive plan come first, and are usually shallower.
 */

/** The ppO2 the line plans at, in tenths of a bar: the recreational working ceiling. */
export const NITROX_PLANNING_PPO2_TENTHS = 14;

/**
 * The one mix the line names: 32%, the mix every nitrox card covers (#3916).
 * A card records no oxygen range and the shop records no fill mixes, so naming
 * 36% beside "Your nitrox card is verified" would read as permission to a
 * diver trained to EAN32 only. A richer mix comes back only with a card's
 * oxygen range or the shop's own fills, never inferred from the agency.
 */
export const NITROX_PLANNING_MIXES = [32] as const;

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
