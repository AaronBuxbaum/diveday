import { sunMoonFor } from "./sun-moon";
import { type WaterBand, waterBandFor } from "./water-band";

/**
 * **Which sky the page wears** — ADR 20260919-one-idea, decision I · Tide.
 *
 * Tide's premise is that the app *is* the day, so the top of every day-shaped
 * surface is the sky over the shop at the hour it is being read. This module is
 * the one thing that decides which of four skies that is, and it decides it
 * from the almanac rather than from a clock band: a shop in Key Largo and a
 * shop in Tromsø do not share an eight o'clock, and a sky that says dawn while
 * the sun is an hour up is the kind of wrongness a reader notices without being
 * able to name.
 *
 * **It informs and gates nothing.** `src/lib/sun-moon.ts` says that of itself
 * and this inherits it verbatim: no readiness rule, no admission rule, no
 * capacity or notification path reads a scheme. The sky is a picture of the
 * hour. If it were ever wrong, a diver would see a prettier or duller page and
 * nothing else would move.
 *
 * **A shop with no coordinates gets the clock.** The address form is optional,
 * and a whole timezone is far too coarse to derive a sunrise from — so rather
 * than guessing a sunrise, this falls back to {@link waterBandFor}'s own four
 * hour bands, which is what the water band has used since ADR
 * 20260904-reef-all-the-way-down. Same four names, same shop clock, one less
 * fact. `basis` says which answer you got, so a surface can offer the shop the
 * one line in Settings that upgrades it.
 *
 * Prose-free like the rest of `src/lib`: a scheme leaves here as one of four
 * codes and becomes a gradient in `globals.css` and a word, where a word is
 * wanted at all, in `src/i18n/`.
 */

/**
 * The four skies, in the order the day walks them. Deliberately the same four
 * names the water band already uses, because they are the same four moments —
 * a surface that carried both would be asking a reader to hold two vocabularies
 * for one sky.
 */
export const SKY_SCHEMES = ["dawn", "day", "dusk", "night"] as const;
export type SkyScheme = (typeof SKY_SCHEMES)[number];

/** Whether the scheme came from the sun over this place, or from the clock alone. */
export type SkyBasis = "almanac" | "clock";

export type SkyReading = {
  scheme: SkyScheme;
  basis: SkyBasis;
  /** When the sun comes up on this local day, or null (no place, or it does not). */
  sunriseAt: Date | null;
  sunsetAt: Date | null;
  /**
   * How far through the daylight the instant sits, 0 at sunrise and 1 at
   * sunset, or null before, after, or where there is no daylight to be through.
   * The strip draws the sun on its arc from this and nothing else.
   */
  daylightProgress: number | null;
};

/**
 * How long either side of the sun's own crossing still reads as dawn or dusk.
 *
 * Civil twilight (the sun 6° down) is the textbook answer and it is the wrong
 * one here: at this latitude it lasts under half an hour, so a shop whose first
 * boat leaves at 7:00 with sunrise at 7:02 would watch the page turn from night
 * to full day inside the time it takes to load a tank. Forty minutes is the
 * light a photographer would call the golden hour's near half, and it is what
 * makes a 6:40 AM home read as the morning it is.
 */
const TWILIGHT_MS = 40 * 60 * 1000;

/** The sky over a place at an instant, or over a clock where there is no place. */
export function skyReadingFor(input: {
  at: Date;
  timeZone: string;
  latitude: number | null;
  longitude: number | null;
}): SkyReading {
  const sun = sunMoonFor(input);
  if (!sun || sun.sunriseAt === null || sun.sunsetAt === null) {
    return {
      scheme: clockScheme(waterBandFor(input.at, input.timeZone)),
      basis: "clock",
      sunriseAt: sun?.sunriseAt ?? null,
      sunsetAt: sun?.sunsetAt ?? null,
      daylightProgress: null,
    };
  }
  const now = input.at.getTime();
  const sunrise = sun.sunriseAt.getTime();
  const sunset = sun.sunsetAt.getTime();
  const daylight = sunset - sunrise;
  return {
    scheme: almanacScheme(now, sunrise, sunset),
    basis: "almanac",
    sunriseAt: sun.sunriseAt,
    sunsetAt: sun.sunsetAt,
    daylightProgress:
      daylight > 0 && now >= sunrise && now <= sunset ? (now - sunrise) / daylight : null,
  };
}

function almanacScheme(now: number, sunrise: number, sunset: number): SkyScheme {
  if (now < sunrise - TWILIGHT_MS) return "night";
  if (now < sunrise + TWILIGHT_MS) return "dawn";
  if (now < sunset - TWILIGHT_MS) return "day";
  if (now < sunset + TWILIGHT_MS) return "dusk";
  return "night";
}

/**
 * The water band's four names are already the four skies, so the fallback is an
 * identity rather than a mapping — written out anyway, because the two types
 * are allowed to diverge later and a cast would hide the day that happened.
 */
function clockScheme(band: WaterBand): SkyScheme {
  return band;
}
