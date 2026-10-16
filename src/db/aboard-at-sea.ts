import { and, desc, eq, inArray } from "drizzle-orm";
import { hasSailed } from "@/lib/trips";
import type { DbExecutor } from "./client";
import { rollCallEvents, tripStageEvents, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **Who on this departure is marked aboard a boat that has left** (H-122): the
 * seats no roster removal may cancel. A cancelled booking is nobody to every
 * roll-call reader (`./manifests.ts`), so removing one of these would take a
 * person on the water off the count, email them a cancellation and maybe
 * refund them. The way through is a recorded act on the manifest first: mark
 * them ashore (or undo the tap), then remove.
 *
 * One rule for the two places that ask it: `cancelBooking`'s transaction, under
 * the trip and seat locks, and the roster row that draws Remove.
 *
 * - **Marked aboard** is a standing `boarded` result at any checkpoint: the
 *   newest event per booking and checkpoint wins, and a newest `cleared` or
 *   `not_boarded` drops that checkpoint out, the supersession every roll-call
 *   reader applies.
 * - **Has left** is the earliest thing anybody knows: the departure is past
 *   `hasSailed`, or the crew have said a stage beyond "Boarding" (newest stage
 *   wins), or the diver was counted back aboard after a dive, which only
 *   happens at sea. A diver boarded at the dock of a boat still tied up can be
 *   removed: that is the desk tidying a roster, not a body leaving the count.
 *
 * `bookingIds` narrows the read to those seats; omitted, the whole departure.
 * A departure that is not this shop's, or is deleted, has nobody here.
 */
export async function aboardAtSeaBookingIds(
  db: DbExecutor,
  input: { shopId: string; tripId: string; now: Date; bookingIds?: readonly string[] },
): Promise<Set<string>> {
  const { shopId, tripId, now, bookingIds } = input;
  const aboard = new Set<string>();
  if (bookingIds?.length === 0) return aboard;
  const [trip] = await db
    .select({ startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!trip) return aboard;

  const rows = await db
    .select({
      bookingId: rollCallEvents.bookingId,
      checkpoint: rollCallEvents.checkpoint,
      status: rollCallEvents.status,
    })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        eq(rollCallEvents.tripId, tripId),
        bookingIds ? inArray(rollCallEvents.bookingId, [...bookingIds]) : undefined,
      ),
    )
    .orderBy(
      desc(rollCallEvents.occurredAt),
      desc(rollCallEvents.createdAt),
      desc(rollCallEvents.seq),
    );
  const atDock = new Set<string>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.bookingId}\u0000${row.checkpoint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.status !== "boarded") continue;
    if (row.checkpoint === "departure") atDock.add(row.bookingId);
    else aboard.add(row.bookingId);
  }
  if (atDock.size === 0) return aboard;
  if (hasSailed(trip.startsAt, now) || (await crewSaidUnderway(db, shopId, tripId))) {
    for (const bookingId of atDock) aboard.add(bookingId);
  }
  return aboard;
}

/** The newest stage the crew tapped is past "Boarding": the boat has left the dock. */
async function crewSaidUnderway(db: DbExecutor, shopId: string, tripId: string) {
  const [newest] = await db
    .select({ stage: tripStageEvents.stage })
    .from(tripStageEvents)
    .where(and(eq(tripStageEvents.shopId, shopId), eq(tripStageEvents.tripId, tripId)))
    .orderBy(desc(tripStageEvents.recordedAt), desc(tripStageEvents.seq))
    .limit(1);
  return newest !== undefined && newest.stage !== "boarding";
}
