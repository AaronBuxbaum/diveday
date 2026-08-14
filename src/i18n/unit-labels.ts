import type { CourseDepthFormat } from "@/lib/courses";
import type { DepthUnit } from "@/lib/depth-units";
import { depthInUnit } from "@/lib/depth-units";
import type { SeaState } from "@/lib/marine-forecast";
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

/**
 * The words a course page's `{depth18}` placeholders resolve to.
 *
 * Spelled out ("18 meters"), not abbreviated: these land mid-sentence in a
 * shop's own marketing prose, where "18 m" reads like a spec sheet. The
 * abbreviations above stay abbreviated because they sit in fact strips and
 * table cells, which is a different register.
 *
 * `src/lib/courses.ts` does the substitution and never sees a word — it hands
 * this the number already chosen from the agency pair (AGENTS.md — the domain
 * returns values, the UI picks the copy).
 */
export function courseDepthFormat(t: DiverTranslator, unit: DepthUnit): CourseDepthFormat {
  return {
    unit,
    withUnit: (value) =>
      t(unit === "feet" ? "course.depthUnits.feet" : "course.depthUnits.meters", { value }),
  };
}

/** A stored water temperature (Celsius) written out in the shop's unit. */
export function temperatureText(
  t: DiverTranslator,
  celsius: number,
  unit: TemperatureUnit,
): string {
  return t(TEMPERATURE_UNIT_KEYS[unit], { value: temperatureInUnit(celsius, unit) });
}

const SEA_STATE_KEYS: Record<SeaState, DiverMessageKey> = {
  glassy: "trip.seaState.glassy",
  calm: "trip.seaState.calm",
  light_chop: "trip.seaState.light_chop",
  choppy: "trip.seaState.choppy",
  rough: "trip.seaState.rough",
  very_rough: "trip.seaState.very_rough",
};

const SEA_STATE_DETAIL_KEYS: Record<SeaState, DiverMessageKey> = {
  glassy: "trip.seaStateDetail.glassy",
  calm: "trip.seaStateDetail.calm",
  light_chop: "trip.seaStateDetail.light_chop",
  choppy: "trip.seaStateDetail.choppy",
  rough: "trip.seaStateDetail.rough",
  very_rough: "trip.seaStateDetail.very_rough",
};

/**
 * The automated marine forecast's sea state, read out rather than measured out.
 *
 * This used to compose the model's own numbers — "0.7 m seas from E · 7 s
 * period", in the shop's depth unit, through three ICU templates for the
 * independently-absent bearing and period. Every part of that was true and
 * almost none of it was useful to the person reading it: significant wave
 * height is a statistic about the highest third of waves, a bearing answers a
 * question a diver on a booking page has not asked, and a period in seconds
 * means nothing without knowing what to compare it against. `seaStateReading`
 * (src/lib/marine-forecast.ts) does the comparing — height for the band,
 * period for how that band actually feels — and this turns its code into the
 * two lines a reader can act on: what the sea is, and what that means for
 * their day.
 *
 * The shop's `depth_unit` no longer reaches this: with no number left to
 * render there is nothing for it to decide.
 */
export function seaStateText(
  t: DiverTranslator,
  state: SeaState,
): { label: string; detail: string } {
  return { label: t(SEA_STATE_KEYS[state]), detail: t(SEA_STATE_DETAIL_KEYS[state]) };
}
