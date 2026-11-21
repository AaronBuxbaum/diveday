"use server";

import { revalidatePath } from "next/cache";
import { acknowledgeFlySafeFollowUp } from "@/db/fly-safe-correction";
import { requireShopSurface } from "@/features/accounts/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/**
 * Staff attest to resolving the advice; this is not an email delivery receipt.
 * From Today's shop-wide list (layer E); the follow-up's own trip is
 * revalidated too, since its Wrapped up lists it as left to close out.
 */
export async function acknowledgeFlySafeAction(
  shopSlug: string,
  tripId: string,
  bookingId: string,
  fingerprint: string,
) {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  if (!uuidParam(tripId) || !uuidParam(bookingId) || !/^[a-f0-9]{64}$/.test(fingerprint)) return;
  await acknowledgeFlySafeFollowUp(db, {
    shopId: shop.id,
    bookingId,
    fingerprint,
    actorPersonId: session.user.personId,
  });
  revalidatePath(shopPath(shopSlug));
  revalidatePath(shopPath(shopSlug, "trips", tripId));
}
