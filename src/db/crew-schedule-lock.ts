import { sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { boundLockWaits } from "./lock-bounds";

/**
 * **The crew schedule's own lock**, per shop (issue #4474).
 *
 * Crew writers (`setTripCrew`, `changeTripCrewOutcome`, `moveTripCrewMember`,
 * `seatStandingCrew`) take it exclusively; a training-plan write takes it
 * shared (`setTrainingPlanAssignment`). That is what serializes them: two crew
 * writers adding one person to two overlapping departures each read the
 * other's committed assignment and the second refuses (`crew_clash`), and a
 * crew change never interleaves with a plan naming the crew it changes.
 *
 * It replaced the exclusive mode of the boarding-evidence lock on crew writes.
 * Every boarding capture in the shop takes that lock shared, so a crew edit on
 * one boat made roll-call taps on every other boat wait for it, and a tap could
 * time out with nothing recorded. Boarding captures never take this lock, so no
 * schedule write delays them. Crew writers still take the evidence lock shared,
 * which keeps them out of an erasure or a merge.
 *
 * Order: the evidence lock, then this, then departure rows.
 */
export async function lockCrewSchedule(
  tx: DbExecutor,
  shopId: string,
  mode: "crew" | "plan",
): Promise<void> {
  await boundLockWaits(tx);
  await tx.execute(
    mode === "crew"
      ? sql`select pg_advisory_xact_lock(hashtext('crew_schedule'), hashtext(${shopId}))`
      : sql`select pg_advisory_xact_lock_shared(hashtext('crew_schedule'), hashtext(${shopId}))`,
  );
}
