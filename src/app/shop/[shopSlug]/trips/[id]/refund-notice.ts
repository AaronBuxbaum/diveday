import type { CancellationRefundOutcome } from "@/db/refunds";

/**
 * What a removed booking's refund outcome is called in the URL.
 *
 * A table rather than the `switch` with a `default:` this replaces: the default
 * arm answered for `no_policy` and `unpaid` by name in a comment, and would have
 * silently answered for any status added later too. Keyed by the union, so a
 * seventh outcome is a compile error here instead of an unexplained "spot is
 * open" banner on a refund a shop is owed.
 */
const REFUND_NOTICE: Record<CancellationRefundOutcome["status"], string> = {
  refunded: "booking-removed-refunded",
  forfeit: "booking-removed-forfeit",
  failed: "booking-removed-refund-failed",
  manual: "booking-removed-refund-manual",
  // The booking-level refund lock's two refusals. Neither is `failed`: nothing
  // is wrong at Stripe, and pressing again is precisely what must not happen.
  in_progress: "booking-removed-refund-in-progress",
  needs_reconciliation: "booking-removed-refund-reconcile",
  // Nothing owed either way — today's plain "spot is open" notice.
  no_policy: "booking-removed",
  unpaid: "booking-removed",
};

export function refundNotice(refund: CancellationRefundOutcome): string {
  // `not_refundable` is a data mismatch (local row says paid, Stripe captured
  // nothing) — a "review", not the "refund owed by hand" claim the
  // counter/disconnected cases make. The only refusal whose code depends on
  // more than the status.
  if (refund.status === "manual" && refund.reason === "not_refundable") {
    return "booking-removed-refund-review";
  }
  // The desk turned this diver away before the seat was removed: no window
  // applied and nothing moved on its own (layer 3 review, dde-2 #2).
  if (refund.status === "manual" && refund.reason === "turned_away") {
    return "booking-removed-turned-away";
  }
  return REFUND_NOTICE[refund.status];
}
