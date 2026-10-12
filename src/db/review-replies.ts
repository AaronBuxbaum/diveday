import { and, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { normalizeReviewReply } from "@/lib/reviews";
import { isUuid } from "@/lib/uuid";
import type { AppDb } from "./client";
import { reviewReplies, tripReviews } from "./schema";
import { recordShopActivity } from "./shop-activity";

/**
 * **The shop's public reply under a review** (batch 4, K2; glossary "Review
 * reply").
 *
 * One live reply per review, written, rewritten or deleted by an owner or a
 * manager — the gate lives in the action that calls these
 * (`canPersonReplyToReviews`), as every staff gate does. Here the shop comes
 * from the session and is re-checked in every query, so a form replayed
 * against another shop's review changes nothing.
 *
 * **Only under a review that is public and has words.** A reply under a bare
 * rating would render nowhere (the public lists show written reviews only),
 * and a reply under an unpublished review would be the shop answering words
 * nobody can read. A review hidden *after* it was answered keeps its reply
 * row, and the reply goes dark with it: every public read scopes to published
 * reviews first.
 *
 * Every act writes one activity line, filed on the review's departure and
 * naming no reviewer (`review_replied`, `review_reply_edited`,
 * `review_reply_deleted`).
 */

export type WriteReviewReplyResult =
  | { ok: true; effect: "replied" | "edited" }
  | { ok: false; reason: "empty" | "too_long" | "not_found" | "not_answerable" };

/** Write the reply under a review, or rewrite the one already there. */
export async function writeReviewReply(
  db: AppDb,
  input: { shopId: string; reviewId: string; personId: string; body: unknown; now?: Date },
): Promise<WriteReviewReplyResult> {
  const text = normalizeReviewReply(input.body);
  if (!text.ok) return { ok: false, reason: text.reason };
  if (!isUuid(input.reviewId)) return { ok: false, reason: "not_found" };
  const now = input.now ?? nowDate();

  const result = await db.transaction(async (tx): Promise<WriteReviewReplyResult> => {
    const [review] = await tx
      .select({
        id: tripReviews.id,
        isPublished: tripReviews.isPublished,
        comment: tripReviews.comment,
      })
      .from(tripReviews)
      .where(and(eq(tripReviews.id, input.reviewId), eq(tripReviews.shopId, input.shopId)))
      .limit(1)
      // Taken in this transaction so two staffers replying at once settle on
      // one row: the second one waits and then edits the first one's reply.
      .for("update");
    if (!review) return { ok: false, reason: "not_found" };
    if (!review.isPublished || !review.comment) return { ok: false, reason: "not_answerable" };

    const [edited] = await tx
      .update(reviewReplies)
      .set({ body: text.body, writtenByPersonId: input.personId, updatedAt: now })
      .where(
        and(
          eq(reviewReplies.reviewId, review.id),
          eq(reviewReplies.shopId, input.shopId),
          isNull(reviewReplies.deletedAt),
        ),
      )
      .returning({ id: reviewReplies.id });
    if (edited) return { ok: true, effect: "edited" };

    await tx.insert(reviewReplies).values({
      shopId: input.shopId,
      reviewId: review.id,
      body: text.body,
      writtenByPersonId: input.personId,
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true, effect: "replied" };
  });

  if (result.ok) {
    await recordShopActivity(db, {
      shopId: input.shopId,
      actorPersonId: input.personId,
      write: {
        code: result.effect === "replied" ? "review_replied" : "review_reply_edited",
        reviewId: input.reviewId,
      },
    });
  }
  return result;
}

/**
 * Take the reply down. Soft, like every delete (ADR
 * 20260820-every-delete-is-soft): the row keeps its words and its stamp, and
 * the review may be answered again afterwards. `false` when there was no live
 * reply in this shop to delete.
 */
export async function deleteReviewReply(
  db: AppDb,
  input: { shopId: string; reviewId: string; personId: string; now?: Date },
): Promise<boolean> {
  if (!isUuid(input.reviewId)) return false;
  const now = input.now ?? nowDate();
  const [deleted] = await db
    .update(reviewReplies)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(reviewReplies.reviewId, input.reviewId),
        eq(reviewReplies.shopId, input.shopId),
        isNull(reviewReplies.deletedAt),
      ),
    )
    .returning({ id: reviewReplies.id });
  if (!deleted) return false;
  await recordShopActivity(db, {
    shopId: input.shopId,
    actorPersonId: input.personId,
    write: { code: "review_reply_deleted", reviewId: input.reviewId },
  });
  return true;
}

/** The live reply under one review, for tests and the staff row. */
export async function liveReviewReply(db: AppDb, shopId: string, reviewId: string) {
  if (!isUuid(reviewId)) return null;
  const [reply] = await db
    .select({ body: reviewReplies.body, updatedAt: reviewReplies.updatedAt })
    .from(reviewReplies)
    .where(
      and(
        eq(reviewReplies.reviewId, reviewId),
        eq(reviewReplies.shopId, shopId),
        isNull(reviewReplies.deletedAt),
      ),
    )
    .limit(1);
  return reply ?? null;
}
