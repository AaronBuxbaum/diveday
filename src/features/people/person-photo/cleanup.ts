import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { people, privatePersonPhotoUploads } from "@/db/schema";
import { DAY_MS, HOUR_MS, nowDate } from "@/lib/clock";
import { purgeStoredImageTracked } from "@/lib/storage";

/**
 * Retired keys remain tombstones and are purged repeatedly: an S3 PUT may
 * finish after the caller timed out and after an earlier purge found nothing.
 * Row locks serialize cleanup with publication; the current-reference check
 * fails closed if state ever drifts. No caller ever reuses an opaque key.
 */
export async function cleanupPrivatePersonPhotos(db: AppDb, limit = 5) {
  const now = nowDate();
  const stale = new Date(now.getTime() - HOUR_MS);
  const next = new Date(now.getTime() - DAY_MS);
  const candidates = await db
    .select({ url: privatePersonPhotoUploads.url })
    .from(privatePersonPhotoUploads)
    .where(
      and(
        eq(privatePersonPhotoUploads.cleanAfterPut, false),
        or(
          eq(privatePersonPhotoUploads.state, "retired"),
          and(
            eq(privatePersonPhotoUploads.state, "staged"),
            lt(privatePersonPhotoUploads.createdAt, stale),
          ),
        ),
        or(
          isNull(privatePersonPhotoUploads.lastCleanupAt),
          lt(privatePersonPhotoUploads.lastCleanupAt, next),
        ),
      ),
    )
    .orderBy(sql`${privatePersonPhotoUploads.lastCleanupAt} asc nulls first`)
    // Five provider calls at 20 seconds each leave room in the shared cron for
    // its other scans even during an outage. Never let a caller enlarge that bound.
    .limit(Math.min(limit, 5));
  let failed = false;
  for (const candidate of candidates) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(privatePersonPhotoUploads)
        .where(eq(privatePersonPhotoUploads.url, candidate.url))
        .for("update");
      if (!row || row.state === "active") return;
      const [held] = await tx
        .select({ id: people.id })
        .from(people)
        // diveday:allow-deleted-people: any surviving reference prevents deletion, including removed records.
        .where(and(eq(people.shopId, row.shopId), eq(people.diverPhotoPath, row.url)))
        .limit(1);
      if (held) {
        await tx
          .update(privatePersonPhotoUploads)
          .set({ lastCleanupAt: now, lastCleanupError: "private_photo_still_referenced" })
          .where(eq(privatePersonPhotoUploads.url, row.url));
        failed = true;
        return;
      }
      const result = await purgeStoredImageTracked(row.url);
      await tx
        .update(privatePersonPhotoUploads)
        .set({
          state: "retired",
          lastCleanupAt: now,
          lastCleanupError: result.ok ? null : result.error,
          cleanAfterPut: result.ok && row.putFinished,
        })
        .where(eq(privatePersonPhotoUploads.url, row.url));
      if (!result.ok) failed = true;
    });
  }
  if (failed) throw new Error("private_photo_cleanup_failed");
  return { attempted: candidates.length };
}
