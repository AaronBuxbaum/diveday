import { and, desc, eq } from "drizzle-orm";
import type {
  TripArrivalSnapshot,
  TripChangeSnapshot,
  TripConditionsSnapshot,
} from "@/lib/trip-change-events";
import type { AppDb, DbExecutor } from "./client";
import { tripChangeEvents, trips } from "./schema";
import { liveTrip } from "./trips-live";

export type TripChangeKind = (typeof tripChangeEvents.kind.enumValues)[number];
export type TripChangeSource = (typeof tripChangeEvents.source.enumValues)[number];

export type TripChangeEvent = {
  id: string;
  tripId: string;
  kind: TripChangeKind;
  source: TripChangeSource;
  beforeValue: TripChangeSnapshot | null;
  afterValue: TripChangeSnapshot;
  occurredAt: Date;
  seq: number;
};

export async function recordTripChangeEvent(
  db: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    kind: TripChangeKind;
    source: TripChangeSource;
    beforeValue: TripArrivalSnapshot | TripConditionsSnapshot | null;
    afterValue: TripArrivalSnapshot | TripConditionsSnapshot;
    actorPersonId?: string | null;
    occurredAt?: Date;
  },
): Promise<void> {
  await db.insert(tripChangeEvents).values({
    shopId: input.shopId,
    tripId: input.tripId,
    kind: input.kind,
    source: input.source,
    beforeValue: input.beforeValue,
    afterValue: input.afterValue,
    actorPersonId: input.actorPersonId ?? null,
    occurredAt: input.occurredAt,
  });
}

/** Publicly safe ledger rows, scoped through the owning live trip. */
export async function listTripChangeEvents(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<TripChangeEvent[]> {
  const rows = await db
    .select({ event: tripChangeEvents })
    .from(tripChangeEvents)
    .innerJoin(trips, eq(trips.id, tripChangeEvents.tripId))
    .where(
      and(
        eq(tripChangeEvents.shopId, shopId),
        eq(tripChangeEvents.tripId, tripId),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        liveTrip(),
      ),
    )
    // Keep the bounded read useful after a long-lived departure has had more
    // than twenty edits, then restore oldest-to-newest order for the reader.
    .orderBy(desc(tripChangeEvents.occurredAt), desc(tripChangeEvents.seq))
    .limit(20);
  return rows.reverse().map(({ event }) => ({
    id: event.id,
    tripId: event.tripId,
    kind: event.kind,
    source: event.source,
    beforeValue: event.beforeValue,
    afterValue: event.afterValue,
    occurredAt: event.occurredAt,
    seq: event.seq,
  }));
}
