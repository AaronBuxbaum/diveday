"use server";

/** Who crews a departure: day-of operating work, open to every staffer. */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { withdrawCrewAwayAcknowledgement } from "@/db/crew-away-acknowledgements";
import { recordTripActivity } from "@/db/operations";
import { getShopPersonName } from "@/db/people";
import { personClashesAfterMove } from "@/db/person-clashes";
import { changeTripCrewOutcome, moveTripCrewMember, type TripCrewChange } from "@/db/trips";
import { revalidateAndRedirect } from "@/features/navigation";
import { requireShopSurface } from "@/features/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

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

/**
 * **"No longer working it"** (issue #2678, dock review S2): takes back a
 * staffer's "working it anyway", so Today's row and the diver-side mark
 * return. Open to every staffer, like the crew itself; the write is scoped to
 * the session's shop and records who took it back.
 */
export async function withdrawCrewAwayAcknowledgementAction(
  shopSlug: string,
  tripId: string,
  personId: string,
): Promise<void> {
  const s = (await requireShopSurface(shopSlug)).session;
  const page = shopPath(shopSlug, "trips", tripId);
  if (!uuidParam(tripId) || !uuidParam(personId)) revalidateAndRedirect(page);
  await withdrawCrewAwayAcknowledgement(await getDb(), {
    shopId: s.user.shopId,
    tripId,
    personId,
    actorPersonId: s.user.personId,
  });
  revalidatePath(shopPath(shopSlug));
  revalidateAndRedirect(page, `${page}?view=details#crew`);
}

/**
 * **Move a crew member to another boat in one step** (issue #4474): off this
 * departure and onto the other, keeping their job aboard, or neither
 * (`moveTripCrewMember`). Two crews on one person at once is refused there; a
 * seat they hold on an overlapping boat is a warning, read after the move
 * commits so whichever write landed last is the one that says it.
 */
export async function moveTripCrewAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
): Promise<void> {
  const s = (await requireShopSurface(shopSlug)).session;
  const page = shopPath(shopSlug, "trips", tripId);
  const back = `${page}?view=details#crew`;
  const personId = formData.get("personId");
  const toTripId = formData.get("toTripId");
  if (
    !uuidParam(tripId) ||
    typeof personId !== "string" ||
    !uuidParam(personId) ||
    typeof toTripId !== "string" ||
    !uuidParam(toTripId)
  ) {
    revalidateAndRedirect(page, back);
  }
  const db = await getDb();
  const shopId = s.user.shopId;
  const moved = await moveTripCrewMember(
    db,
    shopId,
    { personId, fromTripId: tripId, toTripId },
    { actorPersonId: s.user.personId },
  );
  if (!moved.ok) {
    revalidateAndRedirect(page, noticeUrl(back, "crew-conflict"));
  }
  const crewName = await getShopPersonName(db, shopId, personId);
  if (crewName !== null) {
    for (const [trip, code] of [
      [tripId, "crew_removed"],
      [toTripId, "crew_assigned"],
    ] as const) {
      await recordTripActivity(db, {
        shopId,
        tripId: trip,
        actorPersonId: s.user.personId,
        subjectPersonId: personId,
        entry: { code, crew: crewName },
      });
    }
  }
  const clashes = await personClashesAfterMove(db, shopId, toTripId, personId);
  revalidatePath(shopPath(shopSlug));
  revalidatePath(shopPath(shopSlug, "schedule", "board"));
  revalidatePath(shopPath(shopSlug, "trips", toTripId));
  revalidatePath(shopPath(shopSlug, "trips", toTripId, "manifest"));
  revalidatePath(shopPath(shopSlug, "trips", tripId, "manifest"));
  revalidateAndRedirect(
    page,
    noticeUrl(back, clashes.length > 0 ? "crew-moved-clash" : "crew-moved"),
  );
}
