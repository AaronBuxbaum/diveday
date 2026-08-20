import type { StaffMessageKey } from "@/i18n/staff-messages";

/**
 * The settings hub's one list of groups, in render order. Both of the hub's
 * `SettingsPage.tsx` renders its sections from this one list. It remains a
 * registry rather than three local constants so a new section cannot drift
 * from the hub's section order or its test coverage.
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
