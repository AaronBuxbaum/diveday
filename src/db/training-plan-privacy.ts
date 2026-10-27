import { and, eq, inArray, or } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, tripAssignments, trips } from "./schema";

/** Remove plans involving these identities; retain no stale staff attribution. */
export async function forgetTrainingPlanPeople(tx: DbExecutor, shopId: string, ids: string[]) {
  if (ids.length === 0) return;
  const cleared = {
    trainingPlanInstructorPersonId: null,
    trainingPlanByPersonId: null,
    trainingPlanAt: null,
  };
  await tx
    .update(bookings)
    .set(cleared)
    .where(
      and(
        eq(bookings.shopId, shopId),
        or(
          inArray(bookings.personId, ids),
          inArray(bookings.trainingPlanInstructorPersonId, ids),
          inArray(bookings.trainingPlanByPersonId, ids),
        ),
      ),
    );
  const shopTrips = tx
    .select({ id: trips.id })
    .from(trips)
    // diveday:allow-deleted-trips: erasure also clears plans on deleted departures.
    .where(eq(trips.shopId, shopId));
  await tx
    .update(tripAssignments)
    .set(cleared)
    .where(
      and(
        inArray(tripAssignments.tripId, shopTrips),
        or(
          inArray(tripAssignments.personId, ids),
          inArray(tripAssignments.trainingPlanInstructorPersonId, ids),
          inArray(tripAssignments.trainingPlanByPersonId, ids),
        ),
      ),
    );
}
