import { sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { boundLockWaits } from "./lock-bounds";

/**
 * Serialize a queued reschedule's final revision check and provider call with
 * edits that advance the trip's published revision. Call before taking trip,
 * person, or booking row locks. Multi-trip writers acquire ids in sorted order.
 */
export async function lockTripRevisionNotificationFence(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
  mode: "dispatch" | "revision-write",
): Promise<void> {
  await boundLockWaits(tx);
  const key = `${shopId}:${tripId}`;
  if (mode === "dispatch") {
    await tx.execute(
      sql`select pg_advisory_xact_lock_shared(hashtext('trip_revision_notification'), hashtext(${key}))`,
    );
  } else {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('trip_revision_notification'), hashtext(${key}))`,
    );
  }
}

export async function lockTripRevisionNotificationFences(
  tx: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<void> {
  for (const tripId of [...new Set(tripIds)].sort()) {
    await lockTripRevisionNotificationFence(tx, shopId, tripId, "revision-write");
  }
}
