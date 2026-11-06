"use server";

import QRCode from "qrcode";
import { issuePartyWaiver } from "@/db/party-waiver-queue";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

/**
 * The counter tablet's QR for one seat's release: a `waiver_link` capability
 * (half an hour, spent by the signature), returned only as the locally encoded
 * image, never as a URL a staffer could copy.
 */
export async function issuePartyWaiverQrAction(
  shopSlug: string,
  tripId: string,
  leadBookingId: string,
  bookingId: string,
): Promise<{ ok: true; qr: string } | { ok: false }> {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const origin = publicAppUrl();
  if (!origin || !uuidParam(tripId) || !uuidParam(leadBookingId) || !uuidParam(bookingId))
    return { ok: false };
  const issued = await issuePartyWaiver(db, {
    shopId: shop.id,
    tripId,
    leadBookingId,
    bookingId,
    // On the diver's trail: who showed the code (security review S2).
    actorPersonId: session.user.personId,
  });
  if (!issued) return { ok: false };
  const url = new URL(`/waivers/${issued.token}`, `${origin}/`).toString();
  return { ok: true, qr: await QRCode.toDataURL(url, { margin: 4, width: 256 }) };
}
