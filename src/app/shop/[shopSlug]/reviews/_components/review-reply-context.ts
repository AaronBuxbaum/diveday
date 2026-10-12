import { canPersonReplyToReviews } from "@/db/authz";
import type { AppDb } from "@/db/client";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { MAX_REVIEW_REPLY_LENGTH } from "@/lib/reviews";
import type { ReviewReplyCopy } from "./ReviewReply";

/** What each review row needs to show the shop's reply, and to write one. */
export type ReviewReplyContext = { canReply: boolean; copy: ReviewReplyCopy };

/**
 * **Who may answer a review in public, and the words for it** (batch 4, K2).
 * Owner or manager, read live from the database rather than the session, the
 * same as every staff gate (`canPersonReplyToReviews`). Everyone else on the
 * Reviews page still reads the shop's reply under the review.
 */
export async function reviewReplyContext(
  db: AppDb,
  shop: { id: string; name: string },
  personId: string,
  t: StaffTranslator,
): Promise<ReviewReplyContext> {
  const max = MAX_REVIEW_REPLY_LENGTH;
  return {
    canReply: await canPersonReplyToReviews(db, shop.id, personId),
    copy: {
      reply: t("reviews.reply.open"),
      yourReply: t("reviews.reply.yours", { shop: shop.name }),
      fieldLabel: t("reviews.reply.fieldLabel"),
      hint: t("reviews.reply.hint", { max }),
      save: t("reviews.reply.save"),
      saving: t("reviews.saving"),
      edit: t("reviews.reply.edit"),
      cancel: t("reviews.reply.cancel"),
      delete: t("reviews.reply.delete"),
      deleteConfirm: t("reviews.reply.deleteConfirm"),
      replied: t("reviews.reply.replied"),
      edited: t("reviews.reply.edited"),
      deleted: t("reviews.reply.deleted"),
      notAuthorized: t("reviews.reply.notAuthorized"),
      empty: t("reviews.reply.empty"),
      tooLong: t("reviews.reply.tooLong", { max }),
      notAnswerable: t("reviews.reply.notAnswerable"),
      error: t("reviews.notice.error"),
    },
  };
}
