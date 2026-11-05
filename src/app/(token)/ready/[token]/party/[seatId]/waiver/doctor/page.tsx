import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { partySeatWaiverKey } from "@/db/seat-claims";
import { getShopById } from "@/db/shops";
import { getDoctorReferral, getWaiverForToken } from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { uuidParam } from "@/lib/uuid";
import { DoctorReferralBody } from "../../../../../../waivers/[token]/doctor/DoctorReferralBody";
import { revealMinorDoctorAnswers, sendMinorDoctorForm } from "../../../../party-waiver-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return { title: t("waiver.doctor.title"), robots: { index: false, follow: false } };
}

// A real static shell: every request-scoped read below sits inside this
// segment's `loading.tsx` boundary (ADR 20260804-instant-navigation).
export const instant = true;

/**
 * **Take this to your child's doctor**, from the parent's own link (issue
 * #2743): the waiver link's doctor's page for a child's release the parent
 * signed. Open only while the parent's signature has the release waiting on
 * a physician (`partySeatWaiverKey`'s `physician` door) and on the gate the
 * waiver link's page opens on (`getDoctorReferral`); anything else goes back
 * to the release's receipt, which says each state honestly.
 */
export default async function PartySeatDoctorReferralPage({
  params,
}: {
  params: Promise<{ token: string; seatId: string }>;
}) {
  await connection();
  const { token, seatId } = await params;
  const prep = `/ready/${token}`;
  const seatBookingId = uuidParam(seatId);
  if (!seatBookingId) redirect(`${prep}#party-seats`);
  const waiverPath = `${prep}/party/${seatBookingId}/waiver`;
  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) redirect(prep);
  const opened = await partySeatWaiverKey(db, {
    shopId: capability.shopId,
    leadBookingId: capability.bookingId,
    seatBookingId,
  });
  if (opened?.door !== "physician") redirect(waiverPath);
  const state = await getWaiverForToken(db, opened.key);
  if (state.state !== "completed") redirect(waiverPath);
  const [shop, referral] = await Promise.all([
    getShopById(db, state.record.shopId),
    getDoctorReferral(db, state.record),
  ]);
  if (!shop || !referral) redirect(waiverPath);
  const t = diverTranslator(await requestLocale(shop.defaultLocale));
  return (
    <DoctorReferralBody
      referral={referral}
      shop={shop}
      t={t}
      backPath={waiverPath}
      revealAction={revealMinorDoctorAnswers.bind(null, token, seatBookingId)}
      sendAction={sendMinorDoctorForm.bind(null, token, seatBookingId)}
    />
  );
}
