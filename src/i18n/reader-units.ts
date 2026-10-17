import type { DepthUnit } from "@/lib/depth-units";
import type { TemperatureUnit } from "@/lib/temperature-units";

/**
 * **The unit a visitor thinks in** (fifth-loop ideas, item 22). A Keys shop
 * publishes feet and Fahrenheit, and a German or Brazilian diver reading
 * "60–130 ft" converts a safety figure in their head. The shop's unit stays
 * first; when the reader's differs, the page adds theirs after it.
 *
 * Read from the browser's first `Accept-Language` tag, because DiveDay speaks
 * two languages and a German reader is served English: the region the browser
 * names ("de-DE", "pt-BR", "en-GB") is the only first-hand sign of where they
 * measure from. A tag with no region says only a language, which is enough
 * for every language but English (an "en" reader may be American or not, so
 * nothing is added). With no header at all, a reader who picked Spanish reads
 * metric; anyone else gets the shop's unit alone.
 *
 * Null means "no second unit": the shop's own, which is never wrong, only
 * sometimes a conversion away.
 */
export type ReaderUnits = { depth: DepthUnit | null; temperature: TemperatureUnit | null };

/** Where feet are the everyday depth unit. */
const FEET_REGIONS = new Set(["US", "LR", "MM"]);
/** Where Fahrenheit is the everyday temperature. */
const FAHRENHEIT_REGIONS = new Set(["US", "BS", "BZ", "KY", "PW", "LR", "FM", "MH"]);

const NONE: ReaderUnits = { depth: null, temperature: null };

export function readerUnitsFrom(acceptLanguage: string | null, locale: string): ReaderUnits {
  const first = acceptLanguage?.split(",")[0]?.split(";")[0]?.trim() ?? "";
  const match = /^([a-z]{2,3})(?:-[a-z]{4})?(?:-([a-z]{2}))?(?:-|$)/i.exec(first);
  if (match) {
    const language = match[1].toLowerCase();
    const region = match[2]?.toUpperCase();
    if (region) {
      return {
        depth: FEET_REGIONS.has(region) ? "feet" : "meters",
        temperature: FAHRENHEIT_REGIONS.has(region) ? "fahrenheit" : "celsius",
      };
    }
    return language === "en" ? NONE : { depth: "meters", temperature: "celsius" };
  }
  return locale.toLowerCase().startsWith("es") ? { depth: "meters", temperature: "celsius" } : NONE;
}
