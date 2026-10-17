import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { PaymentSourceLookup } from "@/lib/payments/payment-sources";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { type DisputeEvent, listLostDisputes, recordStripeDispute } from "./payment-disputes";
import { getMonthMoneyDetail } from "./report-lines";
import { orders, people } from "./schema";

/**
 * A lost dispute is money the bank took back (issue #2292). Aaron, 2026-10-13:
 * on `charge.dispute.closed` with status `lost`, write a reversal line against
 * the order, idempotent on replay, shown on the order and in Reports. The
 * order's own balance stays what was paid; the reversal is its own line.
 */

const ctx = fileScopedShopContext();

const lookup: PaymentSourceLookup = {
  async findSource() {
    return { status: "none" };
  },
};

async function paidOrder(db: AppDb, shopId: string, paymentIntentId: string) {
  const [person] = await db.select().from(people).where(eq(people.shopId, shopId)).limit(1);
  if (!person) throw new Error("person missing");
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      personId: person.id,
      createdByPersonId: person.id,
      status: "paid",
      currency: "usd",
      totalCents: 12_000,
      amountPaidCents: 12_000,
      paidAt: new Date("2026-09-20T15:00:00.000Z"),
      stripeAccountId: "acct_lost",
      stripeCustomerId: "cus_lost",
      stripeInvoiceId: `in_${paymentIntentId}`,
      stripePaymentIntentId: paymentIntentId,
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  return order;
}

function closed(status: string, at: string, overrides: Partial<DisputeEvent["dispute"]> = {}) {
  return {
    stripeAccountId: "acct_lost",
    eventType: "charge.dispute.closed",
    occurredAt: new Date(at),
    dispute: {
      id: "dp_lost",
      paymentIntentId: "pi_lost",
      amountCents: 9_000,
      currency: "usd",
      reason: "fraudulent",
      status,
      evidenceDueBy: null,
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      ...overrides,
    },
  } satisfies DisputeEvent;
}

describe("a lost dispute", () => {
  it("writes a reversal line against the order and leaves what was paid alone", async () => {
    const { db, shop } = ctx;
    const order = await paidOrder(db, shop.id, "pi_lost");

    await recordStripeDispute(db, closed("lost", "2026-10-10T12:00:00.000Z"), lookup);

    expect(await listLostDisputes(db, shop.id, { orderId: order.id })).toEqual([
      expect.objectContaining({
        amountCents: 9_000,
        currency: "usd",
        orderId: order.id,
        reversedAt: new Date("2026-10-10T12:00:00.000Z"),
      }),
    ]);
    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after).toMatchObject({ status: "paid", amountPaidCents: 12_000, refundedCents: 0 });
  });

  it("writes one reversal however often the close is delivered, at the first close", async () => {
    const { db, shop } = ctx;
    const order = await paidOrder(db, shop.id, "pi_lost");
    await recordStripeDispute(db, closed("lost", "2026-10-10T12:00:00.000Z"), lookup);
    await recordStripeDispute(db, closed("lost", "2026-10-10T12:00:00.000Z"), lookup);
    await recordStripeDispute(db, closed("lost", "2026-10-11T12:00:00.000Z"), lookup);
    // An older update delivered late changes nothing.
    await recordStripeDispute(
      db,
      {
        ...closed("under_review", "2026-10-09T00:00:00.000Z"),
        eventType: "charge.dispute.updated",
      },
      lookup,
    );

    const lost = await listLostDisputes(db, shop.id, { orderId: order.id });
    expect(lost).toHaveLength(1);
    expect(lost[0]?.reversedAt).toEqual(new Date("2026-10-10T12:00:00.000Z"));
  });

  it("writes nothing for a dispute the shop won, or one still open", async () => {
    const { db, shop } = ctx;
    const order = await paidOrder(db, shop.id, "pi_lost");
    await recordStripeDispute(
      db,
      {
        ...closed("needs_response", "2026-10-02T00:00:00.000Z"),
        eventType: "charge.dispute.created",
      },
      lookup,
    );
    expect(await listLostDisputes(db, shop.id, { orderId: order.id })).toEqual([]);
    await recordStripeDispute(db, closed("won", "2026-10-10T12:00:00.000Z"), lookup);
    expect(await listLostDisputes(db, shop.id, { orderId: order.id })).toEqual([]);
  });

  it("is never read from another shop", async () => {
    const { db, shop } = ctx;
    const order = await paidOrder(db, shop.id, "pi_lost");
    await recordStripeDispute(db, closed("lost", "2026-10-10T12:00:00.000Z"), lookup);
    expect(
      await listLostDisputes(db, "99999999-8888-4777-8666-555555555555", { orderId: order.id }),
    ).toEqual([]);
  });

  it("is counted in Reports' money out in the month it was lost", async () => {
    const { db, shop } = ctx;
    await paidOrder(db, shop.id, "pi_lost");
    await recordStripeDispute(db, closed("lost", "2026-10-10T12:00:00.000Z"), lookup);
    const money = { currency: "usd", timeZone: "UTC" };
    const now = new Date("2026-11-15T00:00:00.000Z");

    const october = await getMonthMoneyDetail(
      db,
      shop.id,
      new Date("2026-10-01T00:00:00.000Z"),
      new Date("2026-11-01T00:00:00.000Z"),
      now,
      money,
    );
    const september = await getMonthMoneyDetail(
      db,
      shop.id,
      new Date("2026-09-01T00:00:00.000Z"),
      new Date("2026-10-01T00:00:00.000Z"),
      now,
      money,
    );
    expect(october.out.disputesLostCents).toBe(9_000);
    expect(september.out.disputesLostCents).toBe(0);
  });
});
