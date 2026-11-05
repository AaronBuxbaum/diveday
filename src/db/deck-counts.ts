import { and, desc, eq } from "drizzle-orm";
import { isDeckCount } from "@/lib/deck-count";
import { isRollCallCheckpoint } from "@/lib/roll-call";
import { requireActiveStaffId } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { publishManifestEvent } from "./manifest-events";
import { deckCounts, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **The deck count's one writer and its reader** (loop 5, row 1;
 * `src/lib/deck-count.ts`). A count is a thing the captain said: nothing here
 * infers one, edits one or deletes one, and the newest per checkpoint stands.
 * It informs and never gates, so no reader in the app refuses or allows
 * anything on it.
 */

export type RecordDeckCountOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "staff_not_found" | "trip_unavailable" | "invalid_checkpoint" | "invalid_count";
    };

/**
 * Records one deck count. Every refusal is proved, never assumed: a whole
 * number in range, an active staffer of this shop, this shop's live
 * departure, and a checkpoint its plan has (`isRollCallCheckpoint`, the rule
 * the roll call's own writer keeps).
 */
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
  if (!isDeckCount(input.counted)) return { ok: false, reason: "invalid_count" };
  const outcome = await db.transaction(async (tx): Promise<RecordDeckCountOutcome> => {
    const staffId = await requireActiveStaffId(tx, input.shopId, input.recordedByPersonId);
    if (!staffId) return { ok: false, reason: "staff_not_found" };
    const [trip] = await tx
      .select({ plannedDives: trips.plannedDives })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1);
    if (!trip) return { ok: false, reason: "trip_unavailable" };
    if (!isRollCallCheckpoint(input.checkpoint, trip.plannedDives)) {
      return { ok: false, reason: "invalid_checkpoint" };
    }
    await tx.insert(deckCounts).values({
      shopId: input.shopId,
      tripId: input.tripId,
      checkpoint: input.checkpoint,
      counted: input.counted,
      recordedByPersonId: staffId,
    });
    return { ok: true };
  });
  // Another phone on the same roll call hears the count, as it hears a mark.
  // After the commit, and never an error: the count saved, and a failed push
  // must not tell the captain it did not (attacker review N1).
  if (outcome.ok) {
    await publishManifestEvent(db, input.shopId, input.tripId).catch(() => undefined);
  }
  return outcome;
}

export type DeckCountRecord = {
  counted: number;
  recordedAt: Date;
  recordedByName: string;
};

/** The newest deck count per checkpoint on one departure, keyed by checkpoint. */
export async function latestDeckCounts(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<Map<string, DeckCountRecord>> {
  const rows = await db
    .select({
      checkpoint: deckCounts.checkpoint,
      counted: deckCounts.counted,
      recordedAt: deckCounts.recordedAt,
      recordedByName: people.fullName,
    })
    .from(deckCounts)
    .innerJoin(people, eq(people.id, deckCounts.recordedByPersonId))
    .where(and(eq(deckCounts.shopId, shopId), eq(deckCounts.tripId, tripId)))
    .orderBy(desc(deckCounts.recordedAt), desc(deckCounts.seq));
  const latest = new Map<string, DeckCountRecord>();
  // Newest first, so the first row per checkpoint is the one that stands.
  for (const row of rows) {
    if (latest.has(row.checkpoint)) continue;
    latest.set(row.checkpoint, {
      counted: row.counted,
      recordedAt: row.recordedAt,
      recordedByName: row.recordedByName,
    });
  }
  return latest;
}
