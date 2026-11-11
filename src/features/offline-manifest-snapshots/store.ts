import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { queryAll } from "@/db/query-helpers";
import { liveTrip } from "@/db/trips";
import { lockBoardingCertificationEvidence } from "../../db/boarding-certification-snapshot";
import type { AppDb, DbExecutor } from "../../db/client";
import { getTripManifests } from "../../db/manifests";
import { offlineManifestSnapshotRevisions, trips } from "../../db/schema/index";
import { getShopOfflineErasureEpoch } from "../../db/shops";
import { signOfflineErasureEpoch } from "../../lib/offline-erasure-epoch";

/**
 * Validate and lock the tenant-owned trip before touching its snapshot
 * counter. The composite FK on the counter is the database backstop; this
 * scoped read keeps a foreign shop's identifier from causing even a write.
 */
async function lockOwnedTrip(db: DbExecutor, shopId: string, tripId: string): Promise<boolean> {
  const [ownedTrip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .for("key share")
    .limit(1);
  return ownedTrip !== undefined;
}

/**
 * The next revision, unconditionally: for a saver that reads its rows *after*
 * taking it, inside the same fenced transaction (the background board,
 * `/api/offline-manifests/upcoming`). The counter row stays locked until that
 * transaction commits, so a later revision always belongs to a later read.
 */
export async function nextOfflineManifestSnapshotRevision(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number | null> {
  if (!(await lockOwnedTrip(db, shopId, tripId))) return null;
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

/** The trip's latest issued revision, 0 before any; a plain read that writes nothing. */
async function currentOfflineManifestSnapshotRevision(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number> {
  const revisions = offlineManifestSnapshotRevisions;
  const [row] = await db
    .select({ revision: revisions.revision })
    .from(revisions)
    .where(and(eq(revisions.shopId, shopId), eq(revisions.tripId, tripId)))
    .limit(1);
  return row?.revision ?? 0;
}

/**
 * The next revision, **only if none was issued since `readRevision`**: one
 * atomic compare-and-increment, so of two claims from the same read exactly one
 * wins (the loser's UPDATE re-checks the row after the winner commits and
 * matches nothing; the loser's first-ever INSERT meets the winner's row and
 * does nothing). Null when the counter has moved on.
 */
async function claimOfflineManifestSnapshotRevision(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  readRevision: number,
): Promise<number | null> {
  const revisions = offlineManifestSnapshotRevisions;
  const [row] =
    readRevision === 0
      ? await db
          .insert(revisions)
          .values({ shopId, tripId, revision: 1 })
          .onConflictDoNothing({ target: [revisions.shopId, revisions.tripId] })
          .returning({ revision: revisions.revision })
      : await db
          .update(revisions)
          .set({ revision: sql`${revisions.revision} + 1` })
          .where(
            and(
              eq(revisions.shopId, shopId),
              eq(revisions.tripId, tripId),
              eq(revisions.revision, readRevision),
            ),
          )
          .returning({ revision: revisions.revision });
  return row?.revision ?? null;
}

/**
 * **The manifest page's read** (issue #4391): the departure's manifests, the
 * shop's offline erasure epoch and the trip's snapshot revision they were read
 * at, on the pool, writing nothing. The epoch and revision are read first and
 * every manifest statement starts after them:
 *
 * - An erasure bumps the epoch in the same transaction that sweeps the rows,
 *   so the rows reflect every erasure the epoch counts; a later one can only
 *   make them *more* erased than it claims, never less.
 * - A copy issued at or below the revision committed before it was read, after
 *   its own rows were read, so these rows are newer than every such copy.
 *
 * A device that saves these rows claims a snapshot for exactly that read
 * (`issueOfflineManifestSnapshot`), refused once either has moved.
 */
export async function readOfflineManifestRoster(db: AppDb, shopId: string, tripId: string) {
  const [erasureEpoch, snapshotRevision] = await queryAll(db, [
    () => getShopOfflineErasureEpoch(db, shopId),
    () => currentOfflineManifestSnapshotRevision(db, shopId, tripId),
  ]);
  if (erasureEpoch === null) return null;
  const manifests = await getTripManifests(db, shopId, tripId);
  if (!manifests) return null;
  return { manifests, erasureEpoch, snapshotRevision };
}

/** What a page read was taken at: `readOfflineManifestRoster`'s epoch and revision. */
export type OfflineManifestReadAt = { erasureEpoch: number; snapshotRevision: number };

export type IssuedOfflineManifestSnapshot =
  | { ok: true; snapshotId: string; erasureEpochToken: string; snapshotRevision: number }
  | { ok: false; reason: "not_found" | "erasure_epoch_moved" | "snapshot_superseded" };

/**
 * Issue the identity-bearing part of a saved manifest: a snapshot id, the next
 * server revision and the signed erasure epoch, for rows a page read at
 * `readAt` (`readOfflineManifestRoster`). Under the shared shop fence an
 * erasure cannot commit while this runs. Refused before any write when:
 *
 * - `erasure_epoch_moved`: an erasure landed since the read. Signing a
 *   pre-erasure roster with a post-erasure epoch would authorize its queued
 *   notes after the cutoff.
 * - `snapshot_superseded`: another snapshot was issued since the read. Its rows
 *   are newer than these, and a higher revision on these would let them replace
 *   it on the device ("newer server history wins").
 *
 * Either way the device re-reads the page and saves that.
 */
export async function issueOfflineManifestSnapshot(
  db: AppDb,
  shopId: string,
  tripId: string,
  readAt: OfflineManifestReadAt,
): Promise<IssuedOfflineManifestSnapshot> {
  return db.transaction(async (tx) => {
    await lockBoardingCertificationEvidence(tx, shopId, "boarding");
    const epoch = await getShopOfflineErasureEpoch(tx, shopId);
    if (epoch === null) return { ok: false, reason: "not_found" } as const;
    if (epoch !== readAt.erasureEpoch) return { ok: false, reason: "erasure_epoch_moved" } as const;
    if (!(await lockOwnedTrip(tx, shopId, tripId)))
      return { ok: false, reason: "not_found" } as const;
    const snapshotRevision = await claimOfflineManifestSnapshotRevision(
      tx,
      shopId,
      tripId,
      readAt.snapshotRevision,
    );
    if (snapshotRevision === null) return { ok: false, reason: "snapshot_superseded" } as const;
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
