import { and, eq, lt, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { type DeleteImageResult, deleteStoredImageTracked, isManagedBlobUrl } from "@/lib/storage";
import type { AppDb, DbExecutor } from "./client";
import { type MediaDeletionAttempt, type MediaDeletionKind, mediaDeletionAttempts } from "./schema";

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
  db: AppDb,
  input: QueueMediaDeletionInput,
): Promise<MediaDeletionAttempt | null> {
  if (!isManagedBlobUrl(input.url)) return null;
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
  const result = await deleteFn(attempt.url);
  await resolveMediaDeletion(
    db,
    attempt.id,
    result.ok ? { status: "succeeded" } : { status: "failed", error: result.error },
  );
}

/**
 * A `pending` row created before this cutoff means the process that queued it
 * died before ever resolving it — indistinguishable, for retry purposes, from
 * a `failed` row (CR-012's "provider-delete failure is owner-visible and
 * retryable" case covers both). Defaults to five minutes ago; injectable so
 * tests don't depend on real wall-clock time passing.
 */
const STALE_PENDING_AFTER_MS = 5 * 60 * 1000;

function defaultStaleBefore(): Date {
  return new Date(nowDate().getTime() - STALE_PENDING_AFTER_MS);
}

function stuckDeletionWhere(staleBefore: Date) {
  return or(
    eq(mediaDeletionAttempts.status, "failed"),
    and(
      eq(mediaDeletionAttempts.status, "pending"),
      lt(mediaDeletionAttempts.createdAt, staleBefore),
    ),
  );
}

/** Attempts an owner needs to see and can retry — a shop's reports/reconciliation panel. */
export async function listPendingMediaDeletions(
  db: AppDb,
  shopId: string,
  staleBefore: Date = defaultStaleBefore(),
): Promise<MediaDeletionAttempt[]> {
  return db
    .select()
    .from(mediaDeletionAttempts)
    .where(and(eq(mediaDeletionAttempts.shopId, shopId), stuckDeletionWhere(staleBefore)))
    .orderBy(mediaDeletionAttempts.createdAt);
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
  const result = await deleteFn(attempt.url);
  await resolveMediaDeletion(
    db,
    attempt.id,
    result.ok ? { status: "succeeded" } : { status: "failed", error: result.error },
  );
  return result.ok;
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
  deleteFn: DeleteFn = deleteStoredImageTracked,
): Promise<{ attempted: number; succeeded: number }> {
  const rows = await db
    .select()
    .from(mediaDeletionAttempts)
    .where(stuckDeletionWhere(staleBefore))
    .limit(limit);
  let succeeded = 0;
  for (const row of rows) {
    const result = await deleteFn(row.url);
    await resolveMediaDeletion(
      db,
      row.id,
      result.ok ? { status: "succeeded" } : { status: "failed", error: result.error },
    );
    if (result.ok) succeeded++;
  }
  return { attempted: rows.length, succeeded };
}
