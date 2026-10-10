import type { Metadata } from "next";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { RentalItemsForm } from "../_components/editors/RentalEditors";
import {
  canPersonManageRentalSettings,
  SettingsEditorPage,
} from "../_components/SettingsEditorPage";
import { rentalItemsNoticeMessages } from "../sub-page-notices";

// See the sibling settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "What we rent — DiveDay" };

/**
 * What the shop rents: the catalogue as a grid of pills, one save. Unticked
 * kinds drop off the kit form and the prep list.
 *
 * A row on the settings hub until #1854: a form this long is a page wearing a
 * disclosure, so the hub lists it as a door and this is what the door opens.
 * The editor is the row's own, unchanged, and its action answers here with a
 * plain `?notice=` (`sub-page-notices.ts`).
 */
export default async function RentalItemsSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageRentalSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  return (
    <SettingsEditorPage
      shopSlug={shopSlug}
      t={t}
      title={t("settings.main.rentals.heading")}
      description={t("settings.main.rentals.detail")}
      banner={noticeFromParam(notice, rentalItemsNoticeMessages(t))}
    >
      <RentalItemsForm shop={shop} t={t} />
    </SettingsEditorPage>
  );
}
