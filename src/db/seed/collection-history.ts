import { asc, eq } from "drizzle-orm";
import { collectionShareCents } from "@/lib/collection-money";
import type { DbExecutor } from "../client";
import { collectionEntries, orders } from "../schema";

/**
 * Orders are economic receipts; booking payment rows mirror them and are not a
 * second collection. Seed their original lots and linked refunds at the time
 * each actually happened, using the same proration as recordOrderCollection.
 */
export async function seedCollectionHistory(db: DbExecutor, shopId: string): Promise<void> {
  const receipts = await db
    .select()
    .from(orders)
    .where(eq(orders.shopId, shopId))
    .orderBy(asc(orders.createdAt));
  const lots: (typeof collectionEntries.$inferInsert)[] = [];
  const reversals = new Map<
    string,
    { amount: number; at: Date; evidence: Record<string, number | string | boolean | null> }
  >();
  for (const order of receipts) {
    const received = order.amountPaidCents + order.refundedCents;
    if (received <= 0 || order.totalCents <= 0) continue;
    const tax = order.counterReceipt?.taxCents ?? order.taxCents;
    const tip = order.counterReceipt?.tipCents ?? order.tipCents;
    const passThrough = order.counterReceipt?.passThroughCents ?? order.passThroughCents;
    const basis = Math.max(0, order.totalCents - tax - tip - passThrough);
    const initial = collectionShareCents(received, basis, order.totalCents);
    const held = order.status === "refunded" || order.status === "void" ? 0 : order.amountPaidCents;
    const remaining = collectionShareCents(held, basis, order.totalCents);
    if (!initial) continue;
    const evidence = {
      grossHeldCents: received,
      originalTaxCents: tax,
      originalTipCents: tip,
      originalPassThroughCents: passThrough,
      refundedCents: 0,
      taxSplitRecorded:
        order.counterReceipt?.taxKnown ?? (order.collection === "stripe_invoice" || tax > 0),
    };
    const collectedAt = order.paidAt ?? order.updatedAt;
    lots.push({
      shopId,
      sourceType: "order",
      sourceId: order.id,
      currency: order.currency,
      method: order.collection,
      amountCents: initial,
      evidence,
      recordedAt: collectedAt,
      createdAt: collectedAt,
    });
    if (initial > remaining) {
      const reversedAt = order.refundedAt ?? collectedAt;
      reversals.set(order.id, {
        amount: initial - remaining,
        at: reversedAt,
        evidence: { ...evidence, grossHeldCents: held, refundedCents: order.refundedCents },
      });
    }
  }
  if (!lots.length) return;
  const written = await db
    .insert(collectionEntries)
    .values(lots)
    .returning({ id: collectionEntries.id, sourceId: collectionEntries.sourceId });
  const returned = written.flatMap((lot) => {
    const reversal = reversals.get(lot.sourceId);
    const original = lots.find((entry) => entry.sourceId === lot.sourceId);
    if (!reversal || !original) return [];
    return [
      {
        shopId,
        sourceType: "order" as const,
        sourceId: lot.sourceId,
        currency: original.currency,
        method: original.method,
        amountCents: -reversal.amount,
        reversesEntryId: lot.id,
        evidence: reversal.evidence,
        recordedAt: reversal.at,
        createdAt: reversal.at,
      },
    ];
  });
  if (returned.length) await db.insert(collectionEntries).values(returned);
}
