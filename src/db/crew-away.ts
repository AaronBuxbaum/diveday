import { and, asc, eq, inArray } from "drizzle-orm";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { type AvailabilityBlock, overlappingBlocks } from "@/lib/crew-requests";
import type { AppDb } from "./client";
import { listCrewAvailabilityBlocks } from "./crew-requests";
import { people, tripAssignments, trips } from "./schema";
import { tripMeetings } from "./staffing";
import { liveTrip } from "./trips-live";

/** One crew member on a departure who told the shop they are away on a day it meets. */
export type CrewAway = {
  personId: string;
  fullName: string;
  /** Their days away that the departure meets on, soonest first. */
  blocks: AvailabilityBlock[];
};

/**
 * **Who is rostered on a departure and away on a day it meets** (fourth
 * review, item 12), for each of `tripIds` that has anybody: the one join the
 * staffing week makes and every other staff surface did not. Marcus marked
 * himself away for the weekend while rostered on both Sunday sessions, and the
 * board, the owner's Today and his own session card all read as if he would be
 * at the pool.
 *
 * The same rule as the staffing week (`overlappingBlocks`, ADR
 * 20260902-crew-requests-and-blackouts): a departure meets on its schedule
 * days when it has them (a three-day course is three mornings, not 57 hours),
 * otherwise on its own window, read as calendar days in the shop's zone.
 * Informs, never gates: nobody is taken off a boat by this read.
 *
 * Scoped to the shop on every table, and only live departures. A departure
 * nobody away is rostered on is absent from the map.
 */
export async function crewAwayByTrip(
  db: AppDb,
  shopId: string,
  tripIds: readonly string[],
  timeZone: string,
): Promise<Map<string, CrewAway[]>> {
  const byTrip = new Map<string, CrewAway[]>();
  if (tripIds.length === 0) return byTrip;
  const rows = await db
    .select({
      tripId: trips.id,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      personId: people.id,
      fullName: people.fullName,
    })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(people.shopId, shopId),
        inArray(trips.id, [...tripIds]),
        liveTrip(),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(people.fullName));
  if (rows.length === 0) return byTrip;

  const from = calendarDateInTimezone(
    new Date(Math.min(...rows.map((row) => row.startsAt.getTime()))),
    timeZone,
  );
  const to = calendarDateInTimezone(
    new Date(Math.max(...rows.map((row) => row.endsAt.getTime()))),
    timeZone,
  );
  const [blocks, meetingsByTrip] = await Promise.all([
    listCrewAvailabilityBlocks(db, shopId, { from, to }),
    tripMeetings(db, [...new Set(rows.map((row) => row.tripId))]),
  ]);
  if (blocks.length === 0) return byTrip;

  for (const row of rows) {
    const meetings = meetingsByTrip.get(row.tripId) ?? [
      { startsAt: row.startsAt, endsAt: row.endsAt },
    ];
    const away = overlappingBlocks(blocks, row.personId, meetings, timeZone);
    if (away.length === 0) continue;
    const list = byTrip.get(row.tripId) ?? [];
    list.push({ personId: row.personId, fullName: row.fullName, blocks: away });
    byTrip.set(row.tripId, list);
  }
  return byTrip;
}
