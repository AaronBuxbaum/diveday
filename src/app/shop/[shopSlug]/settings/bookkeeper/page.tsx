import { canPersonExportShopData } from "@/db/export";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { MonthEndSection } from "../../reports/_components/MonthEndSection";
import { SettingsEditorPage } from "../_components/SettingsEditorPage";

export const instant = true;
export const metadata = { title: "Bookkeeper’s email — DiveDay" };

export default async function BookkeeperSettingsPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const { shop } = await requireShopSurface(shopSlug, {
    allow: canPersonExportShopData,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  return (
    <SettingsEditorPage
      shopSlug={shopSlug}
      t={t}
      title={t("reports.bookkeeper.label")}
      banner={undefined}
    >
      <MonthEndSection shopSlug={shopSlug} locale={locale} timeZone={shop.timezone} t={t} />
    </SettingsEditorPage>
  );
}
