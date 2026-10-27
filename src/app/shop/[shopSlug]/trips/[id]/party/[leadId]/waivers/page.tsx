import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import {
  CourseFormsQrButton,
  CourseFormsQrProvider,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/CourseFormsQr";
import { PAGE_TITLE_CLASS } from "@/components/ui/typography";
import { getPartyWaiverQueue, type PartyWaiverState } from "@/db/party-waiver-queue";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { issuePartyWaiverQrAction } from "./actions";

export const instant = true;

export default async function PartyWaiversPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string; leadId: string }>;
}) {
  const { shopSlug, id, leadId } = await params;
  if (!uuidParam(id) || !uuidParam(leadId)) notFound();
  const { db, shop } = await requireShopSurface(shopSlug);
  const [queue, locale] = await Promise.all([
    getPartyWaiverQueue(db, { shopId: shop.id, tripId: id, leadBookingId: leadId }),
    requestLocale(shop.defaultLocale),
  ]);
  if (!queue) notFound();
  const t = staffTranslator(locale);
  const states: Record<PartyWaiverState, string> = {
    needed: t("trips.partyWaiverQueue.needed"),
    signed: t("trips.partyWaiverQueue.signed"),
    medical_review: t("trips.partyWaiverQueue.medicalReview"),
    medical_not_cleared: t("trips.partyWaiverQueue.medicalNotCleared"),
    held: t("trips.partyWaiverQueue.held"),
    not_required: t("trips.partyWaiverQueue.notRequired"),
    unknown: t("trips.partyWaiverQueue.unknown"),
  };
  const copy = {
    show: t("trips.partyWaiverQueue.show"),
    showFor: t("trips.partyWaiverQueue.showFor", { name: "{name}" }),
    title: t("trips.partyWaiverQueue.title"),
    scan: t("trips.partyWaiverQueue.scan"),
    close: t("trips.partyWaiverQueue.close"),
    loading: t("trips.partyWaiverQueue.loading"),
    failed: t("trips.partyWaiverQueue.failed"),
  };
  return (
    <StaffPage width="reading">
      <div className="space-y-6">
        <Link className="text-primary hover:underline" href={shopPath(shopSlug, "trips", id)}>
          {t("trips.partyWaiverQueue.back")}
        </Link>
        <div>
          <h1 className={PAGE_TITLE_CLASS}>{t("trips.partyWaiverQueue.title")}</h1>
          <p className="mt-1 text-muted">{queue.tripTitle}</p>
          <p className="mt-3">{t("trips.partyWaiverQueue.intro")}</p>
        </div>
        <CourseFormsQrProvider
          action={issuePartyWaiverQrAction.bind(null, shopSlug, id, leadId)}
          copy={copy}
        >
          <ul className="space-y-3">
            {queue.members.map((member) => (
              <li className="rounded-lg border border-border p-4" key={member.bookingId}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {member.name ?? t("trips.partyWaiverQueue.unnamed")}
                    </p>
                    <p>{states[member.state]}</p>
                    {member.guardianRequired && member.state === "needed" ? (
                      <p>{t("trips.partyWaiverQueue.guardian")}</p>
                    ) : null}
                    {member.medicalState &&
                    member.state !== "medical_review" &&
                    member.state !== "medical_not_cleared" ? (
                      <p>
                        {member.medicalState === "not_cleared"
                          ? t("trips.partyWaiverQueue.notCleared")
                          : t("trips.partyWaiverQueue.medical")}
                      </p>
                    ) : null}
                  </div>
                  {member.state === "needed" && member.name ? (
                    <CourseFormsQrButton bookingId={member.bookingId} name={member.name} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CourseFormsQrProvider>
      </div>
    </StaffPage>
  );
}
