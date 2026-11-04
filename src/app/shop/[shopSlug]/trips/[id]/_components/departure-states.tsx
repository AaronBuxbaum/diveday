import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readTripBlowout } from "@/db/blowouts";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";
import { BlowoutPageBody } from "./blowout/BlowoutPageBody";
import { blowoutTitleKey } from "./blowout/title";
import { PaperPassSheet } from "./PaperPassSheet";

/**
 * The departure's states that replace its tabs: the paper pass for one booking
 * (`?pass=<bookingId>`) and the blow-out (`?blowout=1`, the confirmation before
 * the call and the cascade record after). `null` is the ordinary tabbed page.
 * Kept here so the route file stays a page.
 */
export async function departureStateOf(
  shopSlug: string,
  tripId: string,
  params: { pass?: string; blowout?: string; notice?: string },
) {
  if (params.pass !== undefined) {
    const bookingId = uuidParam(params.pass);
    if (!bookingId) notFound();
    return <PaperPassSheet shopSlug={shopSlug} tripId={tripId} bookingId={bookingId} />;
  }
  if (params.blowout !== undefined) {
    return <BlowoutPageBody shopSlug={shopSlug} tripId={tripId} notice={params.notice} />;
  }
  return null;
}

/**
 * The tab title: the departure's, or its state's. The blow-out's title says
 * whether it was called off, so it is read only behind `requireShopSurface`: a
 * title read before the tenant gate would tell a stranger whether a guessed
 * departure was called off (issue 1569). The paper pass is never indexed.
 */
export async function departureMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ pass?: string; blowout?: string }>;
}): Promise<Metadata> {
  const [{ shopSlug, id }, { pass, blowout }] = await Promise.all([params, searchParams]);
  if (pass !== undefined) {
    return { title: "Paper pass — DiveDay", robots: { index: false, follow: false } };
  }
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
