"use server";

import QRCode from "qrcode";
import { issuePartyWaiver } from "@/db/party-waiver-queue";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

/**
 * The counter tablet's QR for one seat's release: a `waiver_link` capability
 * (half an hour, spent by the signature; a code shown before keeps working), returned only as the locally encoded
 * image, never as a URL a staffer could copy.
 */
export async function issuePartyWaiverQrAction(
  shopSlug: string,
  tripId: string,
  leadBookingId: string,
  bookingId: string,
  /** The desk confirmed a parent or guardian is here to co-sign a minor's release (#3986). */
  guardianPresent?: unknown,
): Promise<{ ok: true; qr: string } | { ok: false; guardianCheck?: true }> {
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
    guardianPresent: guardianPresent === true,
  });
  if (!issued) return { ok: false };
  if ("guardianCheck" in issued) return { ok: false, guardianCheck: true };
  const url = new URL(`/waivers/${issued.token}`, `${origin}/`).toString();
  return { ok: true, qr: await QRCode.toDataURL(url, { margin: 4, width: 256 }) };
}
