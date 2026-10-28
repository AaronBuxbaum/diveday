import { randomUUID } from "node:crypto";
import { signOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import type { AppDb } from "./client";
import { getTripManifests } from "./manifests";
import { getShopOfflineErasureEpoch } from "./shops";

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
    const manifests = await getTripManifests(tx as unknown as AppDb, shopId, tripId);
    if (!manifests) return null;
    const snapshotId = randomUUID();
    return {
      manifests,
      snapshotId,
      erasureEpochToken: signOfflineErasureEpoch({ shopId, tripId, snapshotId, epoch }),
    };
  });
}
