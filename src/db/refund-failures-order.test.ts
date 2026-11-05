import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import type { InvoicingProvider } from "@/lib/payments/invoicing";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import {
  createOrder,
  markOrderPaidByInvoiceId,
  recordOrderPaymentIntent,
  refundOrder,
} from "./orders";
import { recordStripeRefundFailure } from "./refund-failures";
import { recordStripeChargeRefund } from "./refunds";
import { orders } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

/**
 * **A fare's refund history does not depend on webhook order** (issue #3835,
 * the fare half; the tip half is `tip-reversals-order.test.ts`). A
 * `charge.refunded` stamped before a refund failure the order has since
 * recorded still counts the refund that failed; delivered late, it must not
 * put that refund back on the books.
 */
const ctx = fileScopedShopContext();
const MINUTE = 60_000;

function invoicing(refundId: string): InvoicingProvider {
  return {
    async createInvoice(request) {
      return {
        status: "created",
        stripeCustomerId: "cus_order",
        stripeInvoiceId: "in_order_late",
        stripeStatus: "open",
        hostedInvoiceUrl: null,
        invoicePdfUrl: null,
        totalCents: request.lineItems.reduce((s, i) => s + i.quantity * i.unitAmountCents, 0),
        taxCents: 0,
      };
    },
    async markInvoicePaidOutOfBand() {
      return { status: "paid" as const };
    },
    async voidInvoice() {
      return { status: "voided" };
    },
    async refundInvoice() {
      return { status: "refunded", refundId };
    },
    async retrieveInvoice() {
      return { status: "failed" };
    },
    async resendInvoice() {
      return { status: "sent" };
    },
  };
}

async function paidOrder() {
  const { db, shop } = ctx;
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((t) =>
    t.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!reef) throw new Error("demo reef trip missing");
  const [entry] = await getTripRoster(db, shop.id, reef.id);
  if (!entry) throw new Error("demo booking missing");
  const created = await createOrder(
    db,
    {
      shopId: shop.id,
      personId: entry.person.id,
      createdByPersonId: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
      bookingId: entry.booking.id,
      lineItems: [
        { kind: "trip_fee", description: "Two-tank charter", quantity: 1, unitAmountCents: 20_000 },
      ],
    },
    invoicing("re_late"),
  );
  if (!created.ok) throw new Error("order creation failed");
  const invoiceId = created.order.stripeInvoiceId ?? "";
  await markOrderPaidByInvoiceId(db, invoiceId, 20_000, "acct_test");
  await recordOrderPaymentIntent(db, {
    stripeInvoiceId: invoiceId,
    paymentIntentId: "pi_order_late",
    expectedAccountId: "acct_test",
  });
  return { db, shop, order: created.order };
}

describe("a fare refund event delivered after its failure", () => {
  it("does not put a failed refund back on the order", async () => {
    const { db, shop, order } = await paidOrder();
    expect((await refundOrder(db, shop.id, order.id, invoicing("re_late"))).status).toBe(
      "refunded",
    );
    const refundedAt = new Date(nowDate().getTime() - 10 * MINUTE);
    await recordStripeRefundFailure(db, {
      stripeAccountId: "acct_test",
      paymentIntentId: "pi_order_late",
      refund: {
        id: "re_late",
        amountCents: 20_000,
        currency: "usd",
        status: "failed",
        failureReason: "expired_or_canceled_card",
      },
      occurredAt: nowDate(),
    });

    // The refund's own event, stamped before the failure, arrives last: its
    // running total still counts the refund that failed.
    const late = await recordStripeChargeRefund(db, {
      stripeAccountId: "acct_test",
      paymentIntentId: "pi_order_late",
      amountRefundedCents: 20_000,
      chargeId: "ch_order_late",
      occurredAt: refundedAt,
    });

    expect(late.status).toBe("already_recorded");
    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after).toMatchObject({ status: "paid", amountPaidCents: 20_000, refundedCents: 0 });
  });

  it("still counts a new refund made after the failure", async () => {
    const { db, shop, order } = await paidOrder();
    await refundOrder(db, shop.id, order.id, invoicing("re_late"));
    const failedAt = new Date(nowDate().getTime() - 10 * MINUTE);
    await recordStripeRefundFailure(db, {
      stripeAccountId: "acct_test",
      paymentIntentId: "pi_order_late",
      refund: {
        id: "re_late",
        amountCents: 20_000,
        currency: "usd",
        status: "failed",
        failureReason: "expired_or_canceled_card",
      },
      occurredAt: failedAt,
    });

    // A dashboard refund after the failure: Stripe's total counts it.
    const fresh = await recordStripeChargeRefund(db, {
      stripeAccountId: "acct_test",
      paymentIntentId: "pi_order_late",
      amountRefundedCents: 40_000,
      chargeId: "ch_order_late",
      occurredAt: nowDate(),
    });

    expect(fresh.status).toBe("order_refunded");
    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after?.refundedCents).toBe(20_000);
  });
  it("nets off a failure delivered before the refund it undoes", async () => {
    const { db, order } = await paidOrder();
    const refundedAt = new Date(nowDate().getTime() - 10 * MINUTE);
    // A dashboard refund DiveDay has not counted yet fails first.
    expect(
      await recordStripeRefundFailure(db, {
        stripeAccountId: "acct_test",
        paymentIntentId: "pi_order_late",
        refund: {
          id: "re_dashboard",
          amountCents: 20_000,
          currency: "usd",
          status: "failed",
          failureReason: "expired_or_canceled_card",
        },
        occurredAt: nowDate(),
      }),
    ).toEqual({ status: "not_recorded" });

    const late = await recordStripeChargeRefund(db, {
      stripeAccountId: "acct_test",
      paymentIntentId: "pi_order_late",
      amountRefundedCents: 20_000,
      chargeId: "ch_order_late",
      occurredAt: refundedAt,
    });

    expect(late.status).toBe("already_recorded");
    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after).toMatchObject({ status: "paid", amountPaidCents: 20_000, refundedCents: 0 });
  });
});
