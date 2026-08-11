/**
 * The timezone picker's option data.
 *
 * Sign-up used to offer sixteen hand-listed zones, which quietly refused a shop
 * in Bonaire, Roatán, Raja Ampat, the Maldives, or Fiji at the last step of
 * signing up — a hard stop, not an inconvenience, since the field is required.
 * The server never had that restriction: `onboardSchema` accepts any zone
 * `isValidTimeZone` recognizes (`src/lib/format.ts`), so the fix is entirely on
 * the offering side.
 *
 * This file returns **data, not words**: IANA zone ids and group *keys*. The
 * page turns a group key into a heading from the message bundle, and turns an
 * uncurated zone id into its own display text — nothing here is English.
 *
 * Two tiers, on purpose. A shop in the places dive shops actually are should
 * find its zone in the first screenful, so the curated groups stay pinned on
 * top; everything else follows in one alphabetical list so no shop is ever
 * turned away for living somewhere the curation forgot.
 */

/** The zone a shop gets when it never touches the picker. */
export const DEFAULT_TIMEZONE = "America/New_York";

/**
 * The dive-region shortcuts, in render order. `group` is a message-bundle key
 * suffix (resolved by the page), never a heading; `zones` are IANA ids.
 */
export const CURATED_TIMEZONE_GROUPS = [
  {
    group: "americas",
    zones: [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Pacific/Honolulu",
    ],
  },
  {
    group: "caribbean",
    zones: [
      "America/Cancun",
      "America/Belize",
      "America/Tegucigalpa",
      "America/Cayman",
      "America/Nassau",
      "America/Puerto_Rico",
      "America/Curacao",
    ],
  },
  { group: "europeRedSea", zones: ["Europe/London", "Africa/Cairo"] },
  {
    group: "asiaPacific",
    zones: [
      "Indian/Maldives",
      "Asia/Bangkok",
      "Asia/Jakarta",
      "Asia/Singapore",
      "Asia/Makassar",
      "Asia/Manila",
      "Pacific/Palau",
      "Pacific/Fiji",
      "Australia/Sydney",
      "Pacific/Auckland",
    ],
  },
] as const satisfies readonly { group: string; zones: readonly string[] }[];

/** A curated group's key — the page maps it to a bundle message. */
export type CuratedTimezoneGroupKey = (typeof CURATED_TIMEZONE_GROUPS)[number]["group"];

/**
 * A zone id the curated groups pin. Named so the page's label map is exhaustive
 * at compile time: adding a shortcut zone here without its message key is a
 * type error rather than a raw `Asia/Makassar` on a sign-up form.
 */
export type CuratedTimeZone = (typeof CURATED_TIMEZONE_GROUPS)[number]["zones"][number];

/** Every zone id the curated groups pin to the top of the picker. */
export function curatedTimeZones(): string[] {
  return CURATED_TIMEZONE_GROUPS.flatMap((group) => [...group.zones]);
}

/**
 * Every IANA zone this runtime knows, sorted, or an empty list when it can't
 * say.
 *
 * `Intl.supportedValuesOf` is the enumeration API, but it is the one part of
 * this that can be missing (an older or trimmed ICU build) or answer with
 * something unusable. Every failure mode lands on the same answer — an empty
 * list — because the caller's fallback (the curated groups alone) is exactly
 * the list this replaced, which is strictly better than a picker with no
 * options in it.
 */
