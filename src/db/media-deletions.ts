import { and, eq, sql } from "drizzle-orm";
import { stuckBefore } from "@/lib/attempts";
import { nowDate } from "@/lib/clock";
import {
  type DeleteImageResult,
  deleteStoredImageTracked,
  isManagedStorageUrl,
  purgeStoredImageTracked,
} from "@/lib/storage";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import type { AppDb, DbExecutor } from "./client";
import { diveSitePhotoStillHeld } from "./dive-site-photos";
import { boundLockWaits } from "./lock-bounds";
import {
  type MediaDeletionAttempt,
  type MediaDeletionKind,
  mediaDeletionAttempts,
  people,
} from "./schema";
import { unfinishedMediaDeletionWhere } from "./unfinished";

/** Injectable so tests can assert both delete outcomes without a real Blob token. */
export type DeleteFn = (url: string, purgeVersions?: boolean) => Promise<DeleteImageResult>;

export type QueueMediaDeletionInput = {
  shopId: string;
  kind: MediaDeletionKind;
  url: string;
  purgeVersions?: boolean;
  personId?: string;
};

/**
 * Write the durable "this blob should no longer exist" record and commit it
 * on its own, before the provider delete call — the same reasoning as
 * `startPaymentOperation` (CR-005): a row that only commits alongside the
 * delete call succeeding is not durable against a crash between the two, and
 * a crash there would otherwise leave the object orphaned with no record
 * anyone still owes it a delete.
 *
 * Returns `null`, queuing nothing, when `url` isn't actually a Blob object
 * this seam could have stored (a bundled template asset, a legacy pasted
 * external URL). Queuing one of those would create a row that can never
 * resolve — the provider has never heard of it, so every retry fails the
 * same way forever, permanently occupying a slot on the owner-visible
 * reports panel and the bounded nightly retry (a real gap a security review
 * of this ticket found: course photo replacement was queuing every seeded
 * shop's default template photos for deletion on the first ordinary edit).
 * Enforced here, once, so no future caller can reintroduce it.
 */
export async function queueMediaDeletion(
  db: DbExecutor,
  input: QueueMediaDeletionInput,
): Promise<MediaDeletionAttempt | null> {
  if (!isManagedStorageUrl(input.url)) return null;
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    let personId = input.personId;
    let erased = false;
    if (personId) {
      await lockBoardingCertificationEvidence(tx, input.shopId, "rewrite");
      const seen = new Set<string>();
      while (personId) {
        if (seen.has(personId) || seen.size === 256)
          throw new Error("media_deletion_subject_chain_invalid");
        seen.add(personId);
        const [subject] = await tx
          .select({
            anonymizedAt: people.anonymizedAt,
            mergedIntoPersonId: people.mergedIntoPersonId,
          })
          .from(people)
          // diveday:allow-deleted-people: retired bytes remain attributable after removal, merge and erasure.
          .where(and(eq(people.id, personId), eq(people.shopId, input.shopId)))
          // diveday:allow-update-lock: the shared merge fence precedes the subject lock, matching erasure.
          .for("update");
        if (!subject) throw new Error("media_deletion_subject_not_found");
        if (subject.mergedIntoPersonId) {
          personId = subject.mergedIntoPersonId;
          continue;
        }
        erased = Boolean(subject.anonymizedAt);
        break;
      }
    }
    const [attempt] = await tx
      .insert(mediaDeletionAttempts)
      .values({
        shopId: input.shopId,
        kind: input.kind,
        url: input.url,
        personId,
        purgeVersions: erased || (input.purgeVersions ?? false),
      })
      .returning();
    if (!attempt) throw new Error("queueMediaDeletion: insert returned no row");
    return attempt;
  });
}

export type ResolveMediaDeletionInput =
  | { status: "succeeded" }
  | { status: "failed"; error: string };

/**
 * Record how a delete attempt resolved. A `failed` row is deliberately left
 * with `resolvedAt` unset — CR-012 requires a provider-delete failure stay
 * owner-visible and retryable, not silently treated as done; only `succeeded`
 * closes the row out.
 */
export async function resolveMediaDeletion(
  db: DbExecutor,
  attemptId: string,
  input: ResolveMediaDeletionInput,
  expectedPurgeVersions?: boolean,
): Promise<boolean> {
  const rows = await db
    .update(mediaDeletionAttempts)
    .set({
      status: input.status,
      lastError: input.status === "failed" ? input.error : null,
      attempts: sql`${mediaDeletionAttempts.attempts} + 1`,
      resolvedAt: input.status === "succeeded" ? nowDate() : null,
    })
    .where(
      and(
        eq(mediaDeletionAttempts.id, attemptId),
        expectedPurgeVersions === undefined
          ? undefined
          : eq(mediaDeletionAttempts.purgeVersions, expectedPurgeVersions),
      ),
    )
    .returning({ id: mediaDeletionAttempts.id });
  return rows.length > 0;
}

