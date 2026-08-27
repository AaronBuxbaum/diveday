"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import {
  REVIEW_MODERATION_REASONS,
  type ReviewModerationReason,
  setReviewPublished,
  setReviewStandout,
  setReviewsPublished,
} from "@/db/reviews";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { isUuid } from "@/lib/uuid";

/* -------------------------------------------------------------------------- *
 * The moderation queue's mutations, answered **in place**.
 *
 * Every one of these used to end in `revalidateAndRedirect(reviews, noticeUrl(…))`,
 * so publishing one review was a navigation: the whole list re-fetched, the
 * page landed back at scroll top with a `?notice=` on the URL, and the row a
 * staffer had just acted on was somewhere below the fold. On a weekend's worth
 * of held reviews that is one full-page bounce per tap, and the thing you were
 * reading moves every time.
 *
 * The shape is the one the boat manifest already uses (`rollCallAction` in
 * trips/[id]/manifest/actions.ts): `revalidatePath` so the write is visible,
 * then **return** the outcome instead of redirecting, and let a `useActionState`
 * control settle the row it belongs to. Nothing about the writes themselves
 * changed — the shop still comes from the session and is re-checked inside
 * every query, so a form replayed against another shop's review id still
 * changes nothing.
 * -------------------------------------------------------------------------- */

/** What a tap on one review's controls did. `null` is "nothing yet". */
export type ReviewActionResult =
  | {
      ok: true;
      effect: "published" | "hidden" | "standout" | "standout-removed";
      /** Set on a hide: the review the land-then-undo toast offers to put back. */
      undoReviewId?: string;
    }
  | { ok: false; reason: "reason-required" | "note-required" | "note-too-long" | "error" }
  | null;

/** What a "Publish selected" pass did. `null` is "nothing yet". */
export type BulkPublishResult =
  | { ok: true; published: number }
  | { ok: false; reason: "none-selected" | "error" }
  | null;

/**
 * One review's controls, behind one action.
 *
 * Publish, hide and standout are **one** action rather than three because the
 * control that reports an outcome has to survive that outcome. Publishing a
 * waiting review re-renders the row as published, which unmounts the Publish
 * button and mounts the standout toggle — so a per-button `useActionState`
 * would take its own confirmation down with it at the exact moment it had
 * something to say. That is the bug the bulk control's status row already
 * exists to prevent, one scale down: one action, one state, one status region
 * that outlives every button in the row.
 */
export async function reviewRowAction(
  _prev: ReviewActionResult,
  formData: FormData,
): Promise<ReviewActionResult> {
  const session = await requireStaffSession();
  // `shopPath`, not a template: the slug rides in on the session but is still
  // an ordinary string being spliced into a path, and every segment it builds
  // is escaped (src/lib/staff-notices.ts).
  const reviews = shopPath(session.user.shopSlug, "reviews");
  const reviewId = String(formData.get("reviewId") ?? "");
  if (!isUuid(reviewId)) return { ok: false, reason: "error" };

  if (formData.get("intent") === "standout") {
    const standout = formData.get("standout") === "true";
    const outcome = await setReviewStandout(await getDb(), session.user.shopId, reviewId, standout);
    if (outcome !== true) return { ok: false, reason: "error" };
    revalidatePath(reviews);
    return { ok: true, effect: standout ? "standout" : "standout-removed" };
  }

  /*
   * **A hide states a reason**, chosen from the short list in
   * `review_moderation_reason` (ADR 20260813-review-moderation-has-a-floor),
   * and `other` states it in the shop's own words. The reason is recorded with
   * the act; it is refused here rather than defaulted, because a default reason
   * is a sentence DiveDay would be putting in the shop's mouth.
   *
   * Hiding still needs no confirm dialog: publishing the same review again is a
   * full undo. A successful hide names the review in its result, and the row
   * renders a land-then-undo `<UndoToast>` whose Undo posts straight back to
   * this action (docs/design/principles.md #7).
   */
  const publish = formData.get("publish") === "true";
  const outcome = await setReviewPublished(await getDb(), session.user.shopId, reviewId, publish, {
    recordedByPersonId: session.user.personId,
    reason: parseReviewModerationReason(formData.get("reason")),
    reasonNote: String(formData.get("reasonNote") ?? ""),
  });
  if (outcome === "reason_required") return { ok: false, reason: "reason-required" };
  if (outcome === "note_required") return { ok: false, reason: "note-required" };
  if (outcome === "note_too_long") return { ok: false, reason: "note-too-long" };
  if (outcome !== true) return { ok: false, reason: "error" };

  revalidatePath(reviews);
  return publish
    ? { ok: true, effect: "published" }
    : { ok: true, effect: "hidden", undoReviewId: reviewId };
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
 * Publish-only, deliberately: the same shop-scoping as the row action above
 * (`setReviewsPublished` re-checks the session's shop, so ids belonging to
 * another shop change nothing and come back as a refusal), but no bulk *hide*.
 * Taking words down is the destructive direction and keeps its per-review undo.
 * An empty tick list is refused with its own result rather than answering with
 * a list that looks unchanged.
 */
export async function publishReviewsAction(
  _prev: BulkPublishResult,
  formData: FormData,
): Promise<BulkPublishResult> {
  const session = await requireStaffSession();
  const reviews = shopPath(session.user.shopSlug, "reviews");
  const reviewIds = formData
    .getAll("reviewIds")
    .map((value) => String(value))
    .filter(Boolean);
  if (reviewIds.length === 0) return { ok: false, reason: "none-selected" };

  const published = await setReviewsPublished(
    await getDb(),
    session.user.shopId,
    reviewIds,
    session.user.personId,
  );
  if (published === 0) return { ok: false, reason: "error" };
  revalidatePath(reviews);
  return { ok: true, published };
}
