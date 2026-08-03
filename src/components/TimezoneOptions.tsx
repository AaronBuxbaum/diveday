import {
  type CuratedTimeZone,
  type CuratedTimezoneGroupKey,
  curatedTimeZones,
  timeZoneOptionText,
  timezoneOptionGroups,
} from "@/lib/timezones";

/** The zones a shortcut group already offers above the full list. */
const pinned = new Set(curatedTimeZones());

/** Headings for the picker's `<optgroup>`s, already resolved from a bundle. */
export type TimezoneGroupLabels = Record<CuratedTimezoneGroupKey | "allZones", string>;

/** How a shop owner names each pinned zone ("Cancún / Cozumel"), already resolved. */
export type TimezoneZoneLabels = Record<CuratedTimeZone, string>;

/**
 * The timezone picker's `<optgroup>`s: dive-region shortcuts pinned on top,
 * then every zone the runtime knows.
 *
 * Options only, never the `<select>` — the two pages that offer this picker
 * (sign-up, Settings) each own their own control so `Field` still sees a
 * native element and can wire the label, the required marker, and
 * `aria-describedby` the way it does for every other control on the page.
 * Words arrive as props because the two speak to different audiences and read
 * from different bundles; the structure is shared so the two pickers cannot
 * drift into offering different zones.
 *
 * `selected` is what the surrounding `<select>` carries as its `defaultValue`,
 * and it is load-bearing rather than decorative. The full group deliberately
 * repeats every curated id (`timezoneOptionGroups`, so a browser's type-ahead
 * — which matches option *text* — still finds "America/New_York" when the
 * curated option reads "Eastern Time (New York)"), which leaves two options
 * carrying the selected value. React's `defaultValue` marks **both** selected
 * and a single-select keeps the last one, so the closed picker rendered the
 * raw IANA id: a shop that signed up on the default zone saw "America/New
 * York" rather than "Eastern Time (New York)". Dropping the duplicate of the
 * *selected* zone alone leaves exactly one option carrying that value, so the
 * curated label wins — and every other zone keeps the id its type-ahead needs.
 */
export function TimezoneOptions({
  groupLabels,
  zoneLabels,
  selected,
}: {
  groupLabels: TimezoneGroupLabels;
  zoneLabels: TimezoneZoneLabels;
  /** The `<select>`'s own `defaultValue`. */
  selected: string;
}) {
  return (
    <>
      {timezoneOptionGroups().map((group) => (
        <optgroup key={group.group} label={groupLabels[group.group]}>
          {group.group === "allZones"
            ? group.zones
                .filter((zone) => zone !== selected || !pinned.has(zone))
                .map((zone) => (
                  <option key={zone} value={zone}>
                    {timeZoneOptionText(zone)}
                  </option>
                ))
            : group.zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zoneLabels[zone]}
                </option>
              ))}
        </optgroup>
      ))}
    </>
  );
}
