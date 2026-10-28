import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import type { AppDb, DbExecutor } from "./client";
import { getTripManifests } from "./manifests";
import { offlineManifestSnapshotRevisions } from "./schema";
import { getShopOfflineErasureEpoch } from "./shops";

export async function nextOfflineManifestSnapshotRevision(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number> {
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
