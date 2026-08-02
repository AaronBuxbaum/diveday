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
