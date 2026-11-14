"use server";

import { revalidatePath } from "next/cache";
import { dismissBoardingObservation } from "@/db/boarding-observations";
import { settleDockObservations } from "@/features/no-show";
import { requireShopSurface } from "@/features/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/**
 * "Try again" on a diver waiting at the dock (issue #4474): the departure's
 * observations are allocated again under its lock, so a seat freed since, or
 * an instructor added since, puts them back. Open to every staffer, as the
 * desk's own tap is; scoped to the session's shop.
 */
export async function retryDockObservationsAction(shopSlug: string, tripId: string) {
  const { db, shop } = await requireShopSurface(shopSlug);
  if (!uuidParam(tripId)) return;
  // A staffer asked: the one pass that may still seat a diver after the boat's start.
  await settleDockObservations(db, { shopId: shop.id, tripId, by: "desk" });
  revalidatePath(shopPath(shopSlug, "trips", tripId));
  revalidatePath(shopPath(shopSlug, "schedule", "board"));
}

/** "Dismiss": the observation no longer stands; recorded with who said so. */
export async function dismissDockObservationAction(
  shopSlug: string,
  tripId: string,
  observationId: string,
) {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  if (!uuidParam(tripId) || !uuidParam(observationId)) return;
  await dismissBoardingObservation(db, {
    shopId: shop.id,
    tripId,
    observationId,
    actorPersonId: session.user.personId,
  });
  revalidatePath(shopPath(shopSlug, "trips", tripId));
  revalidatePath(shopPath(shopSlug, "schedule", "board"));
}
