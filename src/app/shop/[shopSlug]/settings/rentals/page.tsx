import type { Metadata } from "next";
import { canPersonManageRentalSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { countFitsAskingForDroppedItems } from "@/db/rental-fit";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { RentalsForm } from "../_components/editors/RentalsForm";
import { SettingsEditorPage } from "../_components/SettingsEditorPage";
import { rentalsNoticeMessages } from "../sub-page-notices";

// See the sibling settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Rentals — DiveDay" };

/**
 * **Rentals** (#2815): what the shop rents, what it charges, the terms a rental
 * ticket prints and how often a customer's regulator is serviced, in one table
 * and one save. Unticked kinds drop off the kit form; a diver whose fit still
 * asks for one is counted under the table (issue #1792), never cleared.
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
  const [locale, droppedFits] = await Promise.all([
    requestLocale(shop.defaultLocale),
    countFitsAskingForDroppedItems(await getDb(), shop.id, shop.rentalItems),
  ]);
  const t = staffTranslator(locale);

  return (
    <SettingsEditorPage
      shopSlug={shopSlug}
      t={t}
      title={t("settings.main.rentals.heading")}
      description={t("settings.main.rentals.detail")}
      banner={noticeFromParam(notice, rentalsNoticeMessages(t))}
    >
      <RentalsForm shop={shop} t={t} locale={locale} droppedFits={droppedFits} />
    </SettingsEditorPage>
  );
}
