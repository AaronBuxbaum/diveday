import { redirect } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { requireShopSurface } from "@/features/accounts/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { canEditDiveSites } from "@/lib/authz";
import { NewSitePanel } from "../_components/NewSitePanel";

export const instant = true;

export default async function NewDiveSitePage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const surface = await requireShopSurface(shopSlug);
  if (!canEditDiveSites(surface.session.user.roles)) redirect(`/shop/${shopSlug}/dive-sites`);
  const locale = await requestLocale(surface.shop.defaultLocale);
  const t = staffTranslator(locale);
  return (
    <StaffPage width="reading">
      <ShopPageHeader
        title={t("diveSites.new.title")}
        description={t("diveSites.new.description")}
      />
      <div className="mt-8">
        <NewSitePanel surface={surface} shopSlug={shopSlug} t={t} locale={locale} />
      </div>
    </StaffPage>
  );
}
