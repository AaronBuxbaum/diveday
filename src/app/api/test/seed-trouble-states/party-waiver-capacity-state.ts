import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { trips } from "@/db/schema";
import { heldSeatCounts } from "@/db/trips";
import { liveTrip } from "@/db/trips-live";

/** Keep every two-person party-waiver visual capture inside the walk-in capacity. */
export async function makeRoomForPartyWaiverCaptures(
  db: AppDb,
  shopId: string,
): Promise<{ tripId: string; capacity: number } | null> {
  const [trip] = await db
    .select({ id: trips.id, capacity: trips.capacity })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.title, "Morning Two-Tank — Molasses Reef"),
        eq(trips.status, "scheduled"),
        liveTrip(),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!trip) return null;

  // Leave room for all four two-person captures after the roster already aboard.
  const held = await heldSeatCounts(db, shopId, trip.id);
  const capacity = Math.max(trip.capacity, held.aboard + 12);
  if (capacity !== trip.capacity) {
    await db.update(trips).set({ capacity }).where(eq(trips.id, trip.id));
  }
  return { tripId: trip.id, capacity };
}
