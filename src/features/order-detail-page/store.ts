import { getOrderBookingContext } from "@/features/order-booking";
import { loadOrderHeader } from "@/features/order-header";
import { purchaseRefundHistory } from "@/features/recorded-purchases";
import {
  canPersonExportDisputeSheet,
  canPersonManageOrders,
  canPersonRefund,
} from "../../db/authz";
import type { AppDb } from "../../db/client";
import { getOrder, isVoidableCounterOrder } from "../../db/orders";

export { pendingCounterPayment } from "../../db/counter-payment-hold";
export { isStaleCounterClaim } from "../../db/orders";

/**
 * The order page's question in one call: the order, what this person may do
 * to it, its header (rental ticket and disputes), and the departure a deposit
 * or trip fee was raised for. Null when the order is not this shop's.
 *
 * Refunds are owner/manager only (H-20260724-staff-role-reach); the dispute
 * sheet needs a seat to describe, so an order raised for none has no door to
 * it; and a counter collection is voidable by whoever manages orders.
 */
export async function getOrderDetailPage(
  db: AppDb,
  shopId: string,
  orderId: string,
  personId: string,
) {
  const order = await getOrder(db, shopId, orderId);
  if (!order) return null;
  const { bookingId } = order.order;
  const [refund, disputeSheet, voidCounter, header, booking, purchaseRefunds] = await Promise.all([
    canPersonRefund(db, shopId, personId),
    bookingId ? canPersonExportDisputeSheet(db, shopId, personId) : false,
    isVoidableCounterOrder(order.order) ? canPersonManageOrders(db, shopId, personId) : false,
    loadOrderHeader(db, { shopId, orderId: order.order.id, personId }),
    bookingId ? getOrderBookingContext(db, shopId, bookingId) : null,
    order.order.counterReceipt ? purchaseRefundHistory(db, shopId, orderId) : [],
  ]);
  return { order, purchaseRefunds, can: { refund, disputeSheet, voidCounter }, header, booking };
}
