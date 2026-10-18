import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { overlappingBlocks } from "@/lib/crew-requests";
import type { AppDb, DbExecutor } from "./client";
import {
  crewAvailabilityBlocks,
  crewAwayAcknowledgements,
  people,
  shops,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **"Working it anyway"** (issue #2678, decided by Aaron 2026-10-17): a staffer
 * saying that a crew member who is away on a day a departure meets is working
 * it all the same. Per crew assignment, set from Today's `crew_away` row; it
 * clears the diver-side "to be confirmed" mark and the Today row for that
 * departure only (`crewAwayByTrip` reads it), and never edits the person's own
 * days-away block or its note.
 *
 * Tied to the days away it answered (security and dock reviews): it is
 * refused unless the person is away on a day the departure meets, a day away
 * told after it is not covered by it, and it goes when the person comes off
 * the crew, when the departure's dates move, or when a staffer takes it back.
 * The person cannot say it about themself: the row warns the shop about them.
 */
export type AcknowledgeCrewAwayOutcome = "saved" | "not_on_crew" | "not_away" | "own_away";

/**
 * Record the acknowledgement. Refused unless `personId` is on this live
 * departure's crew in this shop (the trip and the person both come from the
 * client, so the assignment is what proves they belong together), is away on
 * a day it meets, and is not the actor. The assignment is locked for the
 * transaction, so a crew swap cannot land between the check and the write.
 * Saying it again restamps it, which is how a newer day away is covered.
 */
export async function acknowledgeCrewAway(
  db: AppDb,
  input: { shopId: string; tripId: string; personId: string; actorPersonId: string },
): Promise<AcknowledgeCrewAwayOutcome> {
  if (input.personId === input.actorPersonId) return "own_away";
  return db.transaction(async (tx) => {
    const [assigned] = await tx
      .select({
        startsAt: trips.startsAt,
        endsAt: trips.endsAt,
        timeZone: shops.timezone,
      })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .innerJoin(shops, eq(shops.id, trips.shopId))
      .where(
        and(
          eq(tripAssignments.tripId, input.tripId),
          eq(tripAssignments.personId, input.personId),
          eq(trips.shopId, input.shopId),
          eq(people.shopId, input.shopId),
          liveTrip(),
        ),
      )
      .limit(1)
      .for("update", { of: tripAssignments });
    if (!assigned) return "not_on_crew";
    if (!(await awayOnDeparture(tx, input, assigned))) return "not_away";
    const stamp = nowDate();
    await tx
      .insert(crewAwayAcknowledgements)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        personId: input.personId,
        acknowledgedByPersonId: input.actorPersonId,
        createdAt: stamp,
      })
      .onConflictDoUpdate({
        target: [crewAwayAcknowledgements.tripId, crewAwayAcknowledgements.personId],
        targetWhere: isNull(crewAwayAcknowledgements.deletedAt),
        set: { acknowledgedByPersonId: input.actorPersonId, createdAt: stamp },
      });
    return "saved";
  });
}

/** Whether `personId` has a live day away on a day this departure meets (`overlappingBlocks`). */
async function awayOnDeparture(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; personId: string },
  trip: { startsAt: Date; endsAt: Date; timeZone: string },
): Promise<boolean> {
  const days = await tx
    .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, input.tripId))
    .orderBy(asc(tripScheduleDays.dayNumber));
  const meetings = days.length > 0 ? days : [{ startsAt: trip.startsAt, endsAt: trip.endsAt }];
  const blocks = await tx
    .select({
      id: crewAvailabilityBlocks.id,
      personId: crewAvailabilityBlocks.personId,
      startsOn: crewAvailabilityBlocks.startsOn,
      endsOn: crewAvailabilityBlocks.endsOn,
    })
    .from(crewAvailabilityBlocks)
    .where(
      and(
        eq(crewAvailabilityBlocks.shopId, input.shopId),
        eq(crewAvailabilityBlocks.personId, input.personId),
        isNull(crewAvailabilityBlocks.deletedAt),
        lte(crewAvailabilityBlocks.startsOn, calendarDateInTimezone(trip.endsAt, trip.timeZone)),
        gte(crewAvailabilityBlocks.endsOn, calendarDateInTimezone(trip.startsAt, trip.timeZone)),
      ),
    );
  const away = overlappingBlocks(
    blocks.map((block) => ({ ...block, note: null })),
    input.personId,
    meetings,
    trip.timeZone,
  );
  return away.length > 0;
}

