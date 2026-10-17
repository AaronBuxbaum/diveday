import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { rollCallCrewEvents, rollCallEvents } from "./schema";

/**
 * **Every roll-call statement recorded on these departures, divers and crew,**
 * in the shape `maxRecordedDiveNumber` (src/lib/manifests.ts) reads: the floor
 * under a departure's planned dives (CR-006), which a single edit
 * (`updateTrip`) and a series apply both hold.
 *
 * Both halves, because the floor read the diver table alone until batch 6: a
 * crew member counted after dive 2 — the divemaster who went back down — was
 * history a lowered plan could orphan. A crew subject is keyed apart from any
 * booking (`crew:` before a person id; booking ids are bare uuids), so the
 * newest-statement-wins rule runs per person, exactly as it does per diver.
 */
export async function recordedRollCallRows(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<
  {
    tripId: string;
    bookingId: string;
    checkpoint: string;
    status: string;
    occurredAt: Date;
    createdAt: Date;
    seq: number;
  }[]
> {
  if (tripIds.length === 0) return [];
  // Shop first in both: each append-only table's only index leads with it.
  const divers = await db
    .select({
      tripId: rollCallEvents.tripId,
      bookingId: rollCallEvents.bookingId,
      checkpoint: rollCallEvents.checkpoint,
      status: rollCallEvents.status,
      occurredAt: rollCallEvents.occurredAt,
      createdAt: rollCallEvents.createdAt,
      seq: rollCallEvents.seq,
    })
    .from(rollCallEvents)
    .where(and(eq(rollCallEvents.shopId, shopId), inArray(rollCallEvents.tripId, [...tripIds])));
  const crew = await db
    .select({
      tripId: rollCallCrewEvents.tripId,
      personId: rollCallCrewEvents.personId,
      checkpoint: rollCallCrewEvents.checkpoint,
      status: rollCallCrewEvents.status,
      occurredAt: rollCallCrewEvents.occurredAt,
      createdAt: rollCallCrewEvents.createdAt,
      seq: rollCallCrewEvents.seq,
    })
    .from(rollCallCrewEvents)
    .where(
      and(eq(rollCallCrewEvents.shopId, shopId), inArray(rollCallCrewEvents.tripId, [...tripIds])),
    );
  return [
    ...divers,
    ...crew.map(({ personId, ...row }) => ({ ...row, bookingId: `crew:${personId}` })),
  ];
}
