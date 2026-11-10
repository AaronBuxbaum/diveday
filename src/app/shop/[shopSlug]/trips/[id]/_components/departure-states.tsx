import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readTripBlowout } from "@/db/blowouts";
import { waitForNavigationGate } from "@/features/e2e-test-routes";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { MEDICAL_ALERTS_PRINT } from "@/lib/print-sheets";
import { runtimeMode } from "@/lib/runtime-mode";
import { uuidParam } from "@/lib/uuid";
import { BlowoutPageBody } from "./blowout/BlowoutPageBody";
import { blowoutTitleKey } from "./blowout/title";
import { MedicalAlertsPacketSheet } from "./MedicalAlertsPacketSheet";
import { PaperPassSheet } from "./PaperPassSheet";
import { TripPacketSheet } from "./TripPacketSheet";

/**
 * The departure's states that replace its tabs: the paper pass for one booking
 * (`?pass=<bookingId>`), the blow-out (`?blowout=1`, the confirmation before
 * the call and the cascade record after), the packet (`?print=1`, the sheets
 * a captain prints and carries) and the packet with the medical alerts' words
 * (`?print=medical-alerts`, the owner's or a manager's, recorded on the trail). `null` is the ordinary tabbed page.
 * Kept here so the route file stays a page.
 */
export async function departureStateOf(
  shopSlug: string,
  tripId: string,
  params: { pass?: string; blowout?: string; print?: string; notice?: string },
) {
  // Hold the dynamic read while the real loading boundary streams in the E2E harness.
  if (runtimeMode().e2eHarness) await waitForNavigationGate(tripId);
  if (params.pass !== undefined) {
    const bookingId = uuidParam(params.pass);
    if (!bookingId) notFound();
    return <PaperPassSheet shopSlug={shopSlug} tripId={tripId} bookingId={bookingId} />;
  }
  if (params.blowout !== undefined) {
    return <BlowoutPageBody shopSlug={shopSlug} tripId={tripId} notice={params.notice} />;
  }
  if (params.print === MEDICAL_ALERTS_PRINT) {
    return <MedicalAlertsPacketSheet shopSlug={shopSlug} tripId={tripId} />;
  }
  if (params.print !== undefined) return <TripPacketSheet shopSlug={shopSlug} tripId={tripId} />;
  return null;
}

/**
 * The tab title: the departure's, or its state's. The blow-out's title says
 * whether it was called off, so it is read only behind `requireShopSurface`: a
 * title read before the tenant gate would tell a stranger whether a guessed
 * departure was called off (issue 1569). The paper pass is never indexed. The packet's title is a fixed English one, as the route's was.
 */
export async function departureMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ pass?: string; blowout?: string; print?: string }>;
}): Promise<Metadata> {
  const [{ shopSlug, id }, { pass, blowout, print }] = await Promise.all([params, searchParams]);
  if (pass !== undefined) {
    return { title: "Paper pass — DiveDay", robots: { index: false, follow: false } };
  }
  if (print === MEDICAL_ALERTS_PRINT && blowout === undefined) {
    return { title: "Trip packet with medical alerts — DiveDay" };
  }
  if (print !== undefined && blowout === undefined) return { title: "Trip packet — DiveDay" };
  if (blowout === undefined) return { title: "Manage trip — DiveDay" };
  const tripId = uuidParam(id);
  if (!tripId) notFound();
  const { db, shop } = await requireShopSurface(shopSlug);
  const [locale, record] = await Promise.all([
    requestLocale(shop.defaultLocale),
    readTripBlowout(db, shop.id, tripId),
  ]);
  return { title: `${staffTranslator(locale)(blowoutTitleKey(record))} — DiveDay` };
}