/**
 * **"No longer working it"** (dock review S2): a staffer takes the
 * acknowledgement back, and the Today row and the diver-side mark return.
 * Soft, and it records who took it back. Anyone on the staff may, the
 * person themself included: it only restores the warning.
 */
export async function withdrawCrewAwayAcknowledgement(
  db: AppDb,
  input: { shopId: string; tripId: string; personId: string; actorPersonId: string },
): Promise<"cleared" | "not_found"> {
  const cleared = await db
    .update(crewAwayAcknowledgements)
    .set({ deletedAt: nowDate(), clearedByPersonId: input.actorPersonId })
    .where(
      and(
        eq(crewAwayAcknowledgements.shopId, input.shopId),
        eq(crewAwayAcknowledgements.tripId, input.tripId),
        eq(crewAwayAcknowledgements.personId, input.personId),
        isNull(crewAwayAcknowledgements.deletedAt),
      ),
    )
    .returning({ id: crewAwayAcknowledgements.id });
  return cleared.length > 0 ? "cleared" : "not_found";
}

/**
 * Taking someone off a departure, or moving its dates, ends what was said
 * about them on it, so a later re-assignment or the new dates start
 * unconfirmed. Called inside each writer's own transaction; without
 * `personIds` it clears everyone on the departure.
 */
export async function clearCrewAwayAcknowledgements(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; personIds?: readonly string[] },
): Promise<void> {
  if (input.personIds?.length === 0) return;
  await tx
    .update(crewAwayAcknowledgements)
    .set({ deletedAt: nowDate() })
    .where(
      and(
        eq(crewAwayAcknowledgements.shopId, input.shopId),
        eq(crewAwayAcknowledgements.tripId, input.tripId),
        input.personIds
          ? inArray(crewAwayAcknowledgements.personId, [...input.personIds])
          : undefined,
        isNull(crewAwayAcknowledgements.deletedAt),
      ),
    );
}

/** `tripId:personId` → when it was said, for every live acknowledgement on `tripIds`, in this shop. */
export async function crewAwayAcknowledgedAt(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, Date>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db
    .select({
      tripId: crewAwayAcknowledgements.tripId,
      personId: crewAwayAcknowledgements.personId,
      createdAt: crewAwayAcknowledgements.createdAt,
    })
    .from(crewAwayAcknowledgements)
    .where(
      and(
        eq(crewAwayAcknowledgements.shopId, shopId),
        inArray(crewAwayAcknowledgements.tripId, [...tripIds]),
        isNull(crewAwayAcknowledgements.deletedAt),
      ),
    );
  return new Map(rows.map((row) => [acknowledgedKey(row.tripId, row.personId), row.createdAt]));
}

export function acknowledgedKey(tripId: string, personId: string): string {
  return `${tripId}:${personId}`;
}

/**
 * The live acknowledgements on one departure, with who said them and when:
 * the trip page's "No longer working it" and the departure log's line
 * ("Marcus was away; acknowledged by Dana at 07:12", records review S2).
 */
export async function listCrewAwayAcknowledgements(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<
  { personId: string; fullName: string; acknowledgedByName: string | null; acknowledgedAt: Date }[]
> {
  const by = alias(people, "acknowledged_by");
  return db
    .select({
      personId: crewAwayAcknowledgements.personId,
      fullName: people.fullName,
      acknowledgedByName: by.fullName,
      acknowledgedAt: crewAwayAcknowledgements.createdAt,
    })
    .from(crewAwayAcknowledgements)
    .innerJoin(
      people,
      and(eq(people.id, crewAwayAcknowledgements.personId), eq(people.shopId, shopId)),
    )
    .leftJoin(by, eq(by.id, crewAwayAcknowledgements.acknowledgedByPersonId))
    .where(
      and(
        eq(crewAwayAcknowledgements.shopId, shopId),
        eq(crewAwayAcknowledgements.tripId, tripId),
        isNull(crewAwayAcknowledgements.deletedAt),
      ),
    )
    .orderBy(desc(crewAwayAcknowledgements.createdAt), asc(people.fullName));
}
