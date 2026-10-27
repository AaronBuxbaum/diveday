"use server";

import { revalidatePath } from "next/cache";
import { acknowledgeFlySafeFollowUp } from "@/db/fly-safe-correction";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/** Staff attest to resolving the advice; this is not an email delivery receipt. */
export async function acknowledgeFlySafeAction(
  shopSlug: string,
  currentTripId: string,
  bookingId: string,
  fingerprint: string,
) {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  if (!uuidParam(currentTripId) || !uuidParam(bookingId) || !/^[a-f0-9]{64}$/.test(fingerprint))
    return;
  await acknowledgeFlySafeFollowUp(db, {
    shopId: shop.id,
    bookingId,
    fingerprint,
    actorPersonId: session.user.personId,
  });
  revalidatePath(shopPath(shopSlug, "trips", currentTripId));
}
