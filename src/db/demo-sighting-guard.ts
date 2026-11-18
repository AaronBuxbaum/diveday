import { eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { isTransactionExecutor } from "./query-helpers";
import { boardingObservations } from "./schema";

export class DemoSightingCleanupBlocked extends Error {
  constructor() {
    super("Demo cleanup blocked by dock sighting");
    this.name = "DemoSightingCleanupBlocked";
  }
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
