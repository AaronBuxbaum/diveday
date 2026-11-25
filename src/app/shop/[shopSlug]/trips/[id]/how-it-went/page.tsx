import { notFound, redirect } from "next/navigation";
import { requireShopSurface } from "@/features/accounts/session";
import { getHowItWentPage } from "@/features/day/how-it-went";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { HowItWentSheet } from "./HowItWentSheet";

export const instant = true;
export const metadata = { title: "How it went — DiveDay" };

/**
 * **How it went** (glossary): one departure's short account for the owner,
 * as a sheet, so it prints ink-light and reads the same on screen. The gate is
 * the departure log's; a refusal lands on the shop home with its reason.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const { shopSlug, id: tripId } = await params;
  if (!uuidParam(tripId)) notFound();
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const result = await getHowItWentPage(db, shop.id, tripId, session.user.personId);
  if (!result.allowed) redirect(noticeUrl(shopPath(shopSlug), "log-not-authorized"));
  if (!result.page) notFound();
  const locale = await requestLocale(shop.defaultLocale);
  return (
    <HowItWentSheet
      page={result.page}
      shop={shop}
      shopSlug={shopSlug}
      tripId={tripId}
      locale={locale}
      t={staffTranslator(locale)}
      printedAt={nowDate()}
      printedBy={session.user.name}
    />
  );
}
