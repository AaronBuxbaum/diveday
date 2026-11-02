import type { AfterStateProps } from "@/features/recap-after-state";
import type { DiverMessageKey } from "@/i18n/messages";
import { noticeFromParam } from "@/lib/staff-notices";

/**
 * Notice keys, not sentences — the query string names an outcome and the page
 * says it in the diver's own language (ADR 20260729-diver-copy-localization).
 */
const PHOTO_NOTICES: Record<string, { tone: "success" | "danger"; key: DiverMessageKey }> = {
  added: { tone: "success", key: "recap.photoAdded" },
  unshared: { tone: "success", key: "recap.photoUnshared" },
  none: { tone: "danger", key: "recap.photoMissing" },
  limit: { tone: "danger", key: "recap.photoLimit" },
  unconfigured: { tone: "danger", key: "recap.photoUnsupported" },
  // A cancelled or no-show booking, not a bad file — "try a JPEG under 5 MB"
  // would be a lie about what actually went wrong (task 56).
  cancelled: { tone: "danger", key: "recap.photoCancelled" },
  error: { tone: "danger", key: "recap.photoFailed" },
};

const REVIEW_NOTICES: Record<string, { tone: "success" | "danger"; key: DiverMessageKey }> = {
  published: { tone: "success", key: "reviews.savedPublished" },
  pending: { tone: "success", key: "reviews.savedPending" },
  // A no-show/cancelled booking never dived — "pick a rating and try again"
  // would send them in a loop that can never succeed (task 56).
  did_not_dive: { tone: "danger", key: "reviews.savedDidNotDive" },
  error: { tone: "danger", key: "reviews.savedError" },
};

const TIP_NOTICES: Record<string, { tone: "success" | "danger"; key: DiverMessageKey }> = {
  paid: { tone: "success", key: "recap.tipThanksNotice" },
  cancelled: { tone: "danger", key: "recap.tipCancelled" },
  invalid: { tone: "danger", key: "recap.tipRange" },
  error: { tone: "danger", key: "recap.tipFailed" },
};

/**
 * What the after-dive page says about the form the diver just sent, read from its own redirect.
 *
 * `noticeFromParam`, never a bare `REVIEW_NOTICES[params.review]` — all three params are
 * attacker-supplied and a bare lookup walks the prototype (src/lib/staff-notices.ts).
 *
 * One review ask, not two: the "share it on Google too" door only lights up right after an
 * on-page submission went through, and while it is lit the form's own submit steps back to
 * secondary. One spelling of that state, so the two can never disagree about which is the
 * page's primary.
 *
 * **Every rating, never only the good ones** (issue #2095). Offering the public review link only
 * to a diver who rated 4–5★ is review gating, which Google's review policy forbids; a one-star
 * diver gets the same door.
 */
export function afterNotices(
  params: AfterStateProps["params"],
  ownReview: AfterStateProps["ownReview"],
  reviewUrl: AfterStateProps["shop"]["reviewUrl"],
) {
  const justSubmittedReview =
    (params.review === "published" || params.review === "pending") && ownReview !== null;
  return {
    reviewNotice: noticeFromParam(params.review, REVIEW_NOTICES),
    photoNotice: noticeFromParam(params.photo, PHOTO_NOTICES),
    tipNotice: noticeFromParam(params.tip, TIP_NOTICES),
    externalReviewUrl: justSubmittedReview ? reviewUrl : null,
  };
}
