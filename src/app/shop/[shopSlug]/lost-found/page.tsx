import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { lostItemRowAction } from "@/app/actions/lost-items";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { LostItemRow } from "@/components/lost-found/LostItemRow";
import { lostItemRowCopy } from "@/components/lost-found/lost-found-copy";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { listOpenLostItems } from "@/db/lost-items";
import { fill } from "@/i18n/fill";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

// `instant = true`: this segment's `loading.tsx` paints while the list
// streams (ADR 20260804-instant-navigation).
export const instant = true;

export const metadata: Metadata = {
  title: "Lost and found — DiveDay",
};

/**
 * **Lost and found** (batch 4, J2): everything crews found aboard that has
 * not gone home yet, across every departure, newest first. Each row works the
 * same as on the departure's Boat tab, where items are written down.
 */
export default async function LostFoundPage({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const { db, shop } = await requireShopSurface(shopSlug);
  // Switched off on the Features page: no list, and no error either.
  if (!shop.lostFoundEnabled) redirect(shopPath(shopSlug, "schedule", "board"));
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const items = await listOpenLostItems(db, shop.id);
  const copy = lostItemRowCopy(t);
  const tripLine = t.raw("desk.lostFound.tripLine");
  return (
    <StaffPage width="reading">
      <ShopPageHeader title={t("shared.shopNavLinks.lostFound")} />
      {items.length === 0 ? (
        <div className="py-16 text-center">
          <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-primary-tint text-primary">
            <DiveDayIcon name="empty" className="size-8" />
          </div>
          <h2 className="font-medium">{t("desk.lostFound.empty")}</h2>
        </div>
      ) : (
        <ul className="divide-y divide-border" data-testid="lost-found-list">
          {items.map((item) => (
            <LostItemRow
              key={item.id}
              item={item}
              context={fill(tripLine, {
                title: item.tripTitle,
                date: formatShortDate(item.tripStartsAt, locale, shop.timezone),
              })}
              action={lostItemRowAction.bind(null, item.tripId)}
              copy={copy}
            />
          ))}
        </ul>
      )}
    </StaffPage>
  );
}
