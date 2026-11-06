import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { partySeatWaiverKey } from "@/db/seat-claims";
import { getShopById } from "@/db/shops";
import { getTripDiveSitesPeek } from "@/db/trips";
import { doctorPageOpen, getWaiverForToken } from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { uuidParam } from "@/lib/uuid";
import { isUnresolvedMedicalHold } from "@/lib/waivers";
import { completedMedicalState } from "../../../../../waivers/[token]/completed-medical-state";
import {
  completedWaiverRail,
  WaiverCompleted,
} from "../../../../../waivers/[token]/WaiverCompleted";
import { waiverSigningForm } from "../../../../../waivers/[token]/WaiverSigningForm";
import { completeMinorWaiver, saveMinorWaiverDraft } from "../../../party-waiver-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return { title: t("waiver.metaTitle"), robots: { index: false, follow: false } };
}

// A real static shell: every request-scoped read below sits inside this
// segment's `loading.tsx` boundary (ADR 20260804-instant-navigation).
export const instant = true;

/**
 * **A child's release, signed by their parent on the parent's own link**
 * (issue #2743, H-20261014-parent-signs-minor-release). The lead's readiness
 * link opens it, and the seat must be one the lead's party panel offers to
 * sign (`partySeatWaiverKey`, re-read on every render): the same form the
 * waiver link draws, which asks for the guardian's card for a declared minor.
 *
 * Anything else goes back to the lead's panel. Once the parent's signature
 * sent the release to a physician, this shows its receipt, with the
 * physician instructions and the doctor's page, and never a second form.
 */
export default async function PartySeatWaiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; seatId: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    field?: string;
    q?: string;
    at?: string;
  }>;
}) {
  await connection();
  const { token, seatId } = await params;
  const { saved, error, field, q, at } = await searchParams;
  const prep = `/ready/${token}`;
  const panel = `${prep}#party-seats`;
  const seatBookingId = uuidParam(seatId);
  if (!seatBookingId) redirect(panel);
  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) redirect(prep);
  const opened = await partySeatWaiverKey(db, {
    shopId: capability.shopId,
    leadBookingId: capability.bookingId,
    seatBookingId,
  });
  if (!opened) redirect(panel);
  const state = await getWaiverForToken(db, opened.key);
  const shop = state.state === "unavailable" ? null : await getShopById(db, state.record.shopId);
  if (!shop || state.state === "unavailable") redirect(panel);
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);
  const path = `${prep}/party/${seatBookingId}/waiver`;

  if (opened.door === "physician") {
    if (state.state !== "completed" || !isUnresolvedMedicalHold(state.record)) redirect(panel);
    const doctorDoor = await doctorPageOpen(db, state.record);
    return (
      <WaiverCompleted
        shop={shop}
        t={t}
        locale={locale}
        waiverOnly={false}
        medicalState={completedMedicalState(state.record)}
        showPrepHelp={false}
        readyPath={panel}
        doctorPath={doctorDoor ? `${path}/doctor` : null}
        signedRail={completedWaiverRail(true, !!state.record.shopAnswers)}
        diveSitesList={await getTripDiveSitesPeek(db, capability.tripId)}
      />
    );
  }
  if (state.state !== "available") redirect(panel);

  return waiverSigningForm({
    db,
    record: state.record,
    shop,
    locale,
    t,
    search: { saved, error, field, q, at },
    // The drawn release's id pins the signature to these words; it grants nothing.
    completeAction: completeMinorWaiver.bind(null, token, seatBookingId, state.record.id),
    saveAction: saveMinorWaiverDraft.bind(null, token, seatBookingId, state.record.id),
    linkExpiresAt: null,
    prefillMedical: true,
    backHref: panel,
  });
}
