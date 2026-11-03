import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getDoctorReferral, getWaiverForToken } from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { connectionForRoute } from "@/lib/observability/render-connection";
import { revealDoctorAnswersAction, sendDoctorFormAction } from "./actions";
import { DoctorReferralBody } from "./DoctorReferralBody";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return { title: t("waiver.doctor.title"), robots: { index: false, follow: false } };
}

// A real static shell: every request-scoped read below sits inside this
// segment's `loading.tsx` boundary (ADR 20260804-instant-navigation).
export const instant = true;

/**
 * **Take this to your doctor** (fifth-loop ideas, item 17; H-20261014-physician-form-for-referral and ADR
 * 20261016-doctor-referral-page, both amended by the layer r5-3 reviews). A
 * diver whose questionnaire referred them opens this from their own waiver
 * link and prints it: their name, the official form's examiner page to print,
 * the answers that call for a physician behind their date of birth, and how
 * the signed form gets back to the shop: sent from here, privately, or by the
 * shop's email or counter (issue #2797, ADR 20261024-diver-sent-doctors-form).
 *
 * The waiver link opens it only while the release waits on a physician and its
 * seat's departure has not ended; any other state goes back to the waiver
 * page, which already says each one honestly (never the 404 page, per
 * `scripts/check-capability-refusals.mjs`). It prints without its own URL
 * (`capabilityPagePrintRule`). Staff record the doctor's answer exactly as
 * before, from the diver's record.
 */
export default async function DoctorReferralPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connectionForRoute("/waivers/[token]/doctor");
  const { token } = await params;
  const waiverPath = `/waivers/${encodeURIComponent(token)}`;
  const db = await getDb();
  const state = await getWaiverForToken(db, token);
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
