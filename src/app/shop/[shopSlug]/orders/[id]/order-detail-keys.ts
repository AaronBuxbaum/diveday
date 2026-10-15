import type { RecordPaymentOnOrderOutcome } from "@/db/orders";
import type { OrderStatus } from "@/db/schema";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import type { NoticeTone } from "@/lib/staff-notices";

/** The order detail page's words, by key: its status, its line kinds, its notices. */

/**
 * Keyed by the enum rather than by `string`, so a status added to the column
 * is a compile error here instead of a page rendering the raw value.
 *
 * It was `Record<string, …>` until `partly_refunded` arrived and this heading
 * read literally "partly_refunded" to the shop (issue #699) — the lookup falls
 * through to the enum value, which looks like data and reads like a bug. The
 * sibling map on the Orders index and `ORDER_STATUS_KEYS` in
 * `src/i18n/order-labels.ts` are the same shape for the same reason.
 */
export const STATUS_KEYS: Record<OrderStatus, StaffMessageKey> = {
  open: "orders.detail.status.open",
  paid: "orders.detail.status.paid",
  void: "orders.detail.status.void",
  uncollectible: "orders.detail.status.uncollectible",
  partly_refunded: "orders.detail.status.partlyRefunded",
  refunded: "orders.detail.status.refunded",
};

export const KIND_KEYS: Record<string, StaffMessageKey> = {
  trip_fee: "orders.detail.kind.trip_fee",
  course_fee: "orders.detail.kind.course_fee",
  rental: "orders.detail.kind.rental",
  nitrox: "orders.detail.kind.nitrox",
  deposit: "orders.detail.kind.deposit",
  merchandise: "orders.detail.kind.merchandise",
  other: "orders.detail.kind.other",
};

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
export const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  refreshed: { tone: "success", key: "orders.detail.notice.refreshed" },
  "refresh-failed": { tone: "danger", key: "orders.detail.notice.refreshFailed" },
  voided: { tone: "success", key: "orders.detail.notice.voided" },
  "void-failed": { tone: "danger", key: "orders.detail.notice.voidFailed" },
  "void-not-authorized": { tone: "danger", key: "orders.detail.notice.voidNotAuthorized" },
  refunded: { tone: "success", key: "orders.detail.notice.refunded" },
  "partly-refunded": { tone: "success", key: "orders.detail.notice.partlyRefunded" },
  "refund-invalid-amount": { tone: "danger", key: "orders.detail.notice.refundInvalidAmount" },
  "refund-failed": { tone: "danger", key: "orders.detail.notice.refundFailed" },
  "refund-in-progress": { tone: "warning", key: "orders.detail.notice.refundInProgress" },
  "refund-needs-reconciliation": {
    tone: "warning",
    key: "orders.detail.notice.refundNeedsReconciliation",
  },
  "not-authorized": { tone: "danger", key: "orders.detail.notice.notAuthorized" },
  "demo-disabled": { tone: "neutral", key: "orders.detail.notice.demoDisabled" },
  "payment-recorded": { tone: "success", key: "orders.detail.notice.paymentRecorded" },
  "payment-stripe-refused": { tone: "warning", key: "orders.detail.notice.paymentStripeRefused" },
  "payment-record-failed": { tone: "danger", key: "orders.detail.notice.paymentRecordFailed" },
  // Another tap's claim is still with Stripe, or Stripe never answered this
  // one: either way the money may already be recorded, so not a failure.
  "payment-in-flight": { tone: "warning", key: "orders.detail.notice.paymentInFlight" },
};

/** The `?notice=` code a Record payment outcome redirects with. */
export function recordPaymentNotice(outcome: RecordPaymentOnOrderOutcome | null): string {
  if (outcome?.ok) return "payment-recorded";
  switch (outcome?.reason) {
    case "stripe_refused":
      return "payment-stripe-refused";
    case "stripe_unknown":
    case "claim_held":
      return "payment-in-flight";
    default:
      return "payment-record-failed";
  }
}
