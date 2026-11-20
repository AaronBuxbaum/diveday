import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { queryAll } from "@/db/query-helpers";
import { liveTrip } from "@/db/trips";
import { lockBoardingCertificationEvidence } from "../../db/boarding-certification-snapshot";
import type { AppDb, DbExecutor } from "../../db/client";
import { getTripManifests } from "../../db/manifests";
import {
  bookings,
  offlineManifestSnapshotRevisions,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "../../db/schema/index";
import { getShopOfflineErasureEpoch } from "../../db/shops";
import { signOfflineErasureEpoch } from "../../lib/offline-erasure-epoch";
import {
  offlineRollCallWitnessEnabled,
  signRollCallWitness,
} from "../../lib/offline-roll-call-witness";

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
    .for("share")
    .limit(1);
  return ownedTrip !== undefined;
}

export async function offlineManifestTripExists(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<boolean> {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  return trip !== undefined;
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
  return (await nextOfflineManifestSnapshotWithWindows(db, shopId, tripId))?.revision ?? null;
}

/** Issue a revision and read its meeting windows after the owned-trip lock. */
export async function nextOfflineManifestSnapshotWithWindows(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<{
  revision: number;
  meetingGeneration: number;
  meetingWindows: { startsAt: string; endsAt: string }[];
} | null> {
  if (!(await lockOwnedTrip(db, shopId, tripId))) return null;
  const revisions = offlineManifestSnapshotRevisions;
  // Keep the window read in this later statement: under READ COMMITTED a
  // statement that waits for the trip lock keeps its earlier statement snapshot.
  const [row] = await db
    .insert(revisions)
    .values({ shopId, tripId, revision: 1 })
    .onConflictDoUpdate({
      target: [revisions.shopId, revisions.tripId],
      set: { revision: sql`${revisions.revision} + 1` },
    })
    .returning({
      revision: revisions.revision,
      meetingGeneration: sql<number>`(select ${trips.offlineMeetingGeneration} from ${trips} where ${trips.id} = ${tripId})`,
      meetingWindows: sql<{ startsAt: string; endsAt: string }[]>`coalesce((
        select json_agg(json_build_object('startsAt', d.starts_at, 'endsAt', d.ends_at) order by d.starts_at)
        from ${tripScheduleDays} d where d.trip_id = ${tripId}
      ), '[]'::json)`,
    });
  if (!row) throw new Error("offline manifest snapshot revision was not returned");
  return row;
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
 * **Each departure's latest issued revision, for the sync route's answer**
 * (0 before any). A device keeps it on every tap that answer settles, and
 * reads a tap as already in its saved copy once the copy's own revision is two
 * or more past it (`offlineEventInCopy`, `src/lib/offline-manifests.ts`).
 *
 * Why two: this is read after the tap committed. A copy one revision on may
 * have read its rows before that (the page reads its revision, then its rows,
 * and claims the next one later; the background board's increment may be
 * uncommitted as this reads). A copy two on took or read its revision after
 * this read, and every copy reads its rows after that, so it saw the tap.
 */
export async function latestOfflineManifestSnapshotRevisions(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Record<string, number>> {
  const latest: Record<string, number> = Object.fromEntries(tripIds.map((id) => [id, 0]));
  if (tripIds.length === 0) return latest;
  const revisions = offlineManifestSnapshotRevisions;
  const rows = await db
    .select({ tripId: revisions.tripId, revision: revisions.revision })
    .from(revisions)
    .where(and(eq(revisions.shopId, shopId), inArray(revisions.tripId, [...tripIds])));
  for (const row of rows) latest[row.tripId] = row.revision;
  return latest;
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

/** Read the roster and its schedule from one read-only database snapshot. */
export async function readOfflineManifestRosterWithWindows(
  db: AppDb,
  shopId: string,
  tripId: string,
  options?: { afterScheduleRead?: () => Promise<void> },
) {
  const erasureEpoch = await getShopOfflineErasureEpoch(db, shopId);
  if (erasureEpoch === null) return null;
  return db.transaction(
    async (tx) => {
      const revisions = offlineManifestSnapshotRevisions;
      const [state] = await tx
        .select({
          revision: revisions.revision,
          meetingGeneration: trips.offlineMeetingGeneration,
          windows: sql<{ startsAt: string; endsAt: string }[]>`coalesce((
        select json_agg(json_build_object('startsAt', d.starts_at, 'endsAt', d.ends_at) order by d.starts_at)
        from ${tripScheduleDays} d where d.trip_id = ${tripId}
      ), '[]'::json)`,
        })
        .from(trips)
        .leftJoin(
          revisions,
          and(eq(revisions.tripId, trips.id), eq(revisions.shopId, trips.shopId)),
        )
        .where(and(eq(trips.shopId, shopId), eq(trips.id, tripId), liveTrip()))
        .limit(1);
      if (!state) return null;
      await options?.afterScheduleRead?.();
      const manifests = await getTripManifests(tx as unknown as AppDb, shopId, tripId);
      if (!manifests) return null;
      if (
        offlineRollCallWitnessEnabled() &&
        manifests.some(
          (manifest) =>
            manifest.divers.some(
              (diver) => diver.recountRequired || diver.historicalReviewRequired,
            ) || manifest.crew.length > 0,
        )
      ) {
        const seats = await tx
          .select({ id: bookings.id, generation: bookings.offlineAssignmentGeneration })
          .from(bookings)
          .where(and(eq(bookings.shopId, shopId), eq(bookings.tripId, tripId)));
        const generations = new Map(seats.map((seat) => [seat.id, seat.generation]));
        const crewRows = await tx
          .select({
            personId: tripAssignments.personId,
            incarnation: tripAssignments.offlineIncarnation,
          })
          .from(tripAssignments)
          .where(eq(tripAssignments.tripId, tripId));
        const crewIncarnations = new Map(crewRows.map((crew) => [crew.personId, crew.incarnation]));
        const snapshotId = randomUUID();
        for (const manifest of manifests)
          for (const diver of manifest.divers) {
            const context = diver.rollCallContext;
            const generation = generations.get(diver.bookingId);
            if (
              (!diver.recountRequired && !diver.historicalReviewRequired) ||
              !diver.personId ||
              !context ||
              context.unknownMeetingDay ||
              generation === undefined
            )
              continue;
            context.liveRecountProof = {
              snapshotId,
              meetingDay: context.meetingDay,
              witness: signRollCallWitness({
                shopId,
                tripId,
                snapshotId,
                subjectKind: "seat",
                subjectId: diver.bookingId,
                checkpoint: manifest.checkpoint,
                meetingDay: context.meetingDay,
                meetingGeneration: state.meetingGeneration,
                assignmentGeneration: generation,
                originalPersonId: diver.personId,
                frontier: context.observedEvidenceIds,
              }),
            };
          }
        for (const manifest of manifests)
          for (const crew of manifest.crew) {
            const context = crew.rollCallContext;
            const incarnation = crewIncarnations.get(crew.id);
            if (!context || context.unknownMeetingDay || !incarnation) continue;
            context.liveRecountProof = {
              snapshotId,
              meetingDay: context.meetingDay,
              witness: signRollCallWitness({
                shopId,
                tripId,
                snapshotId,
                subjectKind: "crew",
                subjectId: crew.id,
                checkpoint: manifest.checkpoint,
                meetingDay: context.meetingDay,
                meetingGeneration: state.meetingGeneration,
                assignmentGeneration: 0,
                originalPersonId: incarnation,
                frontier: context.observedEvidenceIds,
              }),
            };
          }
      }
      const windows = state.windows.map((day) => ({
        startsAt: new Date(day.startsAt),
        endsAt: new Date(day.endsAt),
      }));
      return {
        manifests,
        erasureEpoch,
        snapshotRevision: state.revision ?? 0,
        windows: windows.length ? windows : undefined,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** What a page read was taken at: `readOfflineManifestRoster`'s epoch and revision. */
export type OfflineManifestReadAt = { erasureEpoch: number; snapshotRevision: number };

export type OfflineManifestSchedule = {
  startsAt: string;
  endsAt: string;
  meetingWindows: { startsAt: string; endsAt: string }[];
};

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
  return issueOfflineManifestSnapshotInternal(db, shopId, tripId, readAt);
}

export async function issueOfflineManifestSnapshotAtSchedule(
  db: AppDb,
  shopId: string,
  tripId: string,
  readAt: OfflineManifestReadAt,
  schedule: OfflineManifestSchedule,
): Promise<IssuedOfflineManifestSnapshot> {
  return issueOfflineManifestSnapshotInternal(db, shopId, tripId, readAt, schedule);
}

async function issueOfflineManifestSnapshotInternal(
  db: AppDb,
  shopId: string,
  tripId: string,
  readAt: OfflineManifestReadAt,
  schedule?: OfflineManifestSchedule,
): Promise<IssuedOfflineManifestSnapshot> {
  return db.transaction(async (tx) => {
    await lockBoardingCertificationEvidence(tx, shopId, "boarding");
    const epoch = await getShopOfflineErasureEpoch(tx, shopId);
    if (epoch === null) return { ok: false, reason: "not_found" } as const;
    if (epoch !== readAt.erasureEpoch) return { ok: false, reason: "erasure_epoch_moved" } as const;
    if (!(await lockOwnedTrip(tx, shopId, tripId)))
      return { ok: false, reason: "not_found" } as const;
    if (schedule) {
      // A statement after the lock sees a writer that committed while the lock waited.
      const [current] = await tx
        .select({
          startsAt: trips.startsAt,
          endsAt: trips.endsAt,
          windows: sql<{ startsAt: string; endsAt: string }[]>`coalesce((
          select json_agg(json_build_object('startsAt', d.starts_at, 'endsAt', d.ends_at) order by d.starts_at)
          from ${tripScheduleDays} d where d.trip_id = ${tripId}
        ), '[]'::json)`,
        })
        .from(trips)
        .where(and(eq(trips.shopId, shopId), eq(trips.id, tripId), liveTrip()))
        .limit(1);
      const normalized = (windows: { startsAt: string; endsAt: string }[]) =>
        windows
          .map((day) => ({
            startsAt: new Date(day.startsAt).toISOString(),
            endsAt: new Date(day.endsAt).toISOString(),
          }))
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      if (
        !current ||
        current.startsAt.toISOString() !== schedule.startsAt ||
        current.endsAt.toISOString() !== schedule.endsAt ||
        JSON.stringify(normalized(current.windows)) !==
          JSON.stringify(normalized(schedule.meetingWindows))
      )
        return { ok: false, reason: "snapshot_superseded" } as const;
    }
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
