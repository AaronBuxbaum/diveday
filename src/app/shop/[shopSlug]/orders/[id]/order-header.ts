import type { AppDb } from "@/db/client";
import { counterRentalTicketIdForOrder } from "@/db/gear-counter-rentals";
import {
  type LostPaymentDispute,
  listLostDisputes,
  listOpenPaymentDisputes,
  type OpenPaymentDispute,
} from "@/db/payment-disputes";
import { canPersonViewShopReports } from "@/db/reporting";

/**
 * What the order header reads beyond the order row: the counter-rental ticket an invoice billed
 * for, and an undecided card dispute against it. Read by the page beside its own reads, so the
 * header's components only render (the page is the one place that reads).
 *
 * The dispute is withheld from anyone who may not read the shop's money — the same reader Today
 * shows the dispute row to, checked against live roles (ADR 20261009-stripe-reversals-reach-diveday).
 * So are the reversal lines of disputes the shop lost (issue #2292).
 */
export async function loadOrderHeader(
  db: AppDb,
  input: { shopId: string; orderId: string; personId: string },
): Promise<{
  rentalTicketId: string | null;
  dispute: OpenPaymentDispute | null;
  lostDisputes: LostPaymentDispute[];
}> {
  const [rentalTicketId, disputes] = await Promise.all([
    counterRentalTicketIdForOrder(db, input.shopId, input.orderId),
    (async () => {
      if (!(await canPersonViewShopReports(db, input.shopId, input.personId))) {
        return { dispute: null, lostDisputes: [] };
      }
      const [[open], lostDisputes] = await Promise.all([
        listOpenPaymentDisputes(db, input.shopId, { orderId: input.orderId, limit: 1 }),
        listLostDisputes(db, input.shopId, { orderId: input.orderId }),
      ]);
      return { dispute: open ?? null, lostDisputes };
    })(),
  ]);
  return { rentalTicketId: rentalTicketId ?? null, ...disputes };
}
