import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { collectionShareCents } from "@/lib/collection-money";
import { isShopCurrency } from "@/lib/money";
import { fareCheckout } from "./checkout-purpose";
import type { DbExecutor } from "./client";
import { bookingCheckouts, bookings, collectionEntries, orders, paymentDisputes } from "./schema";

type Source = { shopId: string; sourceType: "order" | "checkout" | "booking"; sourceId: string };

/**
 * Record a source's chargeable balance under its source-row lock. Repeated
 * callbacks append nothing. Decreases reverse existing lots, newest first;
 * a refund can never create credit without money previously recorded received.
 * Every row is immutable. This function and the source change commit together.
 */
export async function recordCollectionBalance(
  db: DbExecutor,
  input: Source & {
    currency: string;
    method: string;
    balanceCents: number;
    restore?: boolean;
    collectedAt?: Date | null;
    evidence: Record<string, number | string | boolean | null>;
  },
): Promise<void> {
  if (
    !isShopCurrency(input.currency) ||
    !Number.isSafeInteger(input.balanceCents) ||
    input.balanceCents < 0
  ) {
    throw new Error("collection_ledger_invalid_money");
  }
  const table =
    input.sourceType === "order"
      ? orders
      : input.sourceType === "checkout"
        ? bookingCheckouts
        : bookings;
  const [source] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.shopId, input.shopId), eq(table.id, input.sourceId)))
    .for("update");
  if (!source) throw new Error("collection_ledger_source_missing");
  const entries = await db
    .select()
    .from(collectionEntries)
    .where(
      and(
        eq(collectionEntries.shopId, input.shopId),
        eq(collectionEntries.sourceType, input.sourceType),
        eq(collectionEntries.sourceId, input.sourceId),
      ),
    )
    .orderBy(asc(collectionEntries.id));
  if (entries.some((entry) => entry.currency !== input.currency))
    throw new Error("collection_ledger_currency_changed");
  if (input.restore && entries.length === 0) return;
  const previous = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
  const delta = input.balanceCents - previous;
  if (delta === 0) return;
  const common = {
    shopId: input.shopId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    currency: input.currency,
    method: input.method,
    evidence: input.evidence,
    recordedAt: nowDate(),
  };
  if (delta > 0) {
    let remaining = delta;
    if (input.restore) {
      for (const reversal of entries.filter((entry) => entry.amountCents < 0).reverse()) {
        const restored = entries
          .filter((entry) => entry.reversesEntryId === reversal.id)
          .reduce((sum, entry) => sum + entry.amountCents, 0);
        const taken = Math.min(remaining, -reversal.amountCents - restored);
        if (taken <= 0) continue;
        await db
          .insert(collectionEntries)
          .values({ ...common, amountCents: taken, reversesEntryId: reversal.id });
        remaining -= taken;
        if (remaining === 0) return;
      }
      throw new Error("collection_ledger_restore_exceeds_reversed");
    }
    await db.insert(collectionEntries).values({
      ...common,
      amountCents: remaining,
      recordedAt:
        entries.length === 0 ? (input.collectedAt ?? common.recordedAt) : common.recordedAt,
    });
    return;
  }
  let remaining = -delta;
  for (const lot of entries
    .filter((entry) => entry.amountCents > 0 && entry.reversesEntryId === null)
    .reverse()) {
    const reversals = entries.filter((entry) => entry.reversesEntryId === lot.id);
    const held =
      lot.amountCents +
      reversals.reduce((sum, entry) => sum + entry.amountCents, 0) +
      entries
        .filter((entry) => reversals.some((reversal) => entry.reversesEntryId === reversal.id))
        .reduce((sum, entry) => sum + entry.amountCents, 0);
    const reversed = Math.min(remaining, held);
    if (reversed <= 0) continue;
    await db
      .insert(collectionEntries)
      .values({ ...common, amountCents: -reversed, reversesEntryId: lot.id });
    remaining -= reversed;
    if (remaining === 0) return;
  }
  throw new Error("collection_ledger_reversal_exceeds_received");
}

