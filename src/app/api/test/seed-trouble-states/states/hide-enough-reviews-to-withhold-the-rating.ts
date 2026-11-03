import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { getShopReviewAggregate, setReviewPublished } from "@/db/reviews";
import { tripReviews } from "@/db/schema";
import { MAX_SUPPRESSED_SHARE_FOR_RATING } from "@/lib/reviews";

/**
 * How many reviews it takes is computed rather than hard-coded: the seed's
 * review count moves, and a fixed number would one day stop crossing the line
 * and quietly turn this capture into a photograph of nothing.
 *
 * Hiding `h` of `j` judged reviews leaves a suppressed share of
 * `(s + h) / j` — hiding does not change how many have been judged — so the
 * smallest `h` that clears `MAX_SUPPRESSED_SHARE_FOR_RATING` is one more than
 * the share's own share of the total, floored.
 */
export async function hideEnoughReviewsToWithholdTheRating(
  db: AppDb,
  shopId: string,
  recordedByPersonId: string,
): Promise<void> {
  const aggregate = await getShopReviewAggregate(db, shopId);
  const judged = aggregate.count + aggregate.suppressedCount;
  const needed =
    Math.floor(MAX_SUPPRESSED_SHARE_FOR_RATING * judged) + 1 - aggregate.suppressedCount;
  if (needed <= 0) return;

  const published = await db
    .select({ id: tripReviews.id })
    .from(tripReviews)
    .where(and(eq(tripReviews.shopId, shopId), eq(tripReviews.isPublished, true)))
    .orderBy(tripReviews.createdAt)
    .limit(needed);
  for (const review of published) {
    await setReviewPublished(db, shopId, review.id, false, {
      recordedByPersonId,
      reason: "spam",
    });
  }
}
