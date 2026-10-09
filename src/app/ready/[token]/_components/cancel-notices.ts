import type { ReadyPageData } from "@/db/ready";
import type { DiverMessageKey } from "@/i18n/messages";

/**
 * What to tell a diver whose seat is gone about money they had already paid —
 * derived from the booking's own current payment status and nothing else. It has
 * never been read off the query string: `?cancelled=1` is a trigger telling the
 * page to look, so a hand-edited URL can neither claim a refund that did not
 * happen nor hide one that did.
 *
 * This collapses several distinct non-refund outcomes (past the free-
 * cancellation window, no stated window, a failed/manual Stripe reversal) into
 * one honest "still paid, shop handles it" message, since none of those
 * specific reasons survive as durable state to verify against — only whether
 * the payment row currently reads `refunded` or still `paid`/`deposit_paid`
 * does.
 */
export function verifiedCancelNotice(
  paymentStatus: string | null | undefined,
): DiverMessageKey | null {
  if (paymentStatus === "refunded") return "ready.refundIssued";
  if (paymentStatus === "paid" || paymentStatus === "deposit_paid") return "ready.refundManual";
  return null;
}

/**
 * What cancelling right now would mean for money already paid. This is the one
 * consequence the button cannot show on its own, which is why it is the only
 * sentence beside it — a diver past the free-cancellation window learning that
 * *after* the irreversible tap is the failure this exists to prevent.
 */
export const CANCEL_PREVIEW_KEY: Record<ReadyPageData["cancelPreview"], DiverMessageKey | null> = {
  refund: "ready.cancelPreviewRefund",
  forfeit: "ready.cancelPreviewForfeit",
  no_policy: "ready.cancelPreviewNoPolicy",
  unpaid: null,
};
