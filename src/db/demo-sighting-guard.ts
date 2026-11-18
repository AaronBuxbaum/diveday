import { eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { isTransactionExecutor } from "./query-helpers";
import { boardingObservations } from "./schema";

export class DemoSightingCleanupBlocked extends Error {
  constructor() {
    super("Demo cleanup blocked by dock sighting: unresolved safety evidence");
    this.name = "DemoSightingCleanupBlocked";
  }
}

/**
 * Under READ COMMITTED, catch sightings committed after the initial delete
 * statement's snapshot and before this query. This is only an additional
 * refusal, not a fence: an uncommitted sighting or one arriving after this
 * query can still race the outer transaction's commit. The caller must let
 * the error escape its transaction so that its earlier writes roll back.
 */
export async function refuseLateDockSightings(tx: DbExecutor, shopId: string) {
  if (!isTransactionExecutor(tx)) throw new Error("Demo sighting guard requires a transaction");
  const [sighting] = await tx
    .select({ id: boardingObservations.id })
    .from(boardingObservations)
    .where(eq(boardingObservations.shopId, shopId))
    .limit(1);
  if (sighting) throw new DemoSightingCleanupBlocked();
}

/** Run inside the cleanup transaction so throwing also restores earlier writes. */
export async function refuseEncounteredDockSightings(tx: DbExecutor, shopId: string) {
  if (!isTransactionExecutor(tx)) throw new Error("Demo sighting guard requires a transaction");
  const deleted = await tx
    .delete(boardingObservations)
    .where(eq(boardingObservations.shopId, shopId))
    .returning({ id: boardingObservations.id });
  // This protects rows encountered by this statement, not a later intake.
  if (deleted.length) throw new DemoSightingCleanupBlocked();
}
