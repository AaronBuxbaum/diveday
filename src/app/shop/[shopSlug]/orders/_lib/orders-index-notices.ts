import type { NoticeTone } from "@/components/ui/tone";
import type { StaffMessageKey } from "@/i18n/staff-messages";

export const ORDERS_INDEX_NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "local-order-invalid": { tone: "danger", key: "orders.localDue.invalid" },
  "purchase-refund-invalid": { tone: "danger", key: "orders.purchase.refundInvalid" },
  "payment-not-connected": { tone: "warning", key: "orders.index.notice.paymentNotConnected" },
  "not-authorized": { tone: "danger", key: "orders.index.notice.notAuthorized" },
  "not-authorized-refund": { tone: "danger", key: "orders.index.notice.notAuthorizedRefund" },
  "paid-after-close-refunded": {
    tone: "success",
    key: "orders.index.notice.paidAfterCloseRefunded",
  },
  "paid-after-close-in-progress": {
    tone: "neutral",
    key: "orders.index.notice.paidAfterCloseInProgress",
  },
  "paid-after-close-needs-check": {
    tone: "warning",
    key: "orders.index.notice.paidAfterCloseNeedsCheck",
  },
  "paid-after-close-not-connected": {
    tone: "warning",
    key: "orders.index.notice.paidAfterCloseNotConnected",
  },
  "paid-after-close-failed": { tone: "danger", key: "orders.index.notice.paidAfterCloseFailed" },
  "stripe-refund-matched": { tone: "success", key: "orders.index.notice.stripeRefundMatched" },
  "stripe-refund-partly-matched": {
    tone: "neutral",
    key: "orders.index.notice.stripeRefundPartlyMatched",
  },
  "stripe-refund-not-matched": {
    tone: "warning",
    key: "orders.index.notice.stripeRefundNotMatched",
  },
};
