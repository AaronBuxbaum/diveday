import { and, eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { bookingArrivalEvents, preDepartureCheckEvents, rollCallEvents } from "@/db/schema";

/** Read only committed evidence, including the original instant on an idempotent retry. */
export async function offlineSyncInstants(db: AppDb, shopId: string, clientEventIds: string[]) {
  if (clientEventIds.length === 0) return new Map<string, string>();
  const groups = await Promise.all([
    db
      .select({
        clientEventId: rollCallEvents.clientEventId,
        occurredAt: rollCallEvents.occurredAt,
      })
      // diveday:roll-call-both-subjects: sync answers for both diver and crew event ids.
      .from(rollCallEvents)
      .where(
        and(
          eq(rollCallEvents.shopId, shopId),
          inArray(rollCallEvents.clientEventId, clientEventIds),
        ),
      ),
    db
      .select({
        clientEventId: preDepartureCheckEvents.clientEventId,
        occurredAt: preDepartureCheckEvents.occurredAt,
      })
      .from(preDepartureCheckEvents)
      .where(
        and(
          eq(preDepartureCheckEvents.shopId, shopId),
          inArray(preDepartureCheckEvents.clientEventId, clientEventIds),
        ),
      ),
    db
      .select({
        clientEventId: bookingArrivalEvents.clientEventId,
        occurredAt: bookingArrivalEvents.occurredAt,
      })
      .from(bookingArrivalEvents)
      .where(
        and(
          eq(bookingArrivalEvents.shopId, shopId),
          inArray(bookingArrivalEvents.clientEventId, clientEventIds),
        ),
      ),
  ]);
  return new Map(
    groups.flatMap((rows) =>
      rows.flatMap((row) =>
        row.clientEventId ? [[row.clientEventId, row.occurredAt.toISOString()] as const] : [],
      ),
    ),
  );
}
