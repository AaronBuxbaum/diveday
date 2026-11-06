import { notFound } from "next/navigation";
import { DoctorReferralSheet } from "@/app/(token)/waivers/[token]/doctor/DoctorReferralSheet";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EyebrowWayUp } from "@/components/EyebrowWayUp";
import { PrintButton } from "@/components/PrintButton";
import { PAGE_TITLE_CLASS } from "@/components/ui/typography";
import { getCounterDoctorReferral } from "@/db/party-waiver-queue";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { capabilityPagePrintRule } from "@/lib/print-sheets";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

export const instant = true;

/**
 * **The physician form, printed at the desk** (issue #3984). A diver referred
 * at the counter signed on the shop's tablet, so they hold no doctor's page:
 * the desk prints the same sheet the doctor's page prints, for the diver to
 * carry. Their answers stay off it (`getCounterDoctorReferral`).
 */
export default async function CounterDoctorFormPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string; leadId: string; bookingId: string }>;
}) {
  const { shopSlug, id, leadId, bookingId } = await params;
  if (!uuidParam(id) || !uuidParam(leadId) || !uuidParam(bookingId)) notFound();
  const { db, shop } = await requireShopSurface(shopSlug);
  const [referral, locale] = await Promise.all([
    getCounterDoctorReferral(db, { shopId: shop.id, tripId: id, leadBookingId: leadId, bookingId }),
    requestLocale(shop.defaultLocale),
  ]);
  if (!referral) notFound();
  const t = staffTranslator(locale);
  return (
    <StaffPage width="reading">
      {/* No page margin, so the browser prints no staff URL on the diver's
          paper. A fixed rule from `capabilityPagePrintRule`, never a request value. */}
      <style data-capability-print="">{capabilityPagePrintRule()}</style>
      <div className="space-y-6">
        <EyebrowWayUp>{t("trips.partyWaiverQueue.doctorBack")}</EyebrowWayUp>
        <div>
          <h1 className={PAGE_TITLE_CLASS}>{t("trips.partyWaiverQueue.doctorTitle")}</h1>
          <p className="mt-3">
            {t("trips.partyWaiverQueue.doctorIntro", { name: referral.fullName })}
          </p>
        </div>
        <PrintButton label={t("trips.partyWaiverQueue.doctorPrint")} />
        {/* What the diver carries, in the shop's own words for divers. */}
        <DoctorReferralSheet referral={referral} shop={shop} t={diverTranslator(locale)} />
      </div>
    </StaffPage>
  );
}
