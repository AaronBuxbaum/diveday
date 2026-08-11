import type { StaffMessageKey } from "@/i18n/staff-messages";

/**
 * The settings hub's one list of groups, in render order. Both of the hub's
 * consumers derive from it — `SettingsPage.tsx`'s `SettingsGroup` sections and
 * `_components/SettingsGroupAnchors.tsx`'s jump row — so the page can never
 * render a section the anchor row has no name for, and the pair of tests that
 * read this list fails if either side forgets a group that is added here.
 *
 * It used to carry a second list, `SETTINGS_DESTINATIONS`: the six full-page
 * settings surfaces, which a sub-nav card rendered as grouped pills above
 * every one of their `<h1>`s. That card is gone (a sub-page's way back is now
 * its own eyebrow, `ShopPageHeader`'s `eyebrowHref`), and with it the second
 * list — the hub's door rows are the directory, and they are one tap away.
 */
export const SETTINGS_GROUPS = [
  { id: "your-shop", labelKey: "settings.main.groups.yourShop" },
  { id: "money", labelKey: "settings.main.groups.money" },
  { id: "data-integrations", labelKey: "settings.main.groups.dataIntegrations" },
] as const satisfies readonly { id: string; labelKey: StaffMessageKey }[];

export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]["id"];
export type SettingsGroupSpec = (typeof SETTINGS_GROUPS)[number];
