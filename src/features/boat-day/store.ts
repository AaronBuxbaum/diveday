import { and, asc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { boats, people, tripAssignments, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips";
import { shopDaysBounds } from "@/lib/zoned";
import { type DayCollision, dayCollisions } from "./rules";

/** One departure of the day, with the boat it is on and who is crewing it. */
export type BoatDayDeparture = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  boatId: string | null;
  boatName: string | null;
  crew: { personId: string; name: string }[];
};

/**
 * **Every departure of one shop day across all its boats** (issue #4258), with the collisions
 * between them: one person crewing two overlapping departures, or one boat on two. The shop's
 * day, in its own time zone. A collision informs and never blocks (`src/lib/day-collisions.ts`).
 * Scoped by shop.
 */
export async function getBoatDay(
  db: AppDb,
  input: { shopId: string; date: string; timeZone: string },
): Promise<{ departures: BoatDayDeparture[]; collisions: DayCollision[] }> {
  const { from, to } = shopDaysBounds(input.date, input.date, input.timeZone);
  const rows = await db
    .select({
      tripId: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      boatId: trips.boatId,
      boatName: boats.name,
    })
    .from(trips)
    .leftJoin(boats, eq(boats.id, trips.boatId))
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, input.shopId),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, new Date(from.getTime() - 1)),
        lt(trips.startsAt, to),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
  const crewRows =
    rows.length === 0
      ? []
      : await db
          .select({ tripId: tripAssignments.tripId, personId: people.id, name: people.fullName })
          .from(tripAssignments)
          .innerJoin(people, eq(people.id, tripAssignments.personId))
          .where(
            and(
              inArray(
                tripAssignments.tripId,
                rows.map((row) => row.tripId),
              ),
              eq(people.shopId, input.shopId),
              isNull(people.deletedAt),
            ),
          )
          .orderBy(asc(people.fullName), asc(people.id));
  const departures = rows.map((row) => ({
    ...row,
    crew: crewRows
      .filter((member) => member.tripId === row.tripId)
      .map(({ personId, name }) => ({ personId, name })),
  }));
  return { departures, collisions: dayCollisions(departures) };
}
