import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { DAY_MS, nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { tripConservation, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/** One recorded cleanup on a returned reef departure; no readiness or boarding rows change. */
export async function seedConservation(db: DbExecutor, shopId: string, recorderId: string) {
  const [trip] = await db
    .select({ id: trips.id, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.title, "Two-Tank Reef — Molasses & French"),
        eq(trips.status, "scheduled"),
        lt(trips.endsAt, new Date(nowDate().getTime() - DAY_MS)),
        notRehearsal(),
        liveTrip(),
      ),
    )
    // diveday:allow-time-id-order: seed selects one matching history departure; no ordered list is shown.
    .orderBy(desc(trips.endsAt), desc(trips.id))
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
