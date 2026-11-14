import { and, asc, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { AppDb, AppTransaction } from "@/db/client";
import { boundLockWaits } from "@/db/lock-bounds";
import { publishManifestEvent } from "@/db/manifest-events";
import {
  trips,
  unresolvedSafetyAlertDeliveries,
  unresolvedSafetyAlertEscalations,
  unresolvedSafetyAlertOutbox,
  unresolvedSafetyAlertScan,
  unresolvedSafetyScanIncidents,
} from "@/db/schema";
import { liveTrip } from "@/db/trips";
import { nextOfflineManifestSnapshotRevision } from "@/features/offline-manifest-snapshots";
import { dispatchUnresolvedSafetyReview, type SafetyReviewProvider } from "./delivery-worker";
import { unresolvedReviewAvailable } from "./review-availability";

const SCAN_NAME = "unresolved-safety";
const MAX_BATCH = 50;
class ScanLeaseExpired extends Error {}

async function boundScanTransaction(tx: AppTransaction) {
  await boundLockWaits(tx);
  await tx.execute(sql`set local statement_timeout = '10s'`);
}

/** Claims a bounded scan cycle. Sequence allocation is not commit order: each
 * completed cycle starts again at zero, so a late commit is revisited. */
async function takeLease(db: AppDb, leaseId: string) {
  return db.transaction(async (tx) => {
    await boundScanTransaction(tx);
    await tx.insert(unresolvedSafetyAlertScan).values({ name: SCAN_NAME }).onConflictDoNothing();
    const [lease] = await tx
      .update(unresolvedSafetyAlertScan)
      .set({
        leaseId,
        leaseUntil: sql`clock_timestamp() + interval '5 minutes'`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(unresolvedSafetyAlertScan.name, SCAN_NAME),
          or(
            isNull(unresolvedSafetyAlertScan.leaseId),
            lt(unresolvedSafetyAlertScan.leaseUntil, sql`clock_timestamp()`),
          ),
        ),
      )
      .returning({
        cursor: unresolvedSafetyAlertScan.cursor,
        highWater: unresolvedSafetyAlertScan.highWater,
      });
    if (!lease) return null;
    if (lease.highWater !== null) return { ...lease, highWater: lease.highWater };
    const [head] = await tx
      .select({
        value: sql<number>`coalesce(max(${unresolvedSafetyAlertOutbox.scanSequence}), 0)`.mapWith(
          Number,
        ),
      })
      .from(unresolvedSafetyAlertOutbox);
    const highWater = head?.value ?? 0;
    const [setHighWater] = await tx
      .update(unresolvedSafetyAlertScan)
      .set({ highWater })
      .where(
        and(
          eq(unresolvedSafetyAlertScan.name, SCAN_NAME),
          eq(unresolvedSafetyAlertScan.leaseId, leaseId),
          gt(unresolvedSafetyAlertScan.leaseUntil, sql`clock_timestamp()`),
        ),
      )
      .returning({ name: unresolvedSafetyAlertScan.name });
    if (!setHighWater) throw new ScanLeaseExpired();
    return { ...lease, highWater };
  });
}

/** The token and database clock fence all scan-owned writes. */
async function lockLease(tx: AppTransaction, leaseId: string) {
  const [row] = await tx
    .select({ name: unresolvedSafetyAlertScan.name })
    .from(unresolvedSafetyAlertScan)
    .where(
      and(
        eq(unresolvedSafetyAlertScan.name, SCAN_NAME),
        eq(unresolvedSafetyAlertScan.leaseId, leaseId),
        gt(unresolvedSafetyAlertScan.leaseUntil, sql`clock_timestamp()`),
      ),
    )
    .for("update");
  return Boolean(row);
}

async function renewAndMarkInterrupted(db: AppDb, leaseId: string, outboxId: string) {
  try {
    return await db.transaction(async (tx) => {
      await boundScanTransaction(tx);
      if (!(await lockLease(tx, leaseId))) return false;
      await tx
        .update(unresolvedSafetyAlertDeliveries)
        .set({ status: "uncertain" })
        .where(
          and(
            eq(unresolvedSafetyAlertDeliveries.outboxId, outboxId),
            eq(unresolvedSafetyAlertDeliveries.status, "sending"),
            lt(
              unresolvedSafetyAlertDeliveries.attemptedAt,
              sql`clock_timestamp() - interval '10 minutes'`,
            ),
          ),
        );
      const [renewed] = await tx
        .update(unresolvedSafetyAlertScan)
        .set({
          leaseUntil: sql`clock_timestamp() + interval '5 minutes'`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(unresolvedSafetyAlertScan.name, SCAN_NAME),
            eq(unresolvedSafetyAlertScan.leaseId, leaseId),
            gt(unresolvedSafetyAlertScan.leaseUntil, sql`clock_timestamp()`),
          ),
        )
        .returning({ name: unresolvedSafetyAlertScan.name });
      if (!renewed) throw new ScanLeaseExpired();
      return true;
    });
  } catch (error) {
    if (error instanceof ScanLeaseExpired) return false;
    throw error;
  }
}

type EscalationKind = "no_recipients" | "uncertain" | "pending" | "dispatch_error";
async function advance(
  db: AppDb,
  leaseId: string,
  item: {
    id: string;
    generationId: string;
    scanSequence: number;
    shopId: string;
    tripId: string;
    claimId: string;
  },
  kinds: EscalationKind[],
) {
  try {
    return await db.transaction(async (tx) => {
      await boundScanTransaction(tx);
      if (!(await lockLease(tx, leaseId))) return false;
      // Worker takes the trip before delivery rows. Match that order so an
      // alert cannot deadlock a sender while moving the snapshot frontier.
      const [trip] = await tx
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, item.tripId), eq(trips.shopId, item.shopId), liveTrip()))
        .for("update");
      const [current] = await tx
        .select({ id: unresolvedSafetyAlertOutbox.id })
        .from(unresolvedSafetyAlertOutbox)
        .where(
          and(
            eq(unresolvedSafetyAlertOutbox.id, item.id),
            eq(unresolvedSafetyAlertOutbox.generationId, item.generationId),
            eq(unresolvedSafetyAlertOutbox.scanSequence, item.scanSequence),
            eq(unresolvedSafetyAlertOutbox.shopId, item.shopId),
            eq(unresolvedSafetyAlertOutbox.tripId, item.tripId),
            eq(unresolvedSafetyAlertOutbox.claimId, item.claimId),
          ),
        )
        .for("share");
      if (!current) {
        const [newIncident] = await tx
          .insert(unresolvedSafetyScanIncidents)
          .values({
            outboxId: item.id,
            generationId: item.generationId,
            scanSequence: item.scanSequence,
            shopId: item.shopId,
            tripId: item.tripId,
            claimId: item.claimId,
          })
          .onConflictDoNothing({
            target: [
              unresolvedSafetyScanIncidents.outboxId,
              unresolvedSafetyScanIncidents.generationId,
              unresolvedSafetyScanIncidents.scanSequence,
            ],
          })
          .returning({ id: unresolvedSafetyScanIncidents.id });
        if (!newIncident)
          await tx
            .update(unresolvedSafetyScanIncidents)
            .set({ lastSeenAt: sql`clock_timestamp()` })
            .where(
              and(
                eq(unresolvedSafetyScanIncidents.outboxId, item.id),
                eq(unresolvedSafetyScanIncidents.generationId, item.generationId),
                eq(unresolvedSafetyScanIncidents.scanSequence, item.scanSequence),
              ),
            );
        if (
          newIncident &&
          trip &&
          (await nextOfflineManifestSnapshotRevision(tx, item.shopId, item.tripId)) === null
        )
          throw new Error("Safety alert trip disappeared");
        const [advanced] = await tx
          .update(unresolvedSafetyAlertScan)
          .set({
            cursor: item.scanSequence,
            lastProblem: "generation_missing",
            lastProblemSequence: item.scanSequence,
            lastProblemAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(unresolvedSafetyAlertScan.name, SCAN_NAME),
              eq(unresolvedSafetyAlertScan.leaseId, leaseId),
              gt(unresolvedSafetyAlertScan.leaseUntil, sql`clock_timestamp()`),
            ),
          )
          .returning({ name: unresolvedSafetyAlertScan.name });
        if (!advanced) throw new ScanLeaseExpired();
        return { changed: Boolean(newIncident && trip) };
      }
      // The worker summary is a point-in-time observation. Re-read currently
      // persisted states before advancing; never clear an older escalation here.
      const deliveryRows = await tx
        .select({ status: unresolvedSafetyAlertDeliveries.status })
        .from(unresolvedSafetyAlertDeliveries)
        .where(eq(unresolvedSafetyAlertDeliveries.outboxId, item.id))
        .for("share");
      if (deliveryRows.some((row) => row.status === "uncertain" || row.status === "sending"))
        kinds.push("uncertain");
      if (deliveryRows.some((row) => row.status === "pending")) kinds.push("pending");
      let changed = false;
      for (const kind of new Set(kinds)) {
        const [created] = await tx
          .insert(unresolvedSafetyAlertEscalations)
          .values({ outboxId: item.id, kind })
          .onConflictDoNothing({
            target: [
              unresolvedSafetyAlertEscalations.outboxId,
              unresolvedSafetyAlertEscalations.kind,
            ],
          })
          .returning({ id: unresolvedSafetyAlertEscalations.id });
        if (created) changed = true;
        else
          await tx
            .update(unresolvedSafetyAlertEscalations)
            .set({ lastSeenAt: sql`clock_timestamp()` })
            .where(
              and(
                eq(unresolvedSafetyAlertEscalations.outboxId, item.id),
                eq(unresolvedSafetyAlertEscalations.kind, kind),
              ),
            );
      }
      if (
        changed &&
        trip &&
        (await nextOfflineManifestSnapshotRevision(tx, item.shopId, item.tripId)) === null
      )
        throw new Error("Safety alert trip disappeared");
      const [updated] = await tx
        .update(unresolvedSafetyAlertScan)
        .set({ cursor: item.scanSequence, updatedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(unresolvedSafetyAlertScan.name, SCAN_NAME),
            eq(unresolvedSafetyAlertScan.leaseId, leaseId),
            gt(unresolvedSafetyAlertScan.leaseUntil, sql`clock_timestamp()`),
          ),
        )
        .returning({ name: unresolvedSafetyAlertScan.name });
      if (!updated) throw new ScanLeaseExpired();
      return { changed: changed && trip !== undefined };
    });
  } catch (error) {
    if (error instanceof ScanLeaseExpired) return false;
    throw error;
  }
}

