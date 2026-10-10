import type { ReactNode } from "react";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SectionCard } from "@/components/ui/card";
import { canPersonManagePaymentSettings, canPersonManageShopSettings } from "@/db/authz";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { NoticeTone } from "@/lib/staff-notices";
import { settingsPaneClass } from "./settings-pane";

/**
 * **One editor on a page of its own, hung off the settings hub** — the shape
 * `/settings/boats` set and the five editors #1854 moved out of hub rows
 * follow: the eyebrow back to the hub, the page's title, what the setting is
 * for under it, the action's `?notice=` as a banner, and the editor in one
 * card at the hub's width. Each page reads its own shop and words and hands
 * them here; nothing about an editor changes by moving.
 */
export function SettingsEditorPage({
  shopSlug,
  t,
  title,
  description,
  banner,
  children,
}: {
  shopSlug: string;
  t: StaffTranslator;
  title: string;
  /** What the setting is for, which the hub row showed once it was opened. */
  description?: string;
  banner: { tone: NoticeTone; text: string } | undefined;
  children: ReactNode;
}) {
  return (
    <main className={settingsPaneClass()}>
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={title}
        description={description}
        descriptionIsCaption
      />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}
      <SectionCard padding="lg">{children}</SectionCard>
    </main>
  );
}

/**
 * The rental editors' gate: shop settings *and* payment settings, the two the
 * hub asked before drawing the Rental gear group at all and the two their
 * actions re-check (`settingsBlock`, `paymentSettingsBlock`).
 */
export async function canPersonManageRentalSettings(
  ...args: Parameters<typeof canPersonManageShopSettings>
) {
  return (
    (await canPersonManageShopSettings(...args)) && (await canPersonManagePaymentSettings(...args))
  );
}
