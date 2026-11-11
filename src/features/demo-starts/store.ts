import { and, asc, eq, exists, gte } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { people, shops, tripAssignments, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips";
import { nowDate } from "@/lib/clock";

/** One upcoming demo departure; a captain only lands on a boat they crew. */
export async function demoStartDeparture(
  db: AppDb,
  shopId: string,
  captainEmail?: string,
): Promise<string | null> {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .innerJoin(shops, and(eq(shops.id, trips.shopId), eq(shops.isDemo, true)))
    .where(
      and(
        eq(trips.shopId, shopId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, nowDate()),
        captainEmail
          ? exists(
              db
                .select({ id: tripAssignments.personId })
                .from(tripAssignments)
                .innerJoin(people, eq(people.id, tripAssignments.personId))
                .where(
                  and(
                    eq(tripAssignments.tripId, trips.id),
                    eq(people.shopId, shopId),
                    eq(people.email, captainEmail),
                  ),
                ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id))
    .limit(1);
  return trip?.id ?? null;
}