/** An order is the economic receipt, including cash and other external methods. */
export async function recordOrderCollection(
  db: DbExecutor,
  shopId: string,
  orderId: string,
  restore = false,
): Promise<void> {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.shopId, shopId), eq(orders.id, orderId)))
    .for("update");
  if (!order) throw new Error("collection_ledger_source_missing");
  const [first] = await db
    .select({ evidence: collectionEntries.evidence })
    .from(collectionEntries)
    .where(
      and(
        eq(collectionEntries.shopId, shopId),
        eq(collectionEntries.sourceType, "order"),
        eq(collectionEntries.sourceId, orderId),
      ),
    )
    .orderBy(asc(collectionEntries.id))
    .limit(1);
  const originalTax = Number(
    order.counterReceipt?.taxCents ?? first?.evidence.originalTaxCents ?? order.taxCents,
  );
  const originalPassThrough = Number(
    order.counterReceipt?.passThroughCents ??
      first?.evidence.originalPassThroughCents ??
      order.passThroughCents,
  );
  const [lost] = await db
    .select({ cents: sql<string>`coalesce(sum(${paymentDisputes.amountCents}), 0)` })
    .from(paymentDisputes)
    .where(
      and(
        eq(paymentDisputes.shopId, shopId),
        eq(paymentDisputes.orderId, orderId),
        eq(paymentDisputes.currency, order.currency),
        isNotNull(paymentDisputes.reversedAt),
      ),
    );
  const held = ["void", "refunded"].includes(order.status)
    ? 0
    : Math.max(0, order.amountPaidCents - Number(lost?.cents ?? 0));
  const originalTip = Number(
    order.counterReceipt?.tipCents ?? first?.evidence.originalTipCents ?? order.tipCents,
  );
  const originalBasis = Math.max(
    0,
    order.totalCents - originalTax - originalPassThrough - originalTip,
  );
  const balanceCents =
    order.totalCents > 0 ? collectionShareCents(held, originalBasis, order.totalCents) : 0;
  await recordCollectionBalance(db, {
    shopId,
    sourceType: "order",
    sourceId: orderId,
    currency: order.currency,
    method: order.collection,
    restore,
    balanceCents,
    evidence: {
      grossHeldCents: held,
      originalTaxCents: originalTax,
      originalTipCents: originalTip,
      originalPassThroughCents: originalPassThrough,
      refundedCents: order.refundedCents,
      taxSplitRecorded:
        order.counterReceipt?.taxKnown ??
        (order.collection === "stripe_invoice" || originalTax > 0),
    },
  });
}

/** Exact Stripe-settled amounts only. Quotes and package redemptions are never receipts. */
export async function recordCheckoutCollection(
  db: DbExecutor,
  shopId: string,
  checkoutId: string,
  restore = false,
): Promise<void> {
  const [checkout] = await db
    .select()
    .from(bookingCheckouts)
    .where(
      and(eq(bookingCheckouts.shopId, shopId), eq(bookingCheckouts.id, checkoutId), fareCheckout()),
    )
    .for("update");
  if (!checkout || checkout.purpose === "tip" || checkout.collectionNeedsReview) return;
  const gross =
    checkout.status === "completed" ? checkout.settledTotalCents : checkout.paidAfterCloseCents;
  if (gross === null || (checkout.taxEnabled && checkout.taxCents === null)) return;
  // Stripe's guarded coupon discounts only the shop's fare/gear, never the
  // recorded pass-through levy. Keep that levy whole after a discount.
  const net = Math.max(0, gross - (checkout.taxCents ?? 0));
  const basis = Math.max(0, net - checkout.passThroughCents);
  const [lost] = await db
    .select({ cents: sql<string>`coalesce(sum(${paymentDisputes.amountCents}), 0)` })
    .from(paymentDisputes)
    .where(
      and(
        eq(paymentDisputes.shopId, shopId),
        eq(paymentDisputes.checkoutId, checkoutId),
        eq(paymentDisputes.currency, checkout.currency),
        isNotNull(paymentDisputes.reversedAt),
      ),
    );
  const kept =
    gross > 0 ? Math.max(0, gross - checkout.refundedCents - Number(lost?.cents ?? 0)) : 0;
  const balanceCents = gross > 0 ? collectionShareCents(basis, kept, gross) : 0;
  await recordCollectionBalance(db, {
    shopId,
    sourceType: "checkout",
    sourceId: checkoutId,
    currency: checkout.currency,
    method: "stripe",
    restore,
    collectedAt: checkout.status === "completed" ? checkout.completedAt : checkout.paidAfterCloseAt,
    balanceCents,
    evidence: {
      grossReceivedCents: gross,
      taxCents: checkout.taxCents ?? 0,
      passThroughCents: net - basis,
      refundedCents: checkout.refundedCents,
    },
  });
}
