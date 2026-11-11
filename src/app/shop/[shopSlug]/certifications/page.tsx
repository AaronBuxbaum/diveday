import { ShopPageHeader } from "@/components/ShopPageHeader";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { StaffPage } from "../_components/StaffPage";
import { StaffSectionTabs } from "../_components/StaffSectionTabs";
import { CourseFollowUps, LadderNotice } from "../courses/_components/CourseFollowUps";

export const instant = true;
export const metadata = { title: "Certifications — DiveDay" };

export default async function CertificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  return (
    <StaffPage width="full">
      <ShopPageHeader title={t("shared.shopSections.courses")} />
      <StaffSectionTabs
        section="courses"
        current="certifications"
        roles={session.user.roles}
        shop={shop}
        t={t}
      />
      <LadderNotice notice={notice} t={t} />
      <CourseFollowUps db={db} shop={shop} locale={locale} t={t} />
    </StaffPage>
  );
}
