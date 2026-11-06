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
  /** The desk confirmed a new code over one open on the diver's phone. */
  replace?: unknown,
  /** The desk confirmed a parent or guardian is here to co-sign a minor's release (#3986). */
  guardianPresent?: unknown,
): Promise<{ ok: true; qr: string } | { ok: false; openOnPhone?: true; guardianCheck?: true }> {
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
    replace: replace === true,
    guardianPresent: guardianPresent === true,
  });
  if (!issued) return { ok: false };
  if ("guardianCheck" in issued) return { ok: false, guardianCheck: true };
  if ("openOnPhone" in issued) return { ok: false, openOnPhone: true };
  const url = new URL(`/waivers/${issued.token}`, `${origin}/`).toString();
  return { ok: true, qr: await QRCode.toDataURL(url, { margin: 4, width: 256 }) };
}
