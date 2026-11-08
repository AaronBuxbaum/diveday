import { and, eq } from "drizzle-orm";
import { liveTrip } from "@/db/trips";
import type { AppTransaction } from "../../db/client";
import { tripHelpRequests, trips } from "../../db/schema/index";

/** All writers take departure -> request -> crew locks; FK desk lines need the departure too. */
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
