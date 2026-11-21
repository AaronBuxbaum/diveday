import type { DbExecutor } from "../client";
import { orderLineItems, orders, type people } from "../schema";
import { at } from "./clock";

/** Ordinary walk-in and named counter purchases, recorded locally, not invoices. */
export async function seedCounterReceipts(
  db: DbExecutor,
  shopId: string,
  actorId: string,
  customers: (typeof people.$inferSelect)[],
): Promise<void> {
  const plans = [
    {
      personId: null,
      collection: "cash" as const,
      description: "Walk-in mask and defog",
      total: 5_375,
      tax: 375,
      tip: 0,
      days: 6,
      reference: "C-184",
      line: "Mask and defog",
    },
    {
      personId: customers[8]?.id ?? null,
      collection: "card_machine" as const,
      description: "Rental and crew gratuity",
      total: 9_600,
      tax: 600,
      tip: 1_000,
      days: 11,
      reference: "T-442",
      line: "Rental kit and gratuity",
    },
    {
      personId: customers[12]?.id ?? null,
      collection: "cash" as const,
      description: "Reef-safe sunscreen",
      total: 2_150,
      tax: 150,
      tip: 0,
      days: 15,
      reference: "C-153",
      line: "Sunscreen",
    },
  ];
  const receipts = await db
    .insert(orders)
    .values(
      plans.map((plan) => {
        const paidAt = at(-plan.days, 14);
        return {
          shopId,
          personId: plan.personId,
          createdByPersonId: actorId,
          status: "paid" as const,
          collection: plan.collection,
          currency: "usd",
          totalCents: plan.total,
          amountPaidCents: plan.total,
          taxCents: plan.tax,
          tipCents: plan.tip,
          counterReceipt: {
            taxCents: plan.tax,
            taxKnown: true,
            tipCents: plan.tip,
            passThroughCents: 0,
            reference: plan.reference,
          },
          description: plan.description,
          finalizedAt: paidAt,
          paidAt,
          createdAt: paidAt,
          updatedAt: paidAt,
        };
      }),
    )
    .returning({ id: orders.id });
  await db.insert(orderLineItems).values(
    receipts.map((receipt, index) => {
      const plan = plans[index];
      if (!plan) throw new Error("seed: missing counter receipt plan");
      return {
        shopId,
        orderId: receipt.id,
        kind: index === 1 ? ("rental" as const) : ("merchandise" as const),
        description: plan.line,
        quantity: 1,
        unitAmountCents: plan.total,
        createdAt: at(-plan.days, 14),
      };
    }),
  );
}
