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
