import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import type { InvoicingProvider } from "@/lib/payments/invoicing";
import { fileScopedShopContext } from "@/test/db";
import { fakeCheckout } from "@/test/fakes";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { cancelBooking, createBookingParty } from "./bookings";
import {
  markCheckoutExpiredBySessionId,
  markCheckoutPaidBySessionId,
  recordCheckoutPaymentIntent,
  startBookingCheckout,
} from "./checkouts";
import {
  listPaidAfterCloseCheckouts,
  refundPaidAfterCloseCheckout,
} from "./checkouts-paid-after-close";
import {
  createOrder,
  markOrderPaidByInvoiceId,
  recordOrderPaymentIntent,
  refundOrder,
} from "./orders";
import { getBookingPayment, listBookingPaymentEvents } from "./payments";
import { listFailedRefunds, recordStripeRefundFailure } from "./refund-failures";
import { refundBookingOnCancellation } from "./refunds";
import { bookingCheckouts, orders } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getTripRoster, upcomingTripsWithCounts, updateTrip } from "./trips";

/**
 * A refund Stripe accepted and later reported failed or canceled (issue
 * #2291): the money is back in the shop's balance, so the refund DiveDay
 * recorded is reversed and the diver shows as owed on the Orders index until
 * somebody refunds them again.
 */

const ctx = fileScopedShopContext();

async function connected() {
  const { db, shop } = ctx;
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  return { db, shop, reef };
}

