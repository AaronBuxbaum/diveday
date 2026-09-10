import type { MoonPhase, NightSky } from "@/lib/sky";
import type { DiverMessageKey, DiverTranslator } from "./messages";

/**
 * A moon phase is a code (`src/lib/sky.ts`) — this map is where it becomes a
 * word in the reader's own language, the same shape `dive-site-labels.ts` uses
 * for a site's difficulty.
 */
const MOON_PHASE_KEYS: Record<MoonPhase, DiverMessageKey> = {
  new: "trip.sky.moon.new",
  waxingCrescent: "trip.sky.moon.waxingCrescent",
  firstQuarter: "trip.sky.moon.firstQuarter",
  waxingGibbous: "trip.sky.moon.waxingGibbous",
  full: "trip.sky.moon.full",
  waningGibbous: "trip.sky.moon.waningGibbous",
  lastQuarter: "trip.sky.moon.lastQuarter",
  waningCrescent: "trip.sky.moon.waningCrescent",
};

/**
 * **The one line a night departure carries about the sky**: when the light
 * goes, and how much moon there will be to dive under.
 *
 * One message rather than two fragments joined at a call site, so a locale owns
 * its own punctuation and word order. A departure at a latitude and season
 * where civil twilight never ends drops that half of the sentence rather than
 * printing a blank.
 *
 * The caller supplies the two already-formatted clock times, because a rendered
 * time names the zone and locale it is rendered in and only the surface knows
 * both.
 */
export function nightSkyLine(
  t: DiverTranslator,
  sky: NightSky,
  times: { sunset: string; dusk: string | null },
): string {
  const values = {
    sunset: times.sunset,
    moon: t(MOON_PHASE_KEYS[sky.phase]),
    percent: sky.illuminatedPercent,
  };
  return times.dusk === null
    ? t("trip.sky.nightLineNoDusk", values)
    : t("trip.sky.nightLine", { ...values, dusk: times.dusk });
}

/**
 * **The one line a daylight departure carries about the sky**: when the light
 * arrives and when it goes.
 *
 * The daytime twin of `nightSkyLine`, and the reason the night line does not
 * simply grow a sunrise: a diver reading a 7:00 AM two-tank wants the two ends
 * of the day, and one reading a 7:30 PM night charter wants the dark and the
 * moon. Neither wants the other's half.
 *
 * The caller supplies the two already-formatted clock times, because a rendered
 * time names the zone and locale it is rendered in and only the surface knows
 * both. A day at a latitude and season with no sunrise or no sunset has no line
 * at all — the caller passes nothing rather than a blank.
 */
export function daySkyLine(t: DiverTranslator, times: { sunrise: string; sunset: string }): string {
  return t("trip.sky.dayLine", times);
}

/**
 * When the moon comes up, as a sentence of its own.
 *
 * Separate from `nightSkyLine` rather than folded into it, because the moon
 * rises on its own schedule: roughly one local day a month has no moonrise at
 * all, and a message with an optional half is a message every locale has to
 * punctuate around. Two sentences, and the second one is simply absent.
 */
export function moonriseLine(t: DiverTranslator, moonrise: string): string {
  return t("trip.sky.moonrise", { moonrise });
}
