import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { writeReviewReply } from "@/db/review-replies";
import { tripReviews } from "@/db/schema";

/**
 * **The shop's reply under its newest published review with words** (batch 4,
 * K2), through `writeReviewReply`, which edits rather than stacks on a second
 * call.
 */
export async function answerTheNewestReview(
  db: AppDb,
  shopId: string,
  actorPersonId: string,
): Promise<{ reviewId: string } | null> {
  const [review] = await db
    .select({ id: tripReviews.id })
    .from(tripReviews)
    .where(
      and(
        eq(tripReviews.shopId, shopId),
        eq(tripReviews.isPublished, true),
        isNotNull(tripReviews.comment),
      ),
    )
    .orderBy(desc(tripReviews.createdAt))
    .limit(1);
  if (!review) return null;
  const written = await writeReviewReply(db, {
    shopId,
    reviewId: review.id,
    personId: actorPersonId,
    body: "Thank you for diving with us. The turtles will be waiting next time.",
  });
  return written.ok ? { reviewId: review.id } : null;
}