/** One bounded pass; cycle completion never means all recipients were told.
 * No scheduler or production transport is wired while the feature is disabled. */
export async function scanUnresolvedSafetyAlerts(
  db: AppDb,
  provider?: SafetyReviewProvider,
  requestedLimit = MAX_BATCH,
) {
  if (!unresolvedReviewAvailable() || !provider?.safetySingleAttemptAbortable)
    return { status: "unavailable" as const };
  const limit = Number.isInteger(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, MAX_BATCH))
    : MAX_BATCH;
  const leaseId = crypto.randomUUID();
  const lease = await takeLease(db, leaseId);
  if (!lease) return { status: "busy" as const };
  let scanned = 0;
  try {
    const items = await db
      .select({
        id: unresolvedSafetyAlertOutbox.id,
        generationId: unresolvedSafetyAlertOutbox.generationId,
        scanSequence: unresolvedSafetyAlertOutbox.scanSequence,
        shopId: unresolvedSafetyAlertOutbox.shopId,
        tripId: unresolvedSafetyAlertOutbox.tripId,
        claimId: unresolvedSafetyAlertOutbox.claimId,
      })
      .from(unresolvedSafetyAlertOutbox)
      .where(
        and(
          gt(unresolvedSafetyAlertOutbox.scanSequence, lease.cursor),
          lte(unresolvedSafetyAlertOutbox.scanSequence, lease.highWater),
        ),
      )
      .orderBy(asc(unresolvedSafetyAlertOutbox.scanSequence))
      .limit(limit);
    for (const item of items) {
      if (!(await renewAndMarkInterrupted(db, leaseId, item.id)))
        return { status: "lost_lease" as const, scanned };
      const kinds: EscalationKind[] = [];
      try {
        const outcome = await dispatchUnresolvedSafetyReview(db, item.id, provider);
        if (outcome.status === "unavailable") kinds.push("dispatch_error");
        if (outcome.status === "no_recipients") kinds.push("no_recipients");
        if (outcome.status === "not_found") kinds.push("dispatch_error");
        if ("ledger" in outcome && outcome.ledger) {
          if ((outcome.ledger.uncertain ?? 0) > 0 || (outcome.ledger.sending ?? 0) > 0)
            kinds.push("uncertain");
          if ((outcome.ledger.pending ?? 0) > 0) kinds.push("pending");
        }
      } catch {
        kinds.push("dispatch_error");
      }
      const advanced = await advance(db, leaseId, item, kinds);
      if (!advanced) return { status: "lost_lease" as const, scanned };
      if (advanced.changed) await publishManifestEvent(db, item.shopId, item.tripId);
      scanned += 1;
    }
    const cycleFinished = items.length < limit;
    if (cycleFinished) {
      const reset = await db.transaction(async (tx) => {
        await boundScanTransaction(tx);
        if (!(await lockLease(tx, leaseId))) return false;
        const [resetRow] = await tx
          .update(unresolvedSafetyAlertScan)
          .set({ cursor: 0, highWater: null, updatedAt: sql`clock_timestamp()` })
          .where(
            and(
              eq(unresolvedSafetyAlertScan.name, SCAN_NAME),
              eq(unresolvedSafetyAlertScan.leaseId, leaseId),
              gt(unresolvedSafetyAlertScan.leaseUntil, sql`clock_timestamp()`),
            ),
          )
          .returning({ name: unresolvedSafetyAlertScan.name });
        return Boolean(resetRow);
      });
      if (!reset) return { status: "lost_lease" as const, scanned };
    }
    return { status: "scanned" as const, scanned, cycleFinished };
  } finally {
    await db
      .update(unresolvedSafetyAlertScan)
      .set({ leaseId: null, leaseUntil: null, updatedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(unresolvedSafetyAlertScan.name, SCAN_NAME),
          eq(unresolvedSafetyAlertScan.leaseId, leaseId),
        ),
      );
  }
}
