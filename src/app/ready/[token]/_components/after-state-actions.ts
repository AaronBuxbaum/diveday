import { uploadRecapPhotoFromReadyAction } from "@/app/ready/[token]/recap-photo-actions";
import {
  startTipAction,
  submitRecapPulseAction,
  submitReviewAction,
} from "@/app/recap/[token]/actions";
import type { AfterStateProps } from "@/features/recap-after-state";
import { signRecapToken } from "@/lib/recap-links";

/**
 * **The after-state's four doors on `/ready`, bound.** Three verify a recap
 * token, never this page's own: `/ready`'s token can cancel the booking and
 * move its refund, and the two are domain-separated on purpose
 * (`src/lib/recap-links.ts`). The photo upload is the one exception, and the
 * one door that may share a photo with the boat: it verifies this page's own
 * readiness token (security review r5-4, F3).
 */
export function afterStateActions(token: string, bookingId: string): AfterStateProps["actions"] {
  const recapToken = signRecapToken(bookingId);
  return {
    submitReview: submitReviewAction.bind(null, recapToken),
    uploadPhoto: uploadRecapPhotoFromReadyAction.bind(null, token),
    startTip: startTipAction.bind(null, recapToken),
    submitPulse: submitRecapPulseAction.bind(null, recapToken),
  };
}
