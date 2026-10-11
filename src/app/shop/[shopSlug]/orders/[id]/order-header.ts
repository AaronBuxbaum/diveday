import type { AppDb } from "@/db/client";
import { counterRentalTicketIdForOrder } from "@/db/gear-counter-rentals";
import { listOpenPaymentDisputes, type OpenPaymentDispute } from "@/db/payment-disputes";
import { canPersonViewShopReports } from "@/db/reporting";

/**
 * What the order header reads beyond the order row: the counter-rental ticket an invoice billed
 * for, and an undecided card dispute against it. Read by the page beside its own reads, so the
 * header's components only render (the page is the one place that reads).
 *
 * The dispute is withheld from anyone who may not read the shop's money — the same reader Today
 * shows the dispute row to, checked against live roles (ADR 20261009-stripe-reversals-reach-diveday).
 */
export async function loadOrderHeader(
  db: AppDb,
  input: { shopId: string; orderId: string; personId: string },
): Promise<{ rentalTicketId: string | null; dispute: OpenPaymentDispute | null }> {
  const [rentalTicketId, dispute] = await Promise.all([
    counterRentalTicketIdForOrder(db, input.shopId, input.orderId),
    (async () => {
      if (!(await canPersonViewShopReports(db, input.shopId, input.personId))) return null;
      const [open] = await listOpenPaymentDisputes(db, input.shopId, {
        orderId: input.orderId,
        limit: 1,
      });
      return open ?? null;
    })(),
  ]);
  return { rentalTicketId: rentalTicketId ?? null, dispute };
}
