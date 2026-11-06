import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getTripDiveSitesPeek } from "@/db/trips";
import { getBookingTripId } from "@/db/waiver-signing";
import { doctorPageOpen, getWaiverForToken, threadWaiverKey } from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { isUnresolvedMedicalHold } from "@/lib/waivers";
import { completedMedicalState } from "../../../waivers/[token]/completed-medical-state";
import { completedWaiverRail, WaiverCompleted } from "../../../waivers/[token]/WaiverCompleted";
import { waiverSigningForm } from "../../../waivers/[token]/WaiverSigningForm";
import { completeWaiverFromReady, saveWaiverDraftFromReady } from "../waiver-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return { title: t("waiver.metaTitle"), robots: { index: false, follow: false } };
}

// A real static shell: every request-scoped read below sits inside this
// segment's `loading.tsx` boundary (ADR 20260804-instant-navigation).
export const instant = true;

/**
 * **The release, signed as the thread's Sign step** (issue #2743).
 *
 * The diver's readiness link opens it, and nothing else: the record is the
 * seat's own (`threadWaiverKey`), resolved from the verified capability on
 * every render and every act, so the diver never holds a second credential for
 * paperwork. The form is the waiver link's own (`waiverSigningForm`), words,
 * rail and typed-name standard included.
 *
 * It opens only what the Sign step opened (`openWaiverFromReady`): a link the
 * page cannot vouch for, a release that has run out or been replaced, or one
 * already signed and clear goes back to `/ready`, which says each of those
 * honestly. A signed release waiting on a physician shows its receipt, with the
 * physician instructions and the doctor's page. A seat held for staff to
 * confirm who it is opens nothing here, not even a medical status.
 */
export default async function ThreadWaiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    field?: string;
    q?: string;
    at?: string;
  }>;
}) {
  await connection();
  const { token } = await params;
  const { saved, error, field, q, at } = await searchParams;
  const prep = `/ready/${token}`;
  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) redirect(prep);
  const key = await threadWaiverKey(db, {
    shopId: capability.shopId,
    bookingId: capability.bookingId,
  });
  if (!key) redirect(prep);
  const state = await getWaiverForToken(db, key);
  // A held seat has no key at all (`threadWaiverKey`), so "held" never reaches here.
  if (state.state !== "available" && state.state !== "completed") redirect(prep);
  const shop = await getShopById(db, state.record.shopId);
  if (!shop) redirect(prep);
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);

  if (state.state === "completed") {
    if (!isUnresolvedMedicalHold(state.record)) redirect(prep);
    const tripId = await getBookingTripId(db, shop.id, capability.bookingId);
    const doctorDoor = await doctorPageOpen(db, state.record);
    return (
      <WaiverCompleted
        shop={shop}
        t={t}
        locale={locale}
        waiverOnly={false}
        medicalState={completedMedicalState(state.record)}
        showPrepHelp={false}
        readyPath={prep}
        doctorPath={doctorDoor ? `${prep}/waiver/doctor` : null}
        signedRail={completedWaiverRail(true, !!state.record.shopAnswers)}
        diveSitesList={tripId ? await getTripDiveSitesPeek(db, tripId) : []}
      />
    );
  }

  return waiverSigningForm({
    db,
    record: state.record,
    shop,
    locale,
    t,
    search: { saved, error, field, q, at },
    // The drawn release's id pins the signature to these words; it grants nothing.
    completeAction: completeWaiverFromReady.bind(null, token, state.record.id),
    saveAction: saveWaiverDraftFromReady.bind(null, token, state.record.id),
    linkExpiresAt: null,
    prefillMedical: true,
    backHref: prep,
  });
}
