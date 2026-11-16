import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { readScoped, type ShopExportScope } from "./export-tables";
import { tripBlowoutDivers, tripBlowouts } from "./schema";

/** Export the staff's audit with original booking references, independently of send coordination. */
export async function readDepartureAuditExportContext(tx: DbExecutor, scope: ShopExportScope) {
  const { shopId } = scope;
  const disruptionRecoveryEventRows = await readScoped(tx, "disruptionRecoveryEvents", scope);
  const sources = await tx
    .select({
      id: tripBlowoutDivers.id,
      bookingId: tripBlowoutDivers.bookingId,
      tripId: tripBlowouts.tripId,
    })
    .from(tripBlowoutDivers)
    .innerJoin(
      tripBlowouts,
      and(eq(tripBlowouts.id, tripBlowoutDivers.blowoutId), eq(tripBlowouts.shopId, shopId)),
    )
    .where(eq(tripBlowoutDivers.shopId, shopId));
  const tripChangeEventRows = await readScoped(tx, "tripChangeEvents", scope);
  const tripStageEventRows = await readScoped(tx, "tripStageEvents", scope);
  return {
    tripChangeEventRows,
    tripStageEventRows,
    disruptionRecoveryEventRows,
    recoverySource: new Map(sources.map((row) => [row.id, row])),
  };
}
