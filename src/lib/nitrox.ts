/**
 * Nitrox (enriched-air / EANx) domain rules, kept framework-free so the fill
 * log, its tests, and any later dive-planning surface agree on what a valid
 * mix is and how deep it may be breathed.
 *
 * Safety invariants (docs/product/glossary.md — Nitrox fills):
 *   - only a recreational EANx mix is accepted; anything outside the band fails
 *     closed rather than being logged;
 *   - the maximum operating depth (MOD) is derived from the mix and an oxygen
 *     partial-pressure ceiling, never entered by hand;
 *   - the enriched-air card gate lives in the persistence layer — a fill is
 *     only written for a diver with verified nitrox evidence.
 */

/** Recreational EANx band. Below 22% is effectively air; above 40% is a technical mix. */
export const NITROX_MIN_O2_PERCENT = 22;
export const NITROX_MAX_O2_PERCENT = 40;

/** Default oxygen partial-pressure ceiling for the working portion of a dive, in bar. */
export const DEFAULT_MAX_PPO2_BAR = 1.4;

/** Persisted ppO2 ceilings are whole hundredths of a bar (140 = 1.4 bar) to stay integer-only. */
export const DEFAULT_MAX_PPO2_CENTIBAR = 140;

/** A whole-percent O2 fraction inside the recreational EANx band. */
export function isValidNitroxMix(oxygenPercent: number): boolean {
  return (
    Number.isInteger(oxygenPercent) &&
    oxygenPercent >= NITROX_MIN_O2_PERCENT &&
    oxygenPercent <= NITROX_MAX_O2_PERCENT
  );
}

/**
 * Maximum operating depth in metres of seawater:
 *   MOD = 10 · (ppO2 / FO2 − 1),  FO2 = oxygenPercent / 100.
 * Floored to a whole, conservative metre. Computed in integer centibar units
 * so exact cases (e.g. EAN28 at 1.4 bar = 40 m) don't drift on binary float
 * rounding. Throws on an out-of-band mix so a bad value never produces a depth.
 */
export function maxOperatingDepthMeters(
  oxygenPercent: number,
  maxPpO2Bar: number = DEFAULT_MAX_PPO2_BAR,
): number {
  if (!isValidNitroxMix(oxygenPercent)) {
    throw new Error(`maxOperatingDepthMeters: mix ${oxygenPercent}% is outside the EANx band`);
  }
  // 10·(ppO2/FO2 − 1) with ppO2 = centibar/100 and FO2 = oxygenPercent/100
  // simplifies to (10·centibar)/oxygenPercent − 10.
  const centibar = ppO2BarToCentibar(maxPpO2Bar);
  return Math.floor((10 * centibar) / oxygenPercent - 10);
}

/** Bar ↔ centibar helpers so callers keep a single integer representation in the DB. */
export function ppO2BarToCentibar(bar: number): number {
  return Math.round(bar * 100);
}

export function ppO2CentibarToBar(centibar: number): number {
  return centibar / 100;
}

/** "EAN32" label for a mix. */
export function nitroxMixLabel(oxygenPercent: number): string {
  return `EAN${oxygenPercent}`;
}
