import type { DepthUnit } from "@/lib/depth-units";
import { depthInUnit } from "@/lib/depth-units";
import type { TemperatureUnit } from "@/lib/temperature-units";
import { temperatureInUnit } from "@/lib/temperature-units";
import type { DiverMessageKey, DiverTranslator } from "./messages";

/**
 * Diver-facing measurements: the domain stores metres and Celsius and returns
 * numbers plus a unit code, and these two helpers are where a number becomes
 * "18 m" / "60 ft" / "24°C" / "75°F" in the reader's own language (AGENTS.md —
 * the domain returns codes, the UI picks the words).
 *
 * Both the value and the unit come out of one ICU template per unit, because
 * the spacing is not universal: "24°C" in English is "24 °C" in Spanish, and
 * gluing a translated abbreviation onto a number in JSX would pin that
 * decision to English forever. The staff bundle has its own
 * `shared.depth.*` labels for the same reason (src/i18n/depth-labels.ts) —
 * one code, two bundles, never shared strings.
 */
const DEPTH_UNIT_KEYS: Record<DepthUnit, DiverMessageKey> = {
  meters: "common.units.meters",
  feet: "common.units.feet",
};

const TEMPERATURE_UNIT_KEYS: Record<TemperatureUnit, DiverMessageKey> = {
  celsius: "common.units.celsius",
  fahrenheit: "common.units.fahrenheit",
};

/** A stored depth (metres) written out in the shop's unit. */
export function depthText(t: DiverTranslator, meters: number, unit: DepthUnit): string {
  return t(DEPTH_UNIT_KEYS[unit], { value: depthInUnit(meters, unit) });
}

/** A stored water temperature (Celsius) written out in the shop's unit. */
export function temperatureText(
  t: DiverTranslator,
  celsius: number,
  unit: TemperatureUnit,
): string {
  return t(TEMPERATURE_UNIT_KEYS[unit], { value: temperatureInUnit(celsius, unit) });
}
