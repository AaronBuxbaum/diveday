import type { DiverHit, GearHit, OrderHit, SearchResults, TripHit } from "@/db/search";
import type { RecentKind } from "@/lib/recent-refs";
import type { CommandPaletteCopy, PaletteGroup, PaletteItem } from "./CommandPalette";
import { PaletteGlyph } from "./PaletteGlyph";
import type { StoredRecent } from "./palette-recents";

/** This staffer's recents: the ids the device kept, and their words as read back on opening. */
export type PaletteRecents = { stored: readonly StoredRecent[]; hits: SearchResults | null };

export const NO_RECENTS: PaletteRecents = { stored: [], hits: null };

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
  recents: PaletteRecents;
  todayBoats: readonly PaletteTodayBoat[];
  root: string;
  copy: Pick<CommandPaletteCopy, "groupRecent" | "groupToday" | "gearStatuses">;
}): PaletteGroup[] {
  const out: PaletteGroup[] = [];
  const recentItems = recentRows(recents, root, copy);
  if (recentItems.length > 0) {
    out.push({ id: "recent", heading: copy.groupRecent, items: recentItems });
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
function recordItem(
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
    recent: { key, kind, id },
    icon: <PaletteGlyph name={kind} />,
  };
}

// A diver opens their record (ADR 20261001-logbook).
export const diverItem = (diver: DiverHit, root: string) =>
  recordItem(
    "diver",
    diver.id,
    diver.fullName,
    diver.detail ?? undefined,
    `${root}/divers/${diver.id}`,
  );

export const tripItem = (trip: TripHit, root: string) =>
  recordItem("trip", trip.id, trip.title, trip.detail, `${root}/trips/${trip.id}`);

export const orderItem = (order: OrderHit, root: string) =>
  recordItem("order", order.id, order.personName, order.detail, `${root}/orders/${order.id}`);

export const gearItem = (
  unit: GearHit,
  root: string,
  gearStatuses: CommandPaletteCopy["gearStatuses"],
) =>
  recordItem(
    "gear",
    unit.id,
    unit.label,
    unit.detail ? `${gearStatuses[unit.status]} · ${unit.detail}` : gearStatuses[unit.status],
    `${root}/gear/${unit.id}`,
  );

const mapHit = <T,>(hit: T | undefined, toItem: (hit: T) => PaletteItem) =>
  hit ? toItem(hit) : null;

/**
 * The recents, in the order they were opened, each built from what the search
 * route read back just now. One that did not come back (removed, erased, or
 * not this shop's) is left out.
 */
export function recentRows(
  { stored, hits }: PaletteRecents,
  root: string,
  copy: Pick<CommandPaletteCopy, "gearStatuses">,
): PaletteItem[] {
  if (!hits) return [];
  const build = (kind: RecentKind, id: string): PaletteItem | null => {
    const byId = <T extends { id: string }>(rows: readonly T[]) =>
      rows.find((row) => row.id === id);
    if (kind === "diver") return mapHit(byId(hits.divers), (hit) => diverItem(hit, root));
    if (kind === "trip") return mapHit(byId(hits.trips), (hit) => tripItem(hit, root));
    if (kind === "order") return mapHit(byId(hits.orders), (hit) => orderItem(hit, root));
    return mapHit(byId(hits.gear), (hit) => gearItem(hit, root, copy.gearStatuses));
  };
  const out: PaletteItem[] = [];
  for (const { kind, id } of stored) {
    const item = build(kind, id);
    if (item) out.push({ ...item, key: `recent:${item.key}` });
  }
  return out;
}
