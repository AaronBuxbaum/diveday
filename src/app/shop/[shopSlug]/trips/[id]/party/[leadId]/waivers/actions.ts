"use server";

import QRCode from "qrcode";
import { issuePartyWaiver } from "@/db/party-waiver-queue";
import { counterWaiverSealingAvailable, sealCounterWaiverToken } from "@/lib/counter-waiver-token";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

/** Return only the locally encoded image, never the capability URL as copy. */
export async function issuePartyWaiverQrAction(
  shopSlug: string,
  tripId: string,
  leadBookingId: string,
  bookingId: string,
): Promise<{ ok: true; qr: string } | { ok: false }> {
  const { db, shop } = await requireShopSurface(shopSlug);
  const origin = publicAppUrl();
  if (
    !origin ||
    !counterWaiverSealingAvailable() ||
    !uuidParam(tripId) ||
    !uuidParam(leadBookingId) ||
    !uuidParam(bookingId)
  )
    return { ok: false };
  const issued = await issuePartyWaiver(db, { shopId: shop.id, tripId, leadBookingId, bookingId });
  if (!issued) return { ok: false };
  const envelope = sealCounterWaiverToken(issued.token, issued.expiresAt);
  if (!envelope) return { ok: false };
  const url = new URL(`/waivers/${envelope}`, `${origin}/`).toString();
  return { ok: true, qr: await QRCode.toDataURL(url, { margin: 4, width: 256 }) };
}
