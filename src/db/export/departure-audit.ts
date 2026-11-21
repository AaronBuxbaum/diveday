import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../client";
import { tripBlowoutDivers, tripBlowouts } from "../schema";
import { readScoped, type ShopExportScope } from "./tables";

/** Export the staff's audit with original booking references, independently of send coordination. */
export async function readDepartureAuditExportContext(tx: DbExecutor, scope: ShopExportScope) {
  const { shopId } = scope;
  const recoveryActivityRows = await readScoped(tx, "recoveryActivities", scope);
  const recoveryActivityOfferRows = await readScoped(tx, "recoveryActivityOffers", scope);
  const recoveryActivityParticipantRows = await readScoped(
    tx,
    "recoveryActivityParticipants",
    scope,
  );
  const recoveryActivityEventRows = await readScoped(tx, "recoveryActivityEvents", scope);
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
    recoveryActivityRows,
    recoveryActivityOfferRows,
    recoveryActivityParticipantRows,
    recoveryActivityEventRows,
    tripChangeEventRows,
    tripStageEventRows,
    disruptionRecoveryEventRows,
    recoverySource: new Map(sources.map((row) => [row.id, row])),
  };
}
