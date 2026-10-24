import { uploadRecapPhotoFromReadyAction } from "@/app/ready/[token]/recap-photo-actions";
import {
  startTipAction,
  submitRecapPulseAction,
  submitReviewAction,
  unshareRecapPhotoAction,
} from "@/app/recap/[token]/actions";
import { type AfterStateProps, buildAfterStateProps } from "@/features/recap-after-state";
import { signRecapToken } from "@/lib/recap-links";

/**
 * **The after-state's doors on `/ready`, bound.** All but one verify a recap
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
    unsharePhoto: unshareRecapPhotoAction.bind(null, recapToken),
    startTip: startTipAction.bind(null, recapToken),
    submitPulse: submitRecapPulseAction.bind(null, recapToken),
  };
}

/**
 * **The after-state on `/ready`**: the recap's own reader with this page's
 * doors, minting a handoff, and saying the diver's other seats only on a link
 * mailed to the contact on file (`delivered`; security review r5-4, second
 * pass, FIX 1). No notice params: each action redirects to `/recap/<token>`,
 * which reads them.
 */
export function readyAfterStateProps(
  input: Omit<Parameters<typeof buildAfterStateProps>[0], "mintHandoff" | "params" | "actions"> & {
    token: string;
  },
): Promise<AfterStateProps> {
  const { token, ...rest } = input;
  return buildAfterStateProps({
    ...rest,
    mintHandoff: true,
    params: {},
    actions: afterStateActions(token, input.bookingId),
  });
}
