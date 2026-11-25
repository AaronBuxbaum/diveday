import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import {
  CourseFormsQrButton,
  CourseFormsQrProvider,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/CourseFormsQr";
import { EyebrowWayUp } from "@/components/EyebrowWayUp";
import { buttonClass } from "@/components/ui/button";
import { PAGE_TITLE_CLASS } from "@/components/ui/typography";
import { requireShopSurface } from "@/features/accounts/session";
import { type PartyChannel, readPartyReached } from "@/features/bookings/party-reached";
import { getPartyWaiverQueue, type PartyWaiverState } from "@/features/waivers/party-waiver-queue";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { cachedListFormat } from "@/lib/intl-cache";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { issuePartyWaiverQrAction } from "./actions";

export const instant = true;

export default async function PartyWaiversPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string; leadId: string }>;
  /** `reached`: who the links of a party just added went to (`partyReachedParam`). */
  searchParams: Promise<{ reached?: string | string[] }>;
}) {
  const [{ shopSlug, id, leadId }, { reached: reachedParam }] = await Promise.all([
    params,
    searchParams,
  ]);
  if (!uuidParam(id) || !uuidParam(leadId)) notFound();
  const { db, shop } = await requireShopSurface(shopSlug);
  const [queue, locale] = await Promise.all([
    getPartyWaiverQueue(db, { shopId: shop.id, tripId: id, leadBookingId: leadId }),
    requestLocale(shop.defaultLocale),
  ]);
  if (!queue) notFound();
  const t = staffTranslator(locale);
  // A solo seat nobody can reach signs here too (issue #3984), often on the
  // shop's tablet: its own words, never a party's.
  const solo = queue.members.length === 1;
  const states: Record<PartyWaiverState, string> = {
    needed: t("trips.partyWaiverQueue.needed"),
    signed: t("trips.partyWaiverQueue.signed"),
    medical_review: t("trips.partyWaiverQueue.medicalReview"),
    medical_not_cleared: t("trips.partyWaiverQueue.medicalNotCleared"),
    held: t("trips.partyWaiverQueue.held"),
    not_required: t("trips.partyWaiverQueue.notRequired"),
    unknown: t("trips.partyWaiverQueue.unknown"),
  };
  // Landed here from the add: say who the links went to, and by what. The QR
  // code is then the second way, for whoever nothing reached or who signs here.
  const reached = readPartyReached(typeof reachedParam === "string" ? reachedParam : undefined);
  const channelWords: Record<PartyChannel, string> = {
    email: t("trips.partyWaiverQueue.channelEmail"),
    sms: t("trips.partyWaiverQueue.channelSms"),
    whatsapp: t("trips.partyWaiverQueue.channelWhatsapp"),
  };
  const channels = cachedListFormat(locale, { style: "long", type: "conjunction" });
  const sentBy = (bookingId: string): string | null => {
    if (!reached) return null;
    const by = reached.get(bookingId);
    return by && by.length > 0
      ? t("trips.partyWaiverQueue.sentBy", {
          channels: channels.format(by.map((channel) => channelWords[channel])),
        })
      : t("trips.partyWaiverQueue.notSent");
  };
  const sentLines = new Map(
    queue.members.map((member) => [member.bookingId, sentBy(member.bookingId)]),
  );
  const sent = reached ? queue.members.filter((member) => reached.has(member.bookingId)).length : 0;
  const intro = !reached
    ? solo
      ? t("trips.partyWaiverQueue.introSolo")
      : t("trips.partyWaiverQueue.intro")
    : sent === 0
      ? t("trips.partyWaiverQueue.reachedNone")
      : sent === queue.members.length
        ? t("trips.partyWaiverQueue.reachedAll")
        : t("trips.partyWaiverQueue.reachedSome", { sent, total: queue.members.length });
  const copy = {
    show: t("trips.partyWaiverQueue.show"),
    showFor: t("trips.partyWaiverQueue.showFor", { name: "{name}" }),
    title: solo ? t("trips.partyWaiverQueue.titleSolo") : t("trips.partyWaiverQueue.title"),
    scan: solo ? t("trips.partyWaiverQueue.scanSolo") : t("trips.partyWaiverQueue.scan"),
    close: t("trips.partyWaiverQueue.close"),
    loading: t("trips.partyWaiverQueue.loading"),
    failed: t("trips.partyWaiverQueue.failed"),
    guardianCheck: t("trips.partyWaiverQueue.guardianCheck"),
    guardianConfirm: t("trips.partyWaiverQueue.guardianConfirm"),
  };
  return (
    <StaffPage width="reading">
      <div className="space-y-6">
        <EyebrowWayUp>{t("trips.partyWaiverQueue.back")}</EyebrowWayUp>
        <div>
          <h1 className={PAGE_TITLE_CLASS}>
            {/* A solo seat nobody can reach signs here too (issue #3984). */}
            {solo ? t("trips.partyWaiverQueue.titleSolo") : t("trips.partyWaiverQueue.title")}
          </h1>
          <p className="mt-1 text-muted">{queue.tripTitle}</p>
          <p className="mt-3">{intro}</p>
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
                    {sentLines.get(member.bookingId) ? (
                      <p className="text-sm text-muted" data-reached="">
                        {sentLines.get(member.bookingId)}
                      </p>
                    ) : null}
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
                  <div className="flex flex-wrap gap-2">
                    {member.state === "needed" && member.name ? (
                      <CourseFormsQrButton
                        bookingId={member.bookingId}
                        name={member.name}
                        quiet={Boolean(reached?.has(member.bookingId))}
                      />
                    ) : null}
                    {/* Referred at the counter: the diver holds no doctor's
                        page, so the desk prints the form (issue #3984). */}
                    {member.state === "medical_review" ? (
                      <Link
                        className={buttonClass({ variant: "secondary" })}
                        href={shopPath(
                          shopSlug,
                          "trips",
                          id,
                          "party",
                          leadId,
                          "waivers",
                          member.bookingId,
                          "doctor",
                        )}
                      >
                        {t("trips.partyWaiverQueue.printDoctor")}
                      </Link>
                    ) : null}
                    {member.state === "held" || member.medicalState ? (
                      <Link
                        className={buttonClass({ variant: "secondary" })}
                        href={`${shopPath(shopSlug, "trips", id)}#booking-${member.bookingId}`}
                      >
                        {member.state === "held"
                          ? t("trips.partyWaiverQueue.confirmIdentity")
                          : t("trips.partyWaiverQueue.reviewMedical")}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CourseFormsQrProvider>
      </div>
    </StaffPage>
  );
}
