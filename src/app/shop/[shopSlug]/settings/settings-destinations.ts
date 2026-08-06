import type { StaffMessageKey } from "@/i18n/staff-messages";

/**
 * The settings surface's one registry — every group and every full-page
 * destination, in render order. Both consumers derive from this instead of
 * each keeping its own copy: `SettingsPage.tsx`'s hub (`SettingsGroup` +
 * `JumpNav`, task 154) and `layout.tsx`'s `SettingsSubNav` (task T3,
 * surface-consolidation). Before this file existed, a subpage moved between
 * groups only on the hub — the sub-nav's grouping was a second, independent
 * list that had no way to notice — the exact drift `src/lib/staff-destinations.ts`
 * exists to prevent for the main staff nav. Add a settings destination or
 * regroup one here; never in `SettingsPage.tsx` or `SettingsSubNav.tsx`
 * directly.
 */
export const SETTINGS_GROUPS = [
  { id: "your-shop", labelKey: "settings.main.groups.yourShop" },
  { id: "money", labelKey: "settings.main.groups.money" },
  { id: "data-integrations", labelKey: "settings.main.groups.dataIntegrations" },
] as const satisfies readonly { id: string; labelKey: StaffMessageKey }[];

export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]["id"];
export type SettingsGroupSpec = (typeof SETTINGS_GROUPS)[number];

/**
 * The six full-page settings surfaces reachable from the hub, in the order
 * the hub's "Data & integrations" group already rendered them. `path` is the
 * segment under `/shop/<slug>/settings/`; `titleKey` is each surface's own
 * `<h1>` key (`ShopPageHeader`'s `title`), reused as the sub-nav's label so
 * the two can never say something different for the same page. The hub's own
 * "Money" group has no destination here — nothing under it is a full-page
 * surface today (its cards live inline on the hub) — so the sub-nav renders
 * no row for it.
 *
 * Backups is deliberately absent: it is the second half of `export` rather
 * than a surface of its own, and `/settings/backup` is a 308 to it (ADR
 * 20260806-one-data-out-surface). A redirect must never be registered here —
 * the sub-nav would carry a tab whose href no pathname can ever equal, so it
 * would light up nothing while the reader stands on the page it names.
 */
export const SETTINGS_DESTINATIONS = [
  { id: "team", groupId: "your-shop", path: "team", titleKey: "settings.team.title" },
  { id: "embed", groupId: "data-integrations", path: "embed", titleKey: "settings.embed.title" },
  { id: "calendar", groupId: "data-integrations", path: "calendar", titleKey: "calendar.title" },
  { id: "whatsapp", groupId: "data-integrations", path: "whatsapp", titleKey: "whatsapp.title" },
  { id: "import", groupId: "data-integrations", path: "import", titleKey: "settings.import.title" },
  { id: "export", groupId: "data-integrations", path: "export", titleKey: "settings.export.title" },
] as const satisfies readonly {
  id: string;
  groupId: SettingsGroupId;
  path: string;
  titleKey: StaffMessageKey;
}[];

export type SettingsDestinationId = (typeof SETTINGS_DESTINATIONS)[number]["id"];
