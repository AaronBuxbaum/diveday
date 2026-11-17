import type { AppDb } from "./client";
import { applyInvoicePaid } from "./orders";
import type { orders } from "./schema";

type Order = typeof orders.$inferSelect;

/**
 * {@link applyInvoicePaid} for a caller that wants the order: the row as it
 * now stands, or null when no order here holds the invoice or the event must
 * wait.
 */
export async function markOrderPaidByInvoiceId(
  db: AppDb,
  stripeInvoiceId: string,
  amountPaidCents: number,
  expectedAccountId?: string,
  taxCents?: number | null,
): Promise<Order | null> {
  const outcome = await applyInvoicePaid(db, {
    stripeInvoiceId,
    amountPaidCents,
    expectedAccountId,
    taxCents,
  });
  return outcome.status === "settled" || outcome.status === "counter" ? outcome.order : null;
}
