import type { ReactNode } from "react";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow, FieldActions, FieldGrid } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { requireShopSurface } from "@/lib/session";
import { type ShopFeature, shopOffers } from "@/lib/shop-features";
import { noticeRole } from "@/lib/staff-notices";
import { SETTINGS_GROUPS, type SectionId } from "../../settings-groups";
import { saveShopFeatureAction } from "../../shop-actions";
import { SettingsRow } from "../SettingsRows";

/**
 * **What every settings group is drawn from** — the settings hub's groups
 * (`settings-groups.ts`) are one component each under this folder, and the hub
 * (`SettingsPage.tsx`) reads the request once and hands each the same view.
 * A group that needs a read of its own makes it itself, under its own
 * `<Suspense>` in the hub.
 */
export type SettingsShop = Awaited<ReturnType<typeof requireShopSurface>>["shop"];

export type SettingsBanner = { tone: "success" | "danger" | "warning"; text: string };

export type SettingsView = {
  shop: SettingsShop;
  shopSlug: string;
  t: StaffTranslator;
  /** The negotiated request locale, for every figure and date. */
  locale: string;
  /** The `?notice=` this request carries, already worded. */
  banner: SettingsBanner | undefined;
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
  BOATS_SITES_GROUP,
  BOOKINGS_GROUP,
  RENTALS_GROUP,
  MONEY_GROUP,
  MESSAGES_GROUP,
  WEBSITE_GROUP,
  DATA_GROUP,
  ACCOUNT_GROUP,
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
    <div>
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
  banner: SettingsBanner | undefined;
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

/**
 * **One shape for every optional feature** (ADR
 * 20261005-optional-shop-features): the row states On or Off, and opening it
 * shows one switch and what the switch covers. Each sits in the group its
 * feature belongs to rather than in a "Features" list of its own, so a shop
 * finds the tip switch where it finds its other money settings.
 *
 * A function rather than a component, so the row is part of its group's own
 * element tree — the hub's tests read that tree unrendered.
 */
export function featureRow(view: SettingsView, feature: ShopFeature) {
  const { shop, t, banner, activeSection } = view;
  return (
    <SettingsRow
      heading={t(`settings.main.features.${feature}.heading`)}
      value={
        shopOffers(shop, feature) ? t("settings.main.features.on") : t("settings.main.features.off")
      }
      sectionId={feature}
      activeSection={activeSection}
    >
      <SectionNotice banner={banner} section={feature} active={activeSection} />
      <FieldGrid as="form" action={saveShopFeatureAction} columns={1} className="mt-4">
        <input type="hidden" name="feature" value={feature} />
        <ChoiceRow
          name="enabled"
          type="checkbox"
          defaultChecked={shopOffers(shop, feature)}
          className="text-sm"
        >
          <span className="block font-medium">{t(`settings.main.features.${feature}.label`)}</span>
          <span className="block text-xs text-muted">
            {t(`settings.main.features.${feature}.description`)}
          </span>
        </ChoiceRow>
        <FieldActions>
          <SubmitButton
            pendingLabel={t("settings.main.features.saving")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("settings.main.features.save")}
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
    </SettingsRow>
  );
}
