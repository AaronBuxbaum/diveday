import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, tripConservation, trips } from "./schema";
import { DEMO_RECAP_BOOKING_ID } from "./seed-identifiers";
import { liveTrip } from "./trips-live";

/** One recorded cleanup on the demo recap; no readiness or boarding rows change. */
export async function seedConservation(db: DbExecutor, shopId: string, recorderId: string) {
  const [trip] = await db
    .select({ id: trips.id, endsAt: trips.endsAt })
    .from(trips)
    .innerJoin(bookings, eq(bookings.tripId, trips.id))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(bookings.shopId, shopId),
        eq(bookings.id, DEMO_RECAP_BOOKING_ID),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!trip) return;
  const [existing] = await db
    .select({ id: tripConservation.id })
    .from(tripConservation)
    .where(
      and(
        eq(tripConservation.shopId, shopId),
        eq(tripConservation.tripId, trip.id),
        isNull(tripConservation.deletedAt),
      ),
    )
    .limit(1);
  if (existing) return;
  await db.insert(tripConservation).values({
    shopId,
    tripId: trip.id,
    kind: "litter_kg",
    quantity: 1.8,
    location: "Molasses Reef",
    note: "Discarded fishing gear and plastic collected by the crew.",
    recordedByPersonId: recorderId,
    recordedAt: trip.endsAt,
    updatedAt: trip.endsAt,
  });
}
