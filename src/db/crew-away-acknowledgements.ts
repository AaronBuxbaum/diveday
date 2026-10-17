import { and, eq, inArray, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { crewAwayAcknowledgements, people, tripAssignments, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **"Working it anyway"** (issue #2678, decided by Aaron 2026-10-17): a staffer
 * saying that a crew member who is away on a day a departure meets is working
 * it all the same. Per crew assignment, set from Today's `crew_away` row; it
 * clears the diver-side "to be confirmed" mark and the Today row for that
 * departure only (`crewAwayByTrip` reads it), and never edits the person's own
 * days-away block or its note.
 */
export type AcknowledgeCrewAwayOutcome = "saved" | "not_on_crew";

/**
 * Record the acknowledgement. Refused unless `personId` is on this live
 * departure's crew in this shop: the trip and the person both come from the
 * client, so the assignment is what proves they belong together. Saying it
 * twice is one row.
 */
export async function acknowledgeCrewAway(
  db: AppDb,
  input: { shopId: string; tripId: string; personId: string; actorPersonId: string },
): Promise<AcknowledgeCrewAwayOutcome> {
  return db.transaction(async (tx) => {
    const [assigned] = await tx
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .where(
        and(
          eq(tripAssignments.tripId, input.tripId),
          eq(tripAssignments.personId, input.personId),
          eq(trips.shopId, input.shopId),
          eq(people.shopId, input.shopId),
          liveTrip(),
        ),
      )
      .limit(1);
    if (!assigned) return "not_on_crew";
    await tx
      .insert(crewAwayAcknowledgements)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        personId: input.personId,
        acknowledgedByPersonId: input.actorPersonId,
      })
      .onConflictDoNothing();
    return "saved";
  });
}

/**
 * Taking someone off a departure ends what was said about them on it, so a
 * later re-assignment starts unconfirmed. Called inside each crew writer's own
 * transaction, beside the "removed" crew notice.
 */
export async function clearCrewAwayAcknowledgements(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; personIds: readonly string[] },
): Promise<void> {
  if (input.personIds.length === 0) return;
  await tx
    .update(crewAwayAcknowledgements)
    .set({ deletedAt: nowDate() })
    .where(
      and(
        eq(crewAwayAcknowledgements.shopId, input.shopId),
        eq(crewAwayAcknowledgements.tripId, input.tripId),
        inArray(crewAwayAcknowledgements.personId, [...input.personIds]),
        isNull(crewAwayAcknowledgements.deletedAt),
      ),
    );
}

/** `tripId:personId` for every live acknowledgement on `tripIds`, in this shop. */
export async function crewAwayAcknowledgedKeys(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Set<string>> {
  if (tripIds.length === 0) return new Set();
  const rows = await db
    .select({
      tripId: crewAwayAcknowledgements.tripId,
      personId: crewAwayAcknowledgements.personId,
    })
    .from(crewAwayAcknowledgements)
    .where(
      and(
        eq(crewAwayAcknowledgements.shopId, shopId),
        inArray(crewAwayAcknowledgements.tripId, [...tripIds]),
        isNull(crewAwayAcknowledgements.deletedAt),
      ),
    );
  return new Set(rows.map((row) => acknowledgedKey(row.tripId, row.personId)));
}

export function acknowledgedKey(tripId: string, personId: string): string {
  return `${tripId}:${personId}`;
}