function invoicing(refundId: string): InvoicingProvider {
  let counter = 0;
  return {
    async createInvoice(request) {
      counter += 1;
      return {
        status: "created",
        stripeCustomerId: `cus_${counter}`,
        stripeInvoiceId: `in_fail_${counter}`,
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

/** A paid staff order for the reef's first seat, with its PaymentIntent recorded. */
async function paidOrder() {
  const { db, shop, reef } = await connected();
  const [entry] = await getTripRoster(db, shop.id, reef.id);
  if (!entry) throw new Error("demo booking missing");
  const staff = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const created = await createOrder(
    db,
    {
      shopId: shop.id,
      personId: entry.person.id,
      createdByPersonId: staff,
      bookingId: entry.booking.id,
      lineItems: [
        { kind: "trip_fee", description: "Two-tank charter", quantity: 1, unitAmountCents: 20_000 },
      ],
    },
    invoicing("re_order"),
  );
  if (!created.ok) throw new Error("order creation failed");
  const invoiceId = created.order.stripeInvoiceId ?? "";
  await markOrderPaidByInvoiceId(db, invoiceId, 20_000, "acct_test");
  await recordOrderPaymentIntent(db, {
    stripeInvoiceId: invoiceId,
    paymentIntentId: "pi_order",
    expectedAccountId: "acct_test",
  });
  return { db, shop, entry, order: created.order };
}

const failure = (refundId: string, paymentIntentId: string, amountCents: number) => ({
  stripeAccountId: "acct_test",
  paymentIntentId,
  refund: {
    id: refundId,
    amountCents,
    currency: "usd",
    status: "failed",
    failureReason: "expired_or_canceled_card",
  },
  occurredAt: nowDate(),
});

describe("recordStripeRefundFailure on an order", () => {
  it("puts the money back on the order and the seat, and owes it to the diver", async () => {
    const { db, shop, entry, order } = await paidOrder();
    const refunded = await refundOrder(db, shop.id, order.id, invoicing("re_order"));
    expect(refunded.status).toBe("refunded");

    const outcome = await recordStripeRefundFailure(db, failure("re_order", "pi_order", 20_000));

    expect(outcome).toEqual({ status: "reversed" });
    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after).toMatchObject({ status: "paid", amountPaidCents: 20_000, refundedCents: 0 });
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toMatchObject({
      status: "paid",
    });
    const [latest] = await listBookingPaymentEvents(db, shop.id, entry.booking.id, 1);
    expect(latest?.operation).toBe("refund_failed");

    expect(await listFailedRefunds(db, shop.id)).toEqual([
      expect.objectContaining({
        amountCents: 20_000,
        currency: "usd",
        diverNames: [entry.person.fullName],
        orderId: order.id,
      }),
    ]);
  });

  it("is a no-op on a redelivery", async () => {
    const { db, shop, order } = await paidOrder();
    await refundOrder(db, shop.id, order.id, invoicing("re_order"));
    await recordStripeRefundFailure(db, failure("re_order", "pi_order", 20_000));
    expect(await recordStripeRefundFailure(db, failure("re_order", "pi_order", 20_000))).toEqual({
      status: "already_recorded",
    });
    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after?.amountPaidCents).toBe(20_000);
  });

  it("leaves the queue once the diver is refunded again", async () => {
    const { db, shop, order } = await paidOrder();
    await refundOrder(db, shop.id, order.id, invoicing("re_order"));
    await recordStripeRefundFailure(db, failure("re_order", "pi_order", 20_000));
    const again = await refundOrder(db, shop.id, order.id, invoicing("re_order_2"));
    expect(again.status).toBe("refunded");
    expect(await listFailedRefunds(db, shop.id)).toEqual([]);
  });

  it("reverses only the part that failed of a partial refund history", async () => {
    const { db, shop, order } = await paidOrder();
    await refundOrder(db, shop.id, order.id, invoicing("re_a"), { amountCents: 5_000 });
    await refundOrder(db, shop.id, order.id, invoicing("re_b"), { amountCents: 3_000 });
    await recordStripeRefundFailure(db, failure("re_b", "pi_order", 3_000));
    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after).toMatchObject({
      status: "partly_refunded",
      amountPaidCents: 15_000,
      refundedCents: 5_000,
    });
  });
});

describe("recordStripeRefundFailure on a checkout", () => {
  async function paidSeat() {
    const { db, shop, reef } = await connected();
    await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: reef.plannedDives,
      priceCents: 18_000,
      cancellationWindowHours: 1,
    });
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Rita Refund",
        email: "rita@example.com",
      },
    ]);
    if (!party.ok) throw new Error(party.reason);
    const bookingId = party.bookings[0]?.bookingId ?? "";
    const start = await startBookingCheckout(
      db,
      {
        shopId: shop.id,
        tripId: reef.id,
        bookingIds: [bookingId],
        customerEmail: "rita@example.com",
        successUrl: "https://diveday.example/return",
        cancelUrl: "https://diveday.example/cancel",
        describeLine: ({ tripTitle }) => tripTitle,
      },
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId, "acct_test", 18_000);
    await recordCheckoutPaymentIntent(db, {
      stripeSessionId: start.checkout.stripeSessionId,
      paymentIntentId: "pi_seat",
    });
    return { db, shop, bookingId, checkout: start.checkout };
  }

  it("restores the seat DiveDay refunded and owes the diver", async () => {
    const { db, shop, bookingId, checkout } = await paidSeat();
    await cancelBooking(db, shop.id, bookingId);
    const refunded = await refundBookingOnCancellation(
      db,
      { shopId: shop.id, bookingId },
      fakeCheckout({
        async refundCheckoutSession() {
          return { status: "refunded", refundId: "re_seat" };
        },
      }),
    );
    expect(refunded.status).toBe("refunded");

    expect(await recordStripeRefundFailure(db, failure("re_seat", "pi_seat", 18_000))).toEqual({
      status: "reversed",
    });
    const [row] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, checkout.id));
    expect(row?.refundedCents).toBe(0);
    expect(await getBookingPayment(db, shop.id, bookingId)).toMatchObject({
      status: "paid",
      amountCents: 18_000,
      providerRef: checkout.stripeSessionId,
    });
    expect(await listFailedRefunds(db, shop.id)).toEqual([
      expect.objectContaining({
        checkoutId: checkout.id,
        diverNames: ["Rita Refund"],
        amountCents: 18_000,
      }),
    ]);
  });

  it("puts paid-after-close money back on its own queue, not this one", async () => {
    const { db, shop, reef } = await connected();
    const party = await createBookingParty(db, [
      { actor: "staff", shopId: shop.id, tripId: reef.id, fullName: "Lou Late" },
    ]);
    if (!party.ok) throw new Error(party.reason);
    await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: reef.plannedDives,
      priceCents: 18_000,
    });
    const start = await startBookingCheckout(
      db,
      {
        shopId: shop.id,
        tripId: reef.id,
        bookingIds: [party.bookings[0]?.bookingId ?? ""],
        customerEmail: "lou@example.com",
        successUrl: "https://diveday.example/return",
        cancelUrl: "https://diveday.example/cancel",
        describeLine: ({ tripTitle }) => tripTitle,
      },
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    await markCheckoutExpiredBySessionId(db, start.checkout.stripeSessionId);
    await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId, "acct_test", 18_000);
    await recordCheckoutPaymentIntent(db, {
      stripeSessionId: start.checkout.stripeSessionId,
      paymentIntentId: "pi_late",
    });
    await refundPaidAfterCloseCheckout(
      db,
      shop.id,
      start.checkout.id,
      "00000000-0000-4000-8000-0000000000aa",
      fakeCheckout({
        async refundCheckoutSession() {
          return { status: "refunded", refundId: "re_late" };
        },
      }),
    );
    expect(await listPaidAfterCloseCheckouts(db, shop.id)).toEqual([]);

    expect(await recordStripeRefundFailure(db, failure("re_late", "pi_late", 18_000))).toEqual({
      status: "reversed",
    });
    expect(await listPaidAfterCloseCheckouts(db, shop.id)).toHaveLength(1);
    expect(await listFailedRefunds(db, shop.id)).toEqual([]);
  });
});

describe("what recordStripeRefundFailure ignores", () => {
  it("a refund that did not fail", async () => {
    const { db } = await paidOrder();
    const event = failure("re_ok", "pi_order", 100);
    expect(
      await recordStripeRefundFailure(db, {
        ...event,
        refund: { ...event.refund, status: "succeeded" },
      }),
    ).toEqual({ status: "not_failed" });
  });

  it("a charge DiveDay never raised, or another account's", async () => {
    const { db } = await paidOrder();
    expect(await recordStripeRefundFailure(db, failure("re_x", "pi_unknown", 100))).toEqual({
      status: "not_found",
    });
    expect(
      await recordStripeRefundFailure(db, {
        ...failure("re_y", "pi_order", 100),
        stripeAccountId: "acct_other",
      }),
    ).toEqual({ status: "not_found" });
  });

  it("a failure of money DiveDay never counted as refunded", async () => {
    const { db, order } = await paidOrder();
    expect(await recordStripeRefundFailure(db, failure("re_z", "pi_order", 20_000))).toEqual({
      status: "not_recorded",
    });
    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after?.amountPaidCents).toBe(20_000);
  });
});
