import { notFound } from "next/navigation";
import { uuidParam } from "@/lib/uuid";
import { BlowoutPageBody } from "./blowout/BlowoutPageBody";
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
