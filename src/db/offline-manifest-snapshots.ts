import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { signOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import type { AppDb, DbExecutor } from "./client";
import { getTripManifests } from "./manifests";
import { offlineManifestSnapshotRevisions, trips } from "./schema";
import { getShopOfflineErasureEpoch } from "./shops";
import { liveTrip } from "./trips-live";

export async function nextOfflineManifestSnapshotRevision(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number | null> {
  // Validate and lock the tenant-owned trip before touching its snapshot
  // counter. The composite FK below is the database backstop; this scoped read
  // keeps a foreign shop's identifier from causing even a counter write.
  const [ownedTrip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .for("key share")
    .limit(1);
  if (!ownedTrip) return null;

  const revisions = offlineManifestSnapshotRevisions;
  const [row] = await db
    .insert(revisions)
    .values({ shopId, tripId, revision: 1 })
    .onConflictDoUpdate({
      target: [revisions.shopId, revisions.tripId],
      set: { revision: sql`${revisions.revision} + 1` },
    })
    .returning({ revision: revisions.revision });
  if (!row) throw new Error("offline manifest snapshot revision was not returned");
  return row.revision;
}

/**
 * Issue the identity-bearing part of a saved manifest from one shop-fenced
 * read. The epoch and roster must share the fence: signing a stale roster with
 * a post-erasure epoch would authorize its queued notes after the cutoff.
 */
export async function issueOfflineManifestSnapshot(db: AppDb, shopId: string, tripId: string) {
  return db.transaction(async (tx) => {
    await lockBoardingCertificationEvidence(tx, shopId, "boarding");
    const epoch = await getShopOfflineErasureEpoch(tx, shopId);
    if (epoch === null) return null;
    const snapshotRevision = await nextOfflineManifestSnapshotRevision(tx, shopId, tripId);
    if (snapshotRevision === null) return null;
    const manifests = await getTripManifests(tx as unknown as AppDb, shopId, tripId);
    if (!manifests) return null;
    const snapshotId = randomUUID();
    return {
      manifests,
      snapshotId,
      erasureEpochToken: signOfflineErasureEpoch({
        shopId,
        tripId,
        snapshotId,
        epoch,
        snapshotRevision,
      }),
      snapshotRevision,
    };
  });
}
