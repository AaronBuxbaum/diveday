import type { Metadata } from "next";
import { canPersonManageShopSettings } from "@/db/authz";
import { listSiteBottomTimeOverrides } from "@/db/dive-sites";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { DockDayForm } from "../_components/editors/BoatsSitesEditors";
import { SettingsEditorPage } from "../_components/SettingsEditorPage";
import { dockDayNoticeMessages } from "../sub-page-notices";

// See the sibling settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Dock-day rhythm — DiveDay" };

/**
 * The six minute amounts the dock day is built from, one save, and the beats
 * they produce beneath, with the sites whose own bottom time overrides the
 * shop-wide one.
 *
 * A row on the settings hub until #1854: a form this long is a page wearing a
 * disclosure, so the hub lists it as a door and this is what the door opens.
 * The editor is the row's own, unchanged, and its action answers here with a
 * plain `?notice=` (`sub-page-notices.ts`).
 */
export default async function DockDaySettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // A site carrying its own `expectedBottomTimeMinutes` overrides the
  // shop-wide figure for any dive that visits it, and the preview is drawn
  // from the shop-wide figure alone. Empty for a shop that has overridden
  // nothing, and then the preview says nothing extra.
  const siteBottomTimeOverrides = await listSiteBottomTimeOverrides(db, shop.id);

  return (
    <SettingsEditorPage
      shopSlug={shopSlug}
      t={t}
      title={t("settings.main.dockCall.heading")}
      description={t("settings.main.dockCall.description")}
      banner={noticeFromParam(notice, dockDayNoticeMessages(t))}
    >
      <DockDayForm
        shop={shop}
        shopSlug={shopSlug}
        t={t}
        siteBottomTimeOverrides={siteBottomTimeOverrides}
      />
    </SettingsEditorPage>
  );
}
