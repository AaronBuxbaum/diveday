import { and, eq, sql } from "drizzle-orm";
import { stuckBefore } from "@/lib/attempts";
import { nowDate } from "@/lib/clock";
import {
  type DeleteImageResult,
  deleteStoredImageTracked,
  isManagedStorageUrl,
} from "@/lib/storage";
import type { AppDb, DbExecutor } from "./client";
import { diveSitePhotoStillHeld } from "./dive-site-photos";
import { type MediaDeletionAttempt, type MediaDeletionKind, mediaDeletionAttempts } from "./schema";
import { unfinishedMediaDeletionWhere } from "./unfinished";

/** Injectable so tests can assert both delete outcomes without a real Blob token. */
type DeleteFn = (url: string) => Promise<DeleteImageResult>;

export type QueueMediaDeletionInput = {
  shopId: string;
  kind: MediaDeletionKind;
  url: string;
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
  const [attempt] = await db
    .insert(mediaDeletionAttempts)
    .values({ shopId: input.shopId, kind: input.kind, url: input.url })
    .returning();
  if (!attempt) throw new Error("queueMediaDeletion: insert returned no row");
  return attempt;
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
): Promise<void> {
  await db
    .update(mediaDeletionAttempts)
    .set({
      status: input.status,
      lastError: input.status === "failed" ? input.error : null,
      attempts: sql`${mediaDeletionAttempts.attempts} + 1`,
      resolvedAt: input.status === "succeeded" ? nowDate() : null,
    })
    .where(eq(mediaDeletionAttempts.id, attemptId));
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
  const result = await deleteFn(attempt.url);
  await resolveMediaDeletion(
    db,
    attempt.id,
    result.ok ? { status: "succeeded" } : { status: "failed", error: result.error },
  );
  return result.ok;
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
  deleteFn: DeleteFn = deleteStoredImageTracked,
): Promise<void> {
  const attempt = await queueMediaDeletion(db, input);
  if (!attempt) return;
  await attemptMediaDeletion(db, attempt, deleteFn);
}

function defaultStaleBefore(): Date | null {
  return stuckBefore("media_deletion", nowDate());
}

/** Retry one attempt by id, scoped to the shop — the owner-visible "Retry" action. */
export async function retryMediaDeletion(
  db: AppDb,
  shopId: string,
  attemptId: string,
  deleteFn: DeleteFn = deleteStoredImageTracked,
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
  staleBefore: Date | null = defaultStaleBefore(),
  deleteFn: DeleteFn = deleteStoredImageTracked,
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
