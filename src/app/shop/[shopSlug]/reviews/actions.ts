"use server";

import { getDb } from "@/db/client";
import { setReviewPublished } from "@/db/reviews";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";

/**
 * Publish or hide one diver review. The shop is taken from the staff session
 * and re-checked inside the query, so a form replayed against another shop's
 * review id changes nothing (`setReviewPublished` is shop-scoped).
 *
 * Hiding needs no confirm dialog: `setReviewPublished` is a pure toggle, so
 * calling this same action again with `publish=true` for the same review is a
 * full undo. A successful hide carries the review id back in the redirect as
 * `undo`, and the page renders a land-then-undo `<UndoToast>` whose Undo
 * button posts straight back to this action (divers/[personId]/actions.ts's
 * `deleteCertificationAction`/`restoreCardAction` precedent, docs/design/principles.md #7).
 */
export async function setReviewPublishedAction(formData: FormData) {
  const session = await requireStaffSession();
  const reviews = `/shop/${session.user.shopSlug}/reviews`;
  const reviewId = String(formData.get("reviewId") ?? "");
  const publish = formData.get("publish") === "true";
  if (!reviewId) revalidateAndRedirect(reviews, `${reviews}?notice=error`);

  const changed = await setReviewPublished(await getDb(), session.user.shopId, reviewId, publish);
  if (!changed) revalidateAndRedirect(reviews, `${reviews}?notice=error`);
  revalidateAndRedirect(
    reviews,
    publish ? `${reviews}?notice=published` : `${reviews}?notice=hidden&undo=${reviewId}`,
  );
}
