import { and, eq, gte, isNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { bookings, tripAssignments, trips } from "@/db/schema";
import { seatNotCancelled } from "@/db/trips";
import { HOUR_MS } from "@/lib/clock";

/**
 * **A departure this week the shop no longer has crew for** — the loud state
 * the staffing week exists to put in front of a manager (ADR
 * 20260827-the-shops-shelves, decision 3), on a boat the seed *had* crewed.
 * The same call `seed-front-desk.ts` makes about its `succeeded` payment: a
 * demo permanently short-handed is a worse demo, so this is opt-in.
 *
 * Tomorrow's departure rather than today's: today's boat is the one Today, the
 * close-out and the check-in counter all read, and pulling its crew would move
 * captures that have nothing to do with this one. Tomorrow's still lands in a
 * column of the same week the staffing grid draws.
 *
 * **With divers on it**, or the capture photographs nothing: an empty boat has
 * nobody to supervise and raises no gap anywhere (`divemasterRatioGap`,
 * src/lib/divemaster-ratio.ts) — the same reason the staffing week is silent
 * about a departure that has not sold a seat yet.
 */
export async function unstaffTomorrowsDeparture(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<void> {
  const tomorrow = new Date(now.getTime() + 24 * HOUR_MS);
  const [departure] = await db
    .select({ id: trips.id })
    .from(trips)
    .innerJoin(bookings, and(eq(bookings.tripId, trips.id), seatNotCancelled))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        isNull(trips.deletedAt),
        gte(trips.startsAt, tomorrow),
      ),
    )
    .groupBy(trips.id)
    .orderBy(trips.startsAt)
    .limit(1);
  if (!departure) return;
  // Straight off the assignment rows: `setTripCrew` refuses to leave a course
  // session with nobody on the ratio, and the state being photographed is
  // precisely a boat with nobody on it.
  await db.delete(tripAssignments).where(eq(tripAssignments.tripId, departure.id));
}