/**
 * Delete one queued object, unless a dive site still holds it.
 *
 * The one path every caller's storage delete goes through, so the holder check
 * covers them all (issue #2193): the edit page decides a dive-site photo is
 * free *before* it queues the delete, and a copy or an import committing a row
 * that names the photo after that read would otherwise lose it. A held photo's
 * row is dropped rather than resolved: nothing is owed any more, and a row
 * left `failed` would ask an owner to retry a delete that must not happen.
 */
async function attemptMediaDeletion(
  db: AppDb,
  attempt: MediaDeletionAttempt,
  deleteFn: DeleteFn,
): Promise<boolean> {
  if (attempt.kind === "dive_site_photo" && (await diveSitePhotoStillHeld(db, attempt.url))) {
    // Machinery, not a record anyone points at: the decision it held was withdrawn.
    await db.delete(mediaDeletionAttempts).where(eq(mediaDeletionAttempts.id, attempt.id));
    return false;
  }
  const [current] = await db
    .select()
    .from(mediaDeletionAttempts)
    .where(eq(mediaDeletionAttempts.id, attempt.id));
  if (!current) return false;
  attempt = current;
  const result = await (attempt.purgeVersions
    ? deleteFn(attempt.url, true)
    : deleteFn(attempt.url));
  const recorded = await resolveMediaDeletion(
    db,
    attempt.id,
    result.ok ? { status: "succeeded" } : { status: "failed", error: result.error },
    attempt.purgeVersions,
  );
  return recorded && result.ok;
}

/**
 * Queue a delete and attempt it immediately — the common case is a single
 * round trip, with the durable row as the fallback if the process dies mid
 * attempt or the provider call itself fails. Callers (course photo
 * replacement, recap-photo moderation) never see the provider outcome; a
 * failure surfaces later on the owner-visible pending list, never by undoing
 * the local removal that already happened.
 */
export async function queueAndAttemptMediaDeletion(
  db: AppDb,
  input: QueueMediaDeletionInput,
  deleteFn: DeleteFn = deleteMedia,
): Promise<void> {
  const attempt = await queueMediaDeletion(db, input);
  if (!attempt) return;
  await attemptMediaDeletion(db, attempt, deleteFn);
}

function defaultStaleBefore(): Date {
  // The media window is never zero, so this is never null; a null here would
  // retry deletes still in flight.
  return stuckBefore("media_deletion", nowDate()) as Date;
}

/** Retry one attempt by id, scoped to the shop — the owner-visible "Retry" action. */
export async function retryMediaDeletion(
  db: AppDb,
  shopId: string,
  attemptId: string,
  deleteFn: DeleteFn = deleteMedia,
): Promise<boolean> {
  const [attempt] = await db
    .select()
    .from(mediaDeletionAttempts)
    .where(and(eq(mediaDeletionAttempts.id, attemptId), eq(mediaDeletionAttempts.shopId, shopId)));
  if (!attempt || attempt.status === "succeeded") return false;
  return attemptMediaDeletion(db, attempt, deleteFn);
}

/**
 * Bounded orphan cleanup (CR-012): retries every stuck attempt across every
 * shop, up to `limit` per run, so a scheduled tick — not just an owner
 * clicking Retry — eventually closes an attempt a transient provider outage
 * left stuck. Bounded so one run can never become an unbounded retry storm;
 * the cron endpoint that calls this (src/app/api/cron/reminders/route.ts)
 * runs daily, so a stuck attempt is retried automatically well before it
 * would ever need a human.
 */
export async function retryPendingMediaDeletions(
  db: AppDb,
  limit = 50,
  staleBefore: Date = defaultStaleBefore(),
  deleteFn: DeleteFn = deleteMedia,
): Promise<{ attempted: number; succeeded: number }> {
  const rows = await db
    .select()
    .from(mediaDeletionAttempts)
    .where(unfinishedMediaDeletionWhere(staleBefore))
    .limit(limit);
  let succeeded = 0;
  for (const row of rows) {
    if (await attemptMediaDeletion(db, row, deleteFn)) succeeded++;
  }
  return { attempted: rows.length, succeeded };
}

const deleteMedia: DeleteFn = (url, purgeVersions) =>
  purgeVersions ? purgeStoredImageTracked(url) : deleteStoredImageTracked(url);
