import type { CourseDepthFormat } from "@/lib/courses";
import type { DepthUnit } from "@/lib/depth-units";
import { depthInUnit, depthToMeters } from "@/lib/depth-units";
import type { SeaState, WindState } from "@/lib/marine-forecast";
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

/**
 * The shop's figure with the reader's after it, "60 ft (18 m)", when the
 * reader thinks in the other unit (fifth-loop ideas, item 22; `ReaderUnits`).
 * One ICU template, so a locale may set the pair its own way.
 */
function withReaderUnit(t: DiverTranslator, first: string, second: string | null): string {
  return second ? t("common.units.withReaderUnit", { first, second }) : first;
}

/**
 * A stored depth (metres) written out in the shop's unit, and in the reader's
 * after it when theirs differs.
 */
export function depthText(
  t: DiverTranslator,
  meters: number,
  unit: DepthUnit,
  reader: DepthUnit | null = null,
): string {
  const own = t(DEPTH_UNIT_KEYS[unit], { value: depthInUnit(meters, unit) });
  const theirs =
    reader && reader !== unit ? t(DEPTH_UNIT_KEYS[reader], { value: depthInUnit(meters, reader) }) : null;
  return withReaderUnit(t, own, theirs);
}

/**
 * A depth range the shop typed ("60–130 ft", "18 m"), with the reader's unit
 * after it when theirs differs: "60–130 ft (18–40 m)". Only a range written as
 * one or two numbers and a unit is converted; anything else is the shop's own
 * words and stays exactly as written.
 */
export function depthRangeText(
  t: DiverTranslator,
  written: string,
  reader: DepthUnit | null = null,
): string {
  const match = /^\s*(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*(ft|feet|m|meters)\s*$/i.exec(
    written,
  );
  if (!match || !reader) return written;
  const unit: DepthUnit = /^f/i.test(match[3]) ? "feet" : "meters";
  if (unit === reader) return written;
  const convert = (value: string) => depthInUnit(depthToMeters(Number(value), unit), reader);
  const value = match[2] ? `${convert(match[1])}–${convert(match[2])}` : `${convert(match[1])}`;
  return withReaderUnit(t, written, t(DEPTH_UNIT_KEYS[reader], { value }));
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

/**
 * A stored water temperature (Celsius) written out in the shop's unit, and in
 * the reader's after it when theirs differs: "79°F (26°C)".
 */
export function temperatureText(
  t: DiverTranslator,
  celsius: number,
  unit: TemperatureUnit,
  reader: TemperatureUnit | null = null,
): string {
  const own = t(TEMPERATURE_UNIT_KEYS[unit], { value: temperatureInUnit(celsius, unit) });
  const theirs =
    reader && reader !== unit
      ? t(TEMPERATURE_UNIT_KEYS[reader], { value: temperatureInUnit(celsius, reader) })
      : null;
  return withReaderUnit(t, own, theirs);
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

const WIND_STATE_KEYS: Record<WindState, DiverMessageKey> = {
  calm_wind: "trip.windState.calm_wind",
  light_breeze: "trip.windState.light_breeze",
  breezy: "trip.windState.breezy",
  windy: "trip.windState.windy",
  gale_warning: "trip.windState.gale_warning",
};

const WIND_STATE_DETAIL_KEYS: Record<WindState, DiverMessageKey> = {
  calm_wind: "trip.windStateDetail.calm_wind",
  light_breeze: "trip.windStateDetail.light_breeze",
  breezy: "trip.windStateDetail.breezy",
  windy: "trip.windStateDetail.windy",
  gale_warning: "trip.windStateDetail.gale_warning",
};

export function windText(t: DiverTranslator, state: WindState): { label: string; detail: string } {
  return { label: t(WIND_STATE_KEYS[state]), detail: t(WIND_STATE_DETAIL_KEYS[state]) };
}
