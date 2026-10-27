import type { ReactNode } from "react";
import { ShopNotice } from "@/components/ShopPageHeader";
import { GroupLabel } from "@/components/ui/group-label";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { requireShopSurface } from "@/lib/session";
import { type NoticeMessage, noticeRole } from "@/lib/staff-notices";
import { SETTINGS_GROUPS, type SectionId } from "../../settings-groups";

/**
 * **What every settings group is drawn from** — the settings hub's groups
 * (`settings-groups.ts`) are one component each under this folder, and the hub
 * (`SettingsPage.tsx`) reads the request once and hands each the same view.
 * A group that needs a read of its own makes it itself, under its own
 * `<Suspense>` in the hub.
 */
export type SettingsShop = Awaited<ReturnType<typeof requireShopSurface>>["shop"];

export type SettingsView = {
  shop: SettingsShop;
  shopSlug: string;
  t: StaffTranslator;
  /** The negotiated request locale, for every figure and date. */
  locale: string;
  /** The `?notice=` this request carries, already worded. */
  banner: NoticeMessage | undefined;
  /** The row `?saved=` names, which comes back open with its notice inside. */
  activeSection: SectionId | null;
  /**
   * "Not set" is a value here, not a status: on a settings row the absence of
   * an answer is exactly the fact the reader came to check.
   */
  notSet: string;
};

type SettingsGroupSpec = (typeof SETTINGS_GROUPS)[number];

export const [
  SHOP_GROUP,
  TEAM_GROUP,
  BOOKINGS_GROUP,
  MONEY_GROUP,
  MESSAGES_GROUP,
  WEBSITE_GROUP,
  FEATURES_GROUP,
  DATA_GROUP,
] = SETTINGS_GROUPS;

/**
 * A labelled group of settings rows with an anchor `#id`. Rows keep their own
 * `<h3>`; this is the page's real `<h2>` level, so the heading hierarchy stays
 * `<h1>` (ShopPageHeader) -> group `<h2>` -> row `<h3>`.
 *
 * No outer margin: the page stacks its groups in one `space-y-10`, the same
 * rhythm `SectionCard` assumes (docs/design/forms-and-controls.md).
 */
export function SettingsGroup({
  group,
  label,
  children,
}: {
  group: SettingsGroupSpec;
  label: string;
  children: ReactNode;
}) {
  return (
    <div data-settings-group={group.id}>
      <GroupLabel as="h2" id={group.id} className="mb-3 scroll-mt-24">
        {label}
      </GroupLabel>
      {children}
    </div>
  );
}

export function SectionNotice({
  banner,
  section,
  active,
}: {
  banner: NoticeMessage | undefined;
  section: SectionId;
  active: SectionId | null;
}) {
  if (!banner || active !== section) return null;
  return (
    <div className="mt-4">
      <ShopNotice tone={banner.tone} role={noticeRole(banner.tone)}>
        {banner.text}
      </ShopNotice>
    </div>
  );
}
