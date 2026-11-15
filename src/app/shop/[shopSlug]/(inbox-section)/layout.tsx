import { type ReactNode, Suspense } from "react";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { StaffSectionTabsSkeleton } from "@/app/shop/[shopSlug]/_components/StaffSectionTabs";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { staffDestinationGates } from "@/lib/authz";
import { shopSwitchesOn } from "@/lib/shop-features";
import {
  STAFF_DESTINATION_LABEL_KEYS,
  STAFF_SECTION_TAB_LABEL_KEYS,
  staffDestinationHref,
  staffSectionTabs,
  staffShopRoot,
} from "@/lib/staff-destinations";
import { InboxTabs } from "./InboxTabs";

async function Shell({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const { shop, session } = await requireShopSurface(shopSlug);
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  const tabs = staffSectionTabs(
    "inbox",
    staffDestinationGates(session.user.roles),
    shopSwitchesOn(shop),
  ).map((destination) => ({
    id: destination.id,
    href: staffDestinationHref(staffShopRoot(shop.slug), destination),
    label: t(
      STAFF_SECTION_TAB_LABEL_KEYS[destination.id] ?? STAFF_DESTINATION_LABEL_KEYS[destination.id],
    ),
  }));
  return (
    <>
      <ShopPageHeader title={t("shared.shopSections.inbox")} />
      <InboxTabs label={t("shared.shopSections.inbox")} tabs={tabs} />
      {children}
    </>
  );
}

export default function InboxSectionLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  return (
    <StaffPage width="full">
      <Suspense
        fallback={
          <>
            <ShopPageHeader pending eyebrow={false} titleWidth="w-32" description={false} />
            <StaffSectionTabsSkeleton section="inbox" />
          </>
        }
      >
        <Shell params={params}>{children}</Shell>
      </Suspense>
    </StaffPage>
  );
}
