import { and, desc, eq } from "drizzle-orm";
import { requireActiveStaffId } from "@/db/authz";
import type { AppDb, DbExecutor } from "@/db/client";
import { rollCallDeckCounts, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips";
import { isRollCallCheckpoint, type RollCallCheckpoint } from "@/lib/roll-call";
import { DECK_COUNT_MAX } from "./rules";

/**
 * **Deck counts** (issue #4248): the heads a captain counted on deck at a
 * roll-call checkpoint. Append-only; the newest row per checkpoint is the
 * count. Informs, never gates: nothing here touches the roll call.
 */

export type RecordDeckCountOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "count_invalid" | "trip_not_found" | "checkpoint_invalid" | "staff_not_found";
    };

/** Record a count. Re-proves the staffer, the departure and its checkpoint against the shop. */
export async function recordDeckCount(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    checkpoint: string;
    counted: number;
    recordedByPersonId: string;
  },
): Promise<RecordDeckCountOutcome> {
  if (!Number.isInteger(input.counted) || input.counted < 0 || input.counted > DECK_COUNT_MAX) {
    return { ok: false, reason: "count_invalid" };
  }
  if (!(await requireActiveStaffId(db, input.shopId, input.recordedByPersonId))) {
    return { ok: false, reason: "staff_not_found" };
  }
  const [trip] = await db
    .select({ plannedDives: trips.plannedDives })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!trip) return { ok: false, reason: "trip_not_found" };
  if (!isRollCallCheckpoint(input.checkpoint, trip.plannedDives)) {
    return { ok: false, reason: "checkpoint_invalid" };
  }
  await db.insert(rollCallDeckCounts).values({
    shopId: input.shopId,
    tripId: input.tripId,
    checkpoint: input.checkpoint,
    counted: input.counted,
    recordedByPersonId: input.recordedByPersonId,
  });
  return { ok: true };
}

/** The newest count at each checkpoint of one departure; a checkpoint nobody counted is absent. */
export async function latestDeckCounts(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<ReadonlyMap<RollCallCheckpoint, number>> {
  const rows = await db
    .select({ checkpoint: rollCallDeckCounts.checkpoint, counted: rollCallDeckCounts.counted })
    .from(rollCallDeckCounts)
    .where(and(eq(rollCallDeckCounts.shopId, shopId), eq(rollCallDeckCounts.tripId, tripId)))
    .orderBy(desc(rollCallDeckCounts.seq));
  const latest = new Map<RollCallCheckpoint, number>();
  for (const row of rows) {
    const checkpoint = row.checkpoint as RollCallCheckpoint;
    if (!latest.has(checkpoint)) latest.set(checkpoint, row.counted);
  }
  return latest;
}
