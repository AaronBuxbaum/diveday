import type { AppDb } from "@/db/client";
import { recordShopActivity } from "@/db/shop-activity";
import { dispatchIntegrationsAfterResponse } from "@/features/integrations";

/**
 * What follows a staff refund that actually moved money.
 *
 * The activity log's line first (D5): the order and the payment trail record
 * what moved, and nothing recorded *who* moved it until the log asked. Then
 * the integrations outbox, which only a real refund enqueues (`order.refunded`)
 * — the other outcomes wrote no event and have nothing to drain.
 */
export async function afterOrderRefunded(
  db: AppDb,
  staff: { shopId: string; personId: string },
  orderId: string,
): Promise<void> {
  await recordShopActivity(db, {
    shopId: staff.shopId,
    actorPersonId: staff.personId,
    write: { code: "order_refunded", orderId },
  });
  dispatchIntegrationsAfterResponse();
}
