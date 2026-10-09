import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { PaymentSourceLookup } from "@/lib/payments/payment-sources";
import { seededShopContext } from "@/test/db";
import { bookings, orders, people, tips } from "./schema";
import {
  findStripePaymentTarget,
  PaymentSourceLookupFailed,
  recordTipPaymentIntent,
} from "./stripe-payment-targets";

/** A paid invoiced order on `acct_demo`, with no PaymentIntent recorded yet. */
async function seededOrder() {
  const { db, shop } = await seededShopContext();
  const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
  if (!person) throw new Error("seeded person missing");
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      personId: person.id,
      createdByPersonId: person.id,
      status: "paid",
      currency: "usd",
      totalCents: 10_000,
      amountPaidCents: 10_000,
      stripeAccountId: "acct_demo",
      stripeCustomerId: "cus_demo",
      stripeInvoiceId: "in_demo_target",
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  // The Stripe ids as inserted, typed as present: this is an invoiced order.
  return {
    db,
    shop,
    order: { ...order, stripeAccountId: "acct_demo", stripeInvoiceId: "in_demo_target" },
  };
}

function lookupAnswering(answer: Awaited<ReturnType<PaymentSourceLookup["findSource"]>>) {
  const calls: Array<[string, string]> = [];
  const lookup: PaymentSourceLookup = {
    async findSource(account, pi) {
      calls.push([account, pi]);
      return answer;
    },
  };
  return { lookup, calls };
}

describe("findStripePaymentTarget", () => {
  it("asks Stripe once, then remembers the answer on the order", async () => {
    const { db, order } = await seededOrder();
    const { lookup, calls } = lookupAnswering({
      status: "invoice",
      stripeInvoiceId: order.stripeInvoiceId,
    });

    const first = await findStripePaymentTarget(
      db,
      { stripeAccountId: order.stripeAccountId, paymentIntentId: "pi_looked_up" },
      lookup,
    );
    expect(first).toMatchObject({ kind: "order", order: { id: order.id } });
    expect(calls).toEqual([[order.stripeAccountId, "pi_looked_up"]]);

    const second = await findStripePaymentTarget(
      db,
      { stripeAccountId: order.stripeAccountId, paymentIntentId: "pi_looked_up" },
      lookup,
    );
    expect(second).toMatchObject({ kind: "order", order: { id: order.id } });
    expect(calls).toHaveLength(1);
  });

  it("never matches a row on another connected account, even by its own PaymentIntent", async () => {
    const { db, order } = await seededOrder();
    await db
      .update(orders)
      .set({ stripePaymentIntentId: "pi_theirs" })
      .where(eq(orders.id, order.id));
    // Stripe, asked on the foreign account, names the same invoice id.
    const { lookup } = lookupAnswering({
      status: "invoice",
      stripeInvoiceId: order.stripeInvoiceId,
    });
    expect(
      await findStripePaymentTarget(
        db,
        { stripeAccountId: "acct_intruder", paymentIntentId: "pi_theirs" },
        lookup,
      ),
    ).toEqual({ kind: "none" });
  });

  it("answers none for a charge DiveDay never raised", async () => {
    const { db } = await seededShopContext();
    const { lookup } = lookupAnswering({ status: "none" });
    expect(
      await findStripePaymentTarget(
        db,
        { stripeAccountId: "acct_demo", paymentIntentId: "pi_x" },
        lookup,
      ),
    ).toEqual({ kind: "none" });
  });

  it("throws when Stripe cannot be asked, so the webhook is retried rather than dropped", async () => {
    const { db } = await seededShopContext();
    const { lookup } = lookupAnswering({ status: "failed" });
    await expect(
      findStripePaymentTarget(
        db,
        { stripeAccountId: "acct_demo", paymentIntentId: "pi_x" },
        lookup,
      ),
    ).rejects.toBeInstanceOf(PaymentSourceLookupFailed);
  });

  it("knows a tip's charge for what it is, and never asks Stripe about it", async () => {
    const { db, shop } = await seededShopContext();
    const [booking] = await db.select().from(bookings).where(eq(bookings.shopId, shop.id)).limit(1);
    if (!booking) throw new Error("seeded booking missing");
    await db.insert(tips).values({
      shopId: shop.id,
      bookingId: booking.id,
      status: "paid",
      stripeAccountId: "acct_demo",
      stripeSessionId: "cs_tip_target",
      currency: "usd",
      amountCents: 2_000,
    });
    expect(
      await recordTipPaymentIntent(db, {
        stripeSessionId: "cs_tip_target",
        paymentIntentId: "pi_tip",
        expectedAccountId: "acct_demo",
      }),
    ).toBe(true);
    const { lookup, calls } = lookupAnswering({ status: "failed" });

    expect(
      await findStripePaymentTarget(
        db,
        { stripeAccountId: "acct_demo", paymentIntentId: "pi_tip" },
        lookup,
      ),
    ).toEqual({ kind: "none" });
    expect(calls).toEqual([]);
  });

  it("remembers a tip Stripe names, so the next event is local", async () => {
    const { db, shop } = await seededShopContext();
    const [booking] = await db.select().from(bookings).where(eq(bookings.shopId, shop.id)).limit(1);
    if (!booking) throw new Error("seeded booking missing");
    await db.insert(tips).values({
      shopId: shop.id,
      bookingId: booking.id,
      status: "paid",
      stripeAccountId: "acct_demo",
      stripeSessionId: "cs_tip_named",
      currency: "usd",
      amountCents: 2_000,
    });
    const { lookup, calls } = lookupAnswering({
      status: "checkout_session",
      stripeSessionId: "cs_tip_named",
    });
    const input = { stripeAccountId: "acct_demo", paymentIntentId: "pi_tip_named" };
    expect(await findStripePaymentTarget(db, input, lookup)).toEqual({ kind: "none" });
    expect(await findStripePaymentTarget(db, input, lookup)).toEqual({ kind: "none" });
    expect(calls).toHaveLength(1);
  });
});
