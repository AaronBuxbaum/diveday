"use server";

import { getDb } from "@/db/client";
import {
  REVIEW_MODERATION_REASONS,
  type ReviewModerationReason,
  setReviewPublished,
  setReviewsPublished,
} from "@/db/reviews";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * Publish or hide one diver review. The shop is taken from the staff session
 * and re-checked inside the query, so a form replayed against another shop's
 * review id changes nothing (`setReviewPublished` is shop-scoped).
 *
 * **A hide states a reason**, chosen from the short list in
 * `review_moderation_reason` (ADR 20260813-review-moderation-has-a-floor), and
 * `other` states it in the shop's own words. The reason is recorded with the
 * act; it is refused here rather than defaulted, because a default reason is a
 * sentence DiveDay would be putting in the shop's mouth.
 *
 * Hiding still needs no confirm dialog: publishing the same review again is a
 * full undo. A successful hide carries the review id back in the redirect as
 * `undo`, and the page renders a land-then-undo `<UndoToast>` whose Undo button
 * posts straight back to this action (divers/[personId]/actions.ts's
 * `deleteCertificationAction`/`restoreCardAction` precedent, docs/design/principles.md #7).
 */
export async function setReviewPublishedAction(formData: FormData) {
  const session = await requireStaffSession();
  // `shopPath`, not a template: the slug rides in on the session but is still
  // an ordinary string being spliced into a redirect target, and every segment
  // it builds is escaped (src/lib/staff-notices.ts).
  const reviews = shopPath(session.user.shopSlug, "reviews");
  const reviewId = String(formData.get("reviewId") ?? "");
  const publish = formData.get("publish") === "true";
  if (!reviewId) revalidateAndRedirect(reviews, noticeUrl(reviews, "error"));

  const outcome = await setReviewPublished(await getDb(), session.user.shopId, reviewId, publish, {
    recordedByPersonId: session.user.personId,
    reason: parseReviewModerationReason(formData.get("reason")),
    reasonNote: String(formData.get("reasonNote") ?? ""),
  });
  if (outcome === "not_found") revalidateAndRedirect(reviews, noticeUrl(reviews, "error"));
  // The `#review-<id>` fragment goes on the path handed to `noticeUrl`, which
  // merges the notice into the query *ahead* of it — the refused row is still
  // what the browser lands on.
  if (outcome === "reason_required") {
    revalidateAndRedirect(reviews, noticeUrl(`${reviews}#review-${reviewId}`, "reason-required"));
  }
  if (outcome === "note_required") {
    revalidateAndRedirect(reviews, noticeUrl(`${reviews}#review-${reviewId}`, "note-required"));
  }
  revalidateAndRedirect(
    reviews,
    publish ? noticeUrl(reviews, "published") : noticeUrl(reviews, "hidden", { undo: reviewId }),
  );
}

/** A posted value narrowed to a real reason code, or null — never a coerced one. */
function parseReviewModerationReason(
  value: FormDataEntryValue | null,
): ReviewModerationReason | null {
  const candidate = typeof value === "string" ? value : "";
  return REVIEW_MODERATION_REASONS.includes(candidate as ReviewModerationReason)
    ? (candidate as ReviewModerationReason)
    : null;
}

/**
 * Release every ticked review in one go — the queue's answer to a weekend that
 * left eight reviews waiting and only a per-row button to clear them with.
 *
 * Publish-only, deliberately: the same shop-scoping as the single toggle above
 * (`setReviewsPublished` re-checks the session's shop, so ids belonging to
 * another shop change nothing and come back as a refusal), but no bulk *hide*.
 * Taking words down is the destructive direction and keeps its per-review undo.
 * An empty tick list is refused with its own notice rather than silently
 * redirecting to a page that looks unchanged.
 */
export async function publishReviewsAction(formData: FormData) {
  const session = await requireStaffSession();
  const reviews = shopPath(session.user.shopSlug, "reviews");
  const reviewIds = formData
    .getAll("reviewIds")
    .map((value) => String(value))
    .filter(Boolean);
  if (reviewIds.length === 0) revalidateAndRedirect(reviews, noticeUrl(reviews, "none-selected"));

  const published = await setReviewsPublished(
    await getDb(),
    session.user.shopId,
    reviewIds,
    session.user.personId,
  );
  if (published === 0) revalidateAndRedirect(reviews, noticeUrl(reviews, "error"));
  revalidateAndRedirect(reviews, noticeUrl(reviews, "published-many", { published }));
}
