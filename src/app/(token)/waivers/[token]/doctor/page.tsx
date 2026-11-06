import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getDoctorReferral, getWaiverForToken } from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { revealDoctorAnswersAction, sendDoctorFormAction } from "./actions";
import { DoctorReferralBody } from "./DoctorReferralBody";
import { partyDoorKey } from "./party-door";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return { title: t("waiver.doctor.title"), robots: { index: false, follow: false } };
}

// A real static shell: every request-scoped read below sits inside this
// segment's `loading.tsx` boundary (ADR 20260804-instant-navigation).
export const instant = true;

/**
 * **Take this to your doctor, from a party member's door** (issue #4003). A
 * member is sent no readiness link, so the door that carried their release is
 * where its doctor's page lives: open on the phone that claimed it, only while
 * the release waits on a physician and its departure has not ended
 * (`getDoctorReferral`). Anything else goes back to the release's receipt,
 * which says each state honestly.
 */
export default async function PartyDoorDoctorPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token } = await params;
  const waiverPath = `/waivers/${encodeURIComponent(token)}`;
  const db = await getDb();
  const key = await partyDoorKey(db, token);
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
      revealAction={revealDoctorAnswersAction.bind(null, token)}
      sendAction={sendDoctorFormAction.bind(null, token)}
    />
  );
}
