import { eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { orders, stripeRefundFailures } from "@/db/schema";

/**
 * A refund Stripe accepted and later reported failed (issue #2291): the diver
 * is owed again, on the Orders index.
 */
export async function seedFailedRefund(db: AppDb, shopId: string, now: Date): Promise<void> {
  const [bouncedOrder] = await db
    .select({ id: orders.id, refundedCents: orders.refundedCents, currency: orders.currency })
    .from(orders)
    .where(eq(orders.shopId, shopId))
    .orderBy(orders.createdAt)
    .limit(1);
  if (bouncedOrder) {
    await db
      .insert(stripeRefundFailures)
      .values({
        shopId: shopId,
        stripeAccountId: "acct_e2e_bounced",
        stripeRefundId: "re_e2e_bounced",
        orderId: bouncedOrder.id,
        amountCents: 4_200,
        currency: bouncedOrder.currency,
        refundStatus: "failed",
        failureReason: "expired_or_canceled_card",
        owedUntilRefundedCents: bouncedOrder.refundedCents + 4_200,
        failedAt: now,
      })
      .onConflictDoNothing();
  }
}
