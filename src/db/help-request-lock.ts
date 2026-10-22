import { and, eq } from "drizzle-orm";
import type { AppTransaction } from "./client";
import { tripHelpRequests, trips } from "./schema";
import { liveTrip } from "./trips-live";

/** All writers take departure -> request -> crew locks; FK desk events need the departure too. */
export async function lockHelpRequestDeparture(
  tx: AppTransaction,
  shopId: string,
  requestId: string,
): Promise<boolean> {
  const [trip] = await tx
    .select({ id: trips.id })
    .from(trips)
    .innerJoin(tripHelpRequests, eq(tripHelpRequests.tripId, trips.id))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(tripHelpRequests.shopId, shopId),
        eq(tripHelpRequests.id, requestId),
        liveTrip(),
      ),
    )
    .limit(1)
    .for("update", { of: trips });
  return Boolean(trip);
}
