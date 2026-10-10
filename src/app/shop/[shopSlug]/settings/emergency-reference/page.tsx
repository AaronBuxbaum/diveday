import type { Metadata } from "next";
import { canPersonManageShopSettings } from "@/db/authz";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { EmergencyReferenceForm } from "../_components/editors/BoatsSitesEditors";
import { SettingsEditorPage } from "../_components/SettingsEditorPage";
import { emergencyReferenceNoticeMessages } from "../sub-page-notices";

// See the sibling settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Emergency reference — DiveDay" };

/**
 * The numbers a crew dials during, and the plan, which ride on the boat
 * manifest offline (issue #688). Not gated on boat diving: a shore
 * operation needs a chamber number as much as a boat does.
 *
 * A row on the settings hub until #1854: a form this long is a page wearing a
 * disclosure, so the hub lists it as a door and this is what the door opens.
 * The editor is the row's own, unchanged, and its action answers here with a
 * plain `?notice=` (`sub-page-notices.ts`).
 */
export default async function EmergencyReferenceSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  return (
    <SettingsEditorPage
      shopSlug={shopSlug}
      t={t}
      title={t("settings.main.emergency.heading")}
      description={t("settings.main.emergency.intro")}
      banner={noticeFromParam(notice, emergencyReferenceNoticeMessages(t))}
    >
      <EmergencyReferenceForm shop={shop} t={t} />
    </SettingsEditorPage>
  );
}
