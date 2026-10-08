import type { AppDb } from "@/db/client";
import { sendWorkOrderReadyNotice } from "@/db/work-order-follow-up";
import { log } from "@/lib/log";

/**
 * Tell the customer, once, that the ticket just moved to ready (ADR
 * 20261008-work-order-follow-up). Called by the status move after it lands.
 *
 * A message that cannot go never undoes the move: the ticket is ready whether
 * or not the customer's inbox answered, and the ticket's own card says how
 * the message went and offers Resend. A throw here is logged and swallowed for
 * the same reason; the notice row it may have claimed reads as "not sent".
 */
export async function announceReady(
  db: AppDb,
  input: { shopId: string; workOrderId: string },
): Promise<void> {
  try {
    await sendWorkOrderReadyNotice(db, input);
  } catch {
    log("work_order.ready_notice_failed", "error", { workOrderId: input.workOrderId });
  }
}
