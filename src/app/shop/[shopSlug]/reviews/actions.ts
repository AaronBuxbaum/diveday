"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { markRecapPulseAddressed } from "@/db/recap-pulses";
import {
  REVIEW_MODERATION_REASONS,
  type ReviewModerationReason,
  setReviewPublished,
  setReviewStandout,
  setReviewsPublished,
} from "@/db/reviews";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
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
      /**
       * Which review this outcome is about. The state lives above the list now
       * (`ReviewRowProvider`), so the row that reports it has to recognise its
       * own result rather than assume every result is hers.
       */
      reviewId: string;
      effect: "published" | "hidden" | "standout" | "standout-removed";
      /** Set on a hide: the review the land-then-undo toast offers to put back. */
      undoReviewId?: string;
    }
  | {
      ok: false;
      reviewId: string;
      reason: "reason-required" | "note-required" | "note-too-long" | "error";
    }
  | null;

/** What a "Publish all" pass did. `null` is "nothing yet". */
export type BulkPublishResult = { ok: true; published: number } | { ok: false } | null;

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
 *
 * The same reasoning went one scale further on 2026-08-28, because the page
 * renders three independent `<ul>`s and every one of these acts moves a review
 * between them — which unmounts the whole row, status region included. The
 * state lives above the lists in `ReviewRowProvider` now, and every result
 * names its `reviewId` so a row can tell its own outcome from its neighbour's.
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
  if (!isUuid(reviewId)) return { ok: false, reviewId, reason: "error" };

  if (formData.get("intent") === "standout") {
    const standout = formData.get("standout") === "true";
    const outcome = await setReviewStandout(await getDb(), session.user.shopId, reviewId, standout);
    if (outcome !== true) return { ok: false, reviewId, reason: "error" };
    revalidatePath(reviews);
    return { ok: true, reviewId, effect: standout ? "standout" : "standout-removed" };
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
  if (outcome === "reason_required") return { ok: false, reviewId, reason: "reason-required" };
  if (outcome === "note_required") return { ok: false, reviewId, reason: "note-required" };
  if (outcome === "note_too_long") return { ok: false, reviewId, reason: "note-too-long" };
  if (outcome !== true) return { ok: false, reviewId, reason: "error" };

  revalidatePath(reviews);
  return publish
    ? { ok: true, reviewId, effect: "published" }
    : { ok: true, reviewId, effect: "hidden", undoReviewId: reviewId };
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
 * Release every review in the waiting group in one go — the queue's answer to a
 * weekend that left eight reviews waiting and only a per-row button to clear
 * them with.
 *
 * Publish-only, deliberately: the same shop-scoping as the row action above
 * (`setReviewsPublished` re-checks the session's shop, so ids belonging to
 * another shop change nothing and come back as a refusal), but no bulk *hide*.
 * Taking words down is the destructive direction and keeps its per-review undo.
 *
 * One refusal, not two. The ids arrive as hidden fields on the group header's
 * own form, so "nothing was selected" stopped being a thing a person can do
 * when the tick boxes retired (ADR 20260827-people-not-lists); an empty or
 * already-published post is a stale page replaying itself, and "that could not
 * be updated" is the honest answer to both.
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
  if (reviewIds.length === 0) return { ok: false };

  const published = await setReviewsPublished(
    await getDb(),
    session.user.shopId,
    reviewIds,
    session.user.personId,
  );
  if (published === 0) return { ok: false };
  revalidatePath(reviews);
  return { ok: true, published };
}

/**
 * **A staffer says one private pulse is dealt with** (D40, issue #1200).
 *
 * The one act on this page that still redirects, and deliberately. Every other
 * control here settles in place because it moves a row between three long
 * lists a staffer is working down, and a bounce to the top of that queue costs
 * them their place. The pulse panel is different in both halves: it sits above
 * everything, and marking the last open item clears the whole block away — so
 * without a sentence the page simply goes quiet on somebody who just acted on
 * a person's complaint. The redirect lands where the panel was.
 *
 * Shop comes from the session and is re-checked inside `markRecapPulseAddressed`,
 * so a form replayed against another shop's pulse id changes nothing (CR-007).
 */
export async function markPulseAddressedAction(formData: FormData) {
  const session = await requireStaffSession();
  const reviews = shopPath(session.user.shopSlug, "reviews");
  const pulseId = String(formData.get("pulseId") ?? "");
  const marked = await markRecapPulseAddressed(
    await getDb(),
    session.user.shopId,
    pulseId,
    session.user.personId,
  );
  // `noticeUrl`, never a hand-built string: it escapes the value and normalises
  // the code to kebab (src/lib/staff-notices.ts).
  if (!marked) redirect(noticeUrl(reviews, "error"));
  revalidateAndRedirect(reviews, noticeUrl(reviews, "pulse-addressed"));
}
