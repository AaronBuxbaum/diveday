"use server";

/** Who crews a departure: day-of operating work, open to every staffer. */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { recordTripActivity } from "@/db/operations";
import { getShopPersonName } from "@/db/people";
import { changeTripCrewOutcome, type TripCrewChange } from "@/db/trips";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

export async function updateTripCrewAction(
  shopSlug: string,
  tripId: string,
  change: TripCrewChange,
): Promise<{ ok: boolean; refusal?: "crew_clash" | "refused" }> {
  const s = (await requireShopSurface(shopSlug)).session;
  const db = await getDb();
  // The outcome rather than the boolean, because the Crew panel has something
  // to say about one of the refusals: "you cannot put this person on two boats
  // at once" is a sentence a staffer can act on, and "that didn't save" is one
  // they can only tap again over (issue #1695).
  const outcome = await changeTripCrewOutcome(db, s.user.shopId, tripId, change, {
    actorPersonId: s.user.personId,
  });
  if (outcome.ok) {
    // One write path for crew (Today's board and the trip's CrewSection both
    // call this), so the trip's activity log — read from the Trip surface —
    // stays the single record of who touched the crew and when, regardless of
    // which surface they used.
    const crewName = await getShopPersonName(db, s.user.shopId, change.personId);
    if (crewName !== null) {
      await recordTripActivity(db, {
        shopId: s.user.shopId,
        tripId,
        actorPersonId: s.user.personId,
        subjectPersonId: change.personId,
        entry:
          change.operation === "assign"
            ? { code: "crew_assigned", crew: crewName }
            : { code: "crew_removed", crew: crewName },
      });
    }
    revalidatePath(shopPath(shopSlug));
    revalidatePath(shopPath(shopSlug, "trips", tripId));
    revalidatePath(shopPath(shopSlug, "trips", tripId, "manifest"));
    return { ok: true };
  }
  return { ok: false, refusal: outcome.refusal };
}
