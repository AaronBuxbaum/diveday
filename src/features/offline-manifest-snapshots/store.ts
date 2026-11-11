import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { liveTrip } from "@/db/trips";
import { lockBoardingCertificationEvidence } from "../../db/boarding-certification-snapshot";
import type { AppDb, DbExecutor } from "../../db/client";
import { getTripManifests } from "../../db/manifests";
import { offlineManifestSnapshotRevisions, trips } from "../../db/schema/index";
import { getShopOfflineErasureEpoch } from "../../db/shops";
import { signOfflineErasureEpoch } from "../../lib/offline-erasure-epoch";

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
 * **The manifest page's read** (issue #4391): the departure's manifests and
 * the shop's offline erasure epoch they were read at, on the pool, writing
 * nothing. The epoch is read first and every manifest statement starts after
 * it, so the rows already reflect every erasure that epoch counts (an erasure
 * bumps the epoch in the same transaction that sweeps the rows). A later
 * erasure can only make the rows *more* erased than the epoch claims, never
 * less. A device that saves these rows trades the epoch for a signed token
 * through `issueOfflineManifestSnapshot`, which refuses once it has moved.
 */
export async function readOfflineManifestRoster(db: AppDb, shopId: string, tripId: string) {
  const erasureEpoch = await getShopOfflineErasureEpoch(db, shopId);
  if (erasureEpoch === null) return null;
  const manifests = await getTripManifests(db, shopId, tripId);
  if (!manifests) return null;
  return { manifests, erasureEpoch };
}

export type IssuedOfflineManifestSnapshot =
  | { ok: true; snapshotId: string; erasureEpochToken: string; snapshotRevision: number }
  | { ok: false; reason: "not_found" | "erasure_epoch_moved" };

/**
 * Issue the identity-bearing part of a saved manifest: a snapshot id, the next
 * server revision and the signed erasure epoch, for rows a page read at
 * `readAtErasureEpoch` (`readOfflineManifestRoster`). Under the shared shop
 * fence an erasure cannot commit while this runs, and an epoch that moved since
 * the read is refused before any revision is written: signing a pre-erasure
 * roster with a post-erasure epoch would authorize its queued notes after the
 * cutoff. The device re-reads the page and saves that.
 */
export async function issueOfflineManifestSnapshot(
  db: AppDb,
  shopId: string,
  tripId: string,
  readAtErasureEpoch: number,
): Promise<IssuedOfflineManifestSnapshot> {
  return db.transaction(async (tx) => {
    await lockBoardingCertificationEvidence(tx, shopId, "boarding");
    const epoch = await getShopOfflineErasureEpoch(tx, shopId);
    if (epoch === null) return { ok: false, reason: "not_found" } as const;
    if (epoch !== readAtErasureEpoch) return { ok: false, reason: "erasure_epoch_moved" } as const;
    const snapshotRevision = await nextOfflineManifestSnapshotRevision(tx, shopId, tripId);
    if (snapshotRevision === null) return { ok: false, reason: "not_found" } as const;
    const snapshotId = randomUUID();
    return {
      ok: true,
      snapshotId,
      erasureEpochToken: signOfflineErasureEpoch({
        shopId,
        tripId,
        snapshotId,
        epoch,
        snapshotRevision,
      }),
      snapshotRevision,
    } as const;
  });
}