export function supportedTimeZones(): string[] {
  const supportedValuesOf = (Intl as { supportedValuesOf?: (key: string) => unknown })
    .supportedValuesOf;
  if (typeof supportedValuesOf !== "function") return [];
  let values: unknown;
  try {
    values = supportedValuesOf.call(Intl, "timeZone");
  } catch {
    return [];
  }
  if (!Array.isArray(values)) return [];
  const zones = [...new Set(values.filter((value): value is string => isZoneId(value)))];
  return zones.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A plausible IANA id: `Area/Location`, ASCII, no spaces. */
function isZoneId(value: unknown): boolean {
  return typeof value === "string" && /^[A-Za-z][\w+-]*(?:\/[\w+-]+)+$/.test(value);
}

/**
 * Roughly where a zone is, as `[longitude, latitude]`.
 *
 * Deliberately coarse — this is a *bias*, and a bias only reorders results, it
 * never excludes any (AWS: "It doesn't restrict results, but biases them
 * toward the specified area"). So the bar is "the right side of the planet",
 * not "the right street", and each entry is simply the representative city the
 * IANA id is already named after.
 *
 * A shop's timezone is the one location signal every shop has —
 * `shops.timezone` is `notNull` and the sign-up form requires it. The address
 * search's better anchor is a dive site's own coordinate, but those are
 * optional ("Leave both blank to keep crew-only conditions") and a shop that
 * never wanted marine forecasts has none at all, which left the search
 * completely unbiased for exactly the shops that had done the least setup.
 *
 * Every curated zone must appear here — `timezones.test.ts` fails if one is
 * added to {@link CURATED_TIMEZONE_GROUPS} without a coordinate, because a
 * curated dive region with no anchor is the case this table exists for. The
 * uncurated entries below are the zones the rest of the world's shops are
 * most likely to pick; anything unlisted answers null and the caller searches
 * unbiased rather than guessing.
 */
const TIMEZONE_ANCHORS: Record<string, readonly [number, number]> = {
  // The curated dive regions, in the order `CURATED_TIMEZONE_GROUPS` lists them.
  "America/New_York": [-74.0, 40.71],
  "America/Chicago": [-87.63, 41.88],
  "America/Denver": [-104.99, 39.74],
  "America/Los_Angeles": [-118.24, 34.05],
  "Pacific/Honolulu": [-157.86, 21.31],
  "America/Cancun": [-86.85, 21.16],
  "America/Belize": [-88.2, 17.5],
  "America/Tegucigalpa": [-87.21, 14.07],
  "America/Cayman": [-81.38, 19.29],
  "America/Nassau": [-77.34, 25.06],
  "America/Puerto_Rico": [-66.11, 18.47],
  "America/Curacao": [-68.93, 12.12],
  "Europe/London": [-0.13, 51.51],
  "Africa/Cairo": [31.24, 30.04],
  "Indian/Maldives": [73.51, 4.18],
  "Asia/Bangkok": [100.5, 13.76],
  "Asia/Jakarta": [106.85, -6.21],
  "Asia/Singapore": [103.82, 1.35],
  "Asia/Makassar": [119.41, -5.15],
  "Asia/Manila": [120.98, 14.6],
  "Pacific/Palau": [134.48, 7.5],
  "Pacific/Fiji": [178.44, -18.14],
  "Australia/Sydney": [151.21, -33.87],
  "Pacific/Auckland": [174.76, -36.85],

  // Uncurated, but common enough that a shop there should still get a bias.
  "America/Anchorage": [-149.9, 61.22],
  "America/Barbados": [-59.62, 13.11],
  "America/Bogota": [-74.07, 4.71],
  "America/Costa_Rica": [-84.09, 9.93],
  "America/Guatemala": [-90.51, 14.63],
  "America/Guayaquil": [-79.89, -2.19],
  "America/Jamaica": [-76.79, 17.97],
  "America/Lima": [-77.04, -12.05],
  "America/Mexico_City": [-99.13, 19.43],
  "America/Panama": [-79.52, 8.98],
  "America/Port_of_Spain": [-61.52, 10.65],
  "America/Santo_Domingo": [-69.93, 18.49],
  "America/Sao_Paulo": [-46.63, -23.55],
  "America/Tijuana": [-117.04, 32.51],
  "America/Toronto": [-79.38, 43.65],
  "America/Vancouver": [-123.12, 49.28],
  "Asia/Colombo": [79.86, 6.93],
  "Asia/Dubai": [55.27, 25.2],
  "Asia/Ho_Chi_Minh": [106.66, 10.82],
  "Asia/Hong_Kong": [114.17, 22.32],
  "Asia/Kuala_Lumpur": [101.69, 3.14],
  "Asia/Muscat": [58.54, 23.59],
  "Asia/Shanghai": [121.47, 31.23],
  "Asia/Taipei": [121.56, 25.03],
  "Asia/Tokyo": [139.69, 35.69],
  "Atlantic/Azores": [-25.67, 37.74],
  "Atlantic/Bermuda": [-64.78, 32.29],
  "Atlantic/Canary": [-15.43, 28.13],
  "Australia/Adelaide": [138.6, -34.93],
  "Australia/Brisbane": [153.03, -27.47],
  "Australia/Darwin": [130.84, -12.46],
  "Australia/Melbourne": [144.96, -37.81],
  "Australia/Perth": [115.86, -31.95],
  "Africa/Johannesburg": [28.05, -26.2],
  "Africa/Nairobi": [36.82, -1.29],
  "Europe/Amsterdam": [4.9, 52.37],
  "Europe/Athens": [23.73, 37.98],
  "Europe/Berlin": [13.4, 52.52],
  "Europe/Dublin": [-6.26, 53.35],
  "Europe/Istanbul": [28.98, 41.01],
  "Europe/Lisbon": [-9.14, 38.72],
  "Europe/Madrid": [-3.7, 40.42],
  "Europe/Malta": [14.51, 35.9],
  "Europe/Oslo": [10.75, 59.91],
  "Europe/Paris": [2.35, 48.86],
  "Europe/Rome": [12.5, 41.9],
  "Europe/Stockholm": [18.07, 59.33],
  "Indian/Mauritius": [57.5, -20.16],
  "Pacific/Galapagos": [-90.31, -0.74],
  "Pacific/Guam": [144.79, 13.47],
  "Pacific/Noumea": [166.46, -22.28],
  "Pacific/Port_Moresby": [147.19, -9.44],
  "Pacific/Rarotonga": [-159.78, -21.21],
  "Pacific/Tahiti": [-149.57, -17.54],
  "Pacific/Tongatapu": [-175.2, -21.13],
};

/**
 * Roughly where a shop in this timezone is, or null when the zone is not one
 * this table knows.
 *
 * Null is a real answer, not a failure: the caller searches unbiased rather
 * than anchoring on a guess, which is the honest outcome for a zone nobody has
 * placed.
 */
export function timeZoneAnchor(zone: string): { longitude: number; latitude: number } | null {
  const anchor = TIMEZONE_ANCHORS[zone];
  return anchor ? { longitude: anchor[0], latitude: anchor[1] } : null;
}

/**
 * One `<optgroup>` worth of options: a group key and the zones under it.
 *
 * A union rather than one shape with a widened `group`, so the page's label
 * lookup needs no cast: inside a curated group every zone is a
 * {@link CuratedTimeZone} with a message key, and only the full list holds ids
 * the bundle has never heard of.
 */
export type TimezoneOptionGroup =
  | { group: CuratedTimezoneGroupKey; zones: CuratedTimeZone[] }
  | { group: "allZones"; zones: string[] };

/**
 * The picker's groups in render order: the dive-region shortcuts, then every
 * zone this runtime knows.
 *
 * The full group repeats the curated ids rather than subtracting them, so it
 * really is every zone — a browser's type-ahead matches an option's *text*, and
 * a shop typing "America/New" would otherwise find nothing because the curated
 * option reads "Eastern Time (New York)". When the runtime can't enumerate
 * zones the group is omitted entirely and the curated shortcuts stand alone.
 */
export function timezoneOptionGroups(): TimezoneOptionGroup[] {
  const groups: TimezoneOptionGroup[] = CURATED_TIMEZONE_GROUPS.map((group) => ({
    group: group.group,
    zones: [...group.zones],
  }));
  const all = supportedTimeZones();
  if (all.length > 0) groups.push({ group: "allZones", zones: all });
  return groups;
}

/**
 * An uncurated zone id as its own display text — `Asia/Ho_Chi_Minh` reads
 * `Asia/Ho Chi Minh`. Deliberately the id itself rather than an invented
 * English name: the id is what the shop's own devices and airline tickets show,
 * it needs no translation, and it can't drift from what gets stored.
 */
export function timeZoneOptionText(zone: string): string {
  return zone.replaceAll("_", " ");
}
