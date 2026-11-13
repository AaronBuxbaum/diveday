import type { Metadata } from "next";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { StaffSectionTabs } from "@/app/shop/[shopSlug]/_components/StaffSectionTabs";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { canPersonViewShopReports } from "@/features/safety-report";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { noticeFromParam } from "@/lib/staff-notices";
import { DrillLog } from "../_components/DrillLog";
import { readDrillLog } from "../_components/drill-log-read";
import { drillNoticeMessages } from "../_components/drill-notices";

// Paints from its own `loading.tsx`, like the Safety overview beside it.
export const instant = true;

export const metadata: Metadata = {
  title: "Drills — DiveDay",
};

/**
 * **The Drills tab of Safety**: how long since each kind of drill, the drills
 * held in the last year, and the form to log one. It was the foot of the
 * overview, below the month's lists, where a drill logged in one month read as
 * missing from the next; a tab of its own reads the same whatever month the
 * overview is on. The Safety overview's gate, re-read against the database.
 */
export default async function SafetyDrillsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonViewShopReports,
    refusal: { notice: "reports-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const drills = await readDrillLog({
    db,
    shopId: shop.id,
    timeZone: shop.timezone,
    recent: true,
    locale,
    t,
  });
  const banner = noticeFromParam(notice, drillNoticeMessages(t));
  return (
    <StaffPage width="full">
      <ShopPageHeader title={t("shared.shopSections.safety")} />
      <StaffSectionTabs
        section="safety"
        current="drills"
        roles={session.user.roles}
        shop={shop}
        t={t}
      />
      <FlashParams params={["notice"]} />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}
      <DrillLog view={drills} />
    </StaffPage>
  );
}
