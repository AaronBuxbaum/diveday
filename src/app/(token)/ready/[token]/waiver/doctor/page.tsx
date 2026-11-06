import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getDoctorReferral, getWaiverForToken, threadWaiverKey } from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DoctorReferralBody } from "../../../../waivers/[token]/doctor/DoctorReferralBody";
import { revealDoctorAnswersFromReady, sendDoctorFormFromReady } from "../../waiver-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return { title: t("waiver.doctor.title"), robots: { index: false, follow: false } };
}

// A real static shell: every request-scoped read below sits inside this
// segment's `loading.tsx` boundary (ADR 20260804-instant-navigation).
export const instant = true;

/**
 * **Take this to your doctor**, from the diver's own thread (issue #2743): the
 * one doctor's page a seat's release has, since a seat's waiver link opens
 * nothing. The readiness link is the authority, the record is the seat's own
 * (`threadWaiverKey`), and it opens only while the release waits on a
 * physician and its departure has not ended (`getDoctorReferral`); anything
 * else goes back to the release's receipt, which says each state honestly.
 */
export default async function ThreadDoctorReferralPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token } = await params;
  const waiverPath = `/ready/${token}/waiver`;
  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) redirect(`/ready/${token}`);
  const key = await threadWaiverKey(db, {
    shopId: capability.shopId,
    bookingId: capability.bookingId,
  });
  if (!key) redirect(waiverPath);
  const state = await getWaiverForToken(db, key);
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
      revealAction={revealDoctorAnswersFromReady.bind(null, token)}
      sendAction={sendDoctorFormFromReady.bind(null, token)}
    />
  );
}
