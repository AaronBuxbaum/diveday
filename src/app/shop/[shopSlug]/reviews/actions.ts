"use server";

import { getDb } from "@/db/client";
import { setReviewPublished } from "@/db/reviews";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";

/**
 * Publish or hide one diver review. The shop is taken from the staff session
 * and re-checked inside the query, so a form replayed against another shop's
 * review id changes nothing (`setReviewPublished` is shop-scoped).
 */
export async function setReviewPublishedAction(formData: FormData) {
  const session = await requireStaffSession();
  const reviews = `/shop/${session.user.shopSlug}/reviews`;
  const reviewId = String(formData.get("reviewId") ?? "");
  const publish = formData.get("publish") === "true";
  if (!reviewId) revalidateAndRedirect(reviews, `${reviews}?notice=error`);

  const changed = await setReviewPublished(await getDb(), session.user.shopId, reviewId, publish);
  revalidateAndRedirect(
    reviews,
    `${reviews}?notice=${changed ? (publish ? "published" : "hidden") : "error"}`,
  );
}
