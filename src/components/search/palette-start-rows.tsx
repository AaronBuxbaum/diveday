import type { CommandPaletteCopy, PaletteGroup, PaletteItem } from "./CommandPalette";
import { PaletteGlyph } from "./PaletteGlyph";
import type { RecentKind, RecentRecord } from "./palette-recents";

/** One of today's departures, for the palette's "Today" group (fifth loop, item 13). */
export type PaletteTodayBoat = { id: string; title: string; time: string };

export const NO_TODAY_BOATS: readonly PaletteTodayBoat[] = [];

/**
 * **Before anything is typed, what you were just doing** (fifth loop, item
 * 13): the records this staffer last opened here, then today's boats, each one
 * tap away above the doors. Either group is left out when it has no rows.
 */
export function startGroups({
  recents,
  todayBoats,
  root,
  copy,
}: {
  recents: readonly RecentRecord[];
  todayBoats: readonly PaletteTodayBoat[];
  root: string;
  copy: Pick<CommandPaletteCopy, "groupRecent" | "groupToday">;
}): PaletteGroup[] {
  const out: PaletteGroup[] = [];
  if (recents.length > 0) {
    out.push({
      id: "recent",
      heading: copy.groupRecent,
      items: recents.map((record) => ({
        key: `recent:${record.key}`,
        label: record.label,
        detail: record.detail,
        href: record.href,
        recent: record,
        icon: <PaletteGlyph name={record.kind} />,
      })),
    });
  }
  if (todayBoats.length > 0) {
    out.push({
      id: "today",
      heading: copy.groupToday,
      items: todayBoats.map((boat) => ({
        key: `today:${boat.id}`,
        label: boat.title,
        detail: boat.time,
        href: `${root}/trips/${boat.id}`,
        icon: <PaletteGlyph name="trip" />,
      })),
    });
  }
  return out;
}

/** A row that opens one record, remembered among this staffer's recents once chosen. */
export function recordItem(
  kind: RecentKind,
  id: string,
  label: string,
  detail: string | undefined,
  href: string,
): PaletteItem {
  const key = `${kind}:${id}`;
  return {
    key,
    label,
    detail,
    href,
    recent: { key, kind, label, detail, href },
    icon: <PaletteGlyph name={kind} />,
  };
}
