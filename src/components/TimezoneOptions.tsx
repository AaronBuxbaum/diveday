import {
  type CuratedTimeZone,
  type CuratedTimezoneGroupKey,
  timeZoneOptionText,
  timezoneOptionGroups,
} from "@/lib/timezones";

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
 */
export function TimezoneOptions({
  groupLabels,
  zoneLabels,
}: {
  groupLabels: TimezoneGroupLabels;
  zoneLabels: TimezoneZoneLabels;
}) {
  return (
    <>
      {timezoneOptionGroups().map((group) => (
        <optgroup key={group.group} label={groupLabels[group.group]}>
          {group.group === "allZones"
            ? group.zones.map((zone) => (
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
