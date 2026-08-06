import type { DepthUnit } from "@/lib/depth-units";
import { depthInUnit, waveHeightInUnit } from "@/lib/depth-units";
import type { AutomatedSurfaceConditions, CardinalDirection } from "@/lib/marine-forecast";
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

const CARDINAL_DIRECTION_KEYS: Record<CardinalDirection, DiverMessageKey> = {
  n: "common.compass.n",
  ne: "common.compass.ne",
  e: "common.compass.e",
  se: "common.compass.se",
  s: "common.compass.s",
  sw: "common.compass.sw",
  w: "common.compass.w",
  nw: "common.compass.nw",
};

/**
 * The automated marine forecast's sea state, in the shop's own depth unit and
 * the reader's own language — "0.7 m waves from E · 7 s period" for a metric
 * shop, "2 ft waves from E · 7 s period" for the Florida crew who set feet
 * (DOM-L2). The unit comes from `shops.depth_unit`, the setting a shop already
 * has; the forecast deliberately never grew one of its own.
 *
 * Three templates rather than one with optional parts: a bearing and a period
 * are independently absent, and which clause a language drops last is not
 * English's to decide.
 *
 * The two wave-height templates say `{value, number}`, not the bare `{value}`
 * the depth and temperature templates above use. A bare placeholder
 * interpolates as text, which is invisible for the whole-number values those
 * two carry and wrong for this one: wave height is the only measurement in the
 * product with a fraction, so it is the only one where a Spanish reader would
 * otherwise be shown an English decimal point — "0.7 m" on a page that writes
 * 27 °C correctly beside it.
 */
export function surfaceConditionsText(
  t: DiverTranslator,
  surface: AutomatedSurfaceConditions,
  unit: DepthUnit,
): string {
  const waves = t(unit === "feet" ? "trip.surfaceWavesFeet" : "trip.surfaceWavesMeters", {
    value: waveHeightInUnit(surface.waveHeightMeters, unit),
  });
  const direction = surface.waveDirection
    ? t(CARDINAL_DIRECTION_KEYS[surface.waveDirection])
    : null;
  if (direction && surface.wavePeriodSeconds !== null) {
    return t("trip.surfaceWavesFromWithPeriod", {
      waves,
      direction,
      seconds: surface.wavePeriodSeconds,
    });
  }
  if (direction) return t("trip.surfaceWavesFrom", { waves, direction });
  if (surface.wavePeriodSeconds !== null) {
    return t("trip.surfaceWavesWithPeriod", { waves, seconds: surface.wavePeriodSeconds });
  }
  return waves;
}
