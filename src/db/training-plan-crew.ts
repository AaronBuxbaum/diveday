import { and, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "./client";
import { bookings, tripAssignments } from "./schema";

/** Called under the shop rewrite lock and the changed trip's row lock. */
export async function invalidateTrainingPlansForCrewChange(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
  personIds: readonly string[],
) {
  if (personIds.length === 0) return;
  const ids = [...new Set(personIds)];
  const cleared = {
    trainingPlanInstructorPersonId: null,
    trainingPlanByPersonId: null,
    trainingPlanAt: null,
  };
  const enrollments = alias(bookings, "plan_crew_enrollments");
  const sessionSeats = tx
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.shopId, shopId), eq(enrollments.tripId, tripId)));
  await tx
    .update(bookings)
    .set(cleared)
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.trainingPlanInstructorPersonId, ids),
        or(
          eq(bookings.tripId, tripId),
          inArray(bookings.trainingEnrollmentBookingId, sessionSeats),
        ),
      ),
    );
  await tx
    .update(tripAssignments)
    .set(cleared)
    .where(
      and(
        eq(tripAssignments.tripId, tripId),
        or(
          inArray(tripAssignments.personId, ids),
          inArray(tripAssignments.trainingPlanInstructorPersonId, ids),
        ),
      ),
    );
}
