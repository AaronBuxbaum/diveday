// @vitest-environment node
import { describe, expect, it } from "vitest";
import type {
  CreateInvoiceRequest,
  CreateInvoiceResult,
  InvoiceLookupResult,
  InvoicingProvider,
  RefundInvoiceResult,
  VoidInvoiceResult,
} from "@/lib/payments/invoicing";
import { createTestDb } from "./client";
import {
  createOrder,
  getBookingContext,
  getOrder,
  listOrders,
  markOrderPaidByInvoiceId,
  markOrderVoidedByInvoiceId,
  refreshOrderStatus,
  refundOrder,
  voidOrder,
} from "./orders";
import { getBookingPayment } from "./payments";
import { getShopBySlug, getTripRoster, upcomingTripsWithCounts, updateTrip } from "./queries";
import { seedDemo } from "./seed";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";

function fakeInvoicing(overrides: Partial<InvoicingProvider> = {}): InvoicingProvider {
  let counter = 0;
  return {
    async createInvoice(request: CreateInvoiceRequest): Promise<CreateInvoiceResult> {
      counter += 1;
      const totalCents = request.lineItems.reduce(
        (sum, item) => sum + item.quantity * item.unitAmountCents,
        0,
      );
      return {
        status: "created",
        stripeCustomerId: `cus_${counter}`,
        stripeInvoiceId: `in_${counter}`,
        stripeStatus: "open",
        hostedInvoiceUrl: `https://invoice.stripe.com/i/${request.stripeAccountId}/in_${counter}`,
        invoicePdfUrl: null,
        totalCents,
      };
    },
    async voidInvoice(): Promise<VoidInvoiceResult> {
      return { status: "voided" };
    },
    async refundInvoice(): Promise<RefundInvoiceResult> {
      return { status: "refunded", refundId: "re_1" };
    },
    async retrieveInvoice(): Promise<InvoiceLookupResult> {
      return {
        status: "ok",
        invoice: {
          status: "paid",
          hostedInvoiceUrl: null,
          invoicePdfUrl: null,
          amountPaidCents: 22_000,
          totalCents: 22_000,
        },
      };
    },
    ...overrides,
  };
}

async function orderContext() {
  const db = await createTestDb();
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [entry] = await getTripRoster(db, reef.id);
  if (!entry) throw new Error("demo booking missing");
  return { db, shop, reef, entry };
}

const lineItems = [
  {
    kind: "trip_fee" as const,
    description: "Two-tank charter",
    quantity: 1,
    unitAmountCents: 18_000,
  },
  {
    kind: "rental_gear" as const,
    description: "Full rental set",
    quantity: 1,
    unitAmountCents: 4_000,
  },
];

describe("orders", () => {
  it("refuses to create an order when the shop has no payment-ready Stripe account", async () => {
    const { db, shop, entry } = await orderContext();
    const result = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: entry.person.id,
        createdByPersonId: entry.person.id,
        lineItems,
      },
      fakeInvoicing(),
    );
    expect(result).toEqual({ ok: false, reason: "not_connected" });
  });

  it("rejects an order with no line items or an unknown customer", async () => {
    const { db, shop, entry } = await orderContext();
    await upsertShopStripeAccount(db, shop.id, "acct_123");
    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    expect(
      await createOrder(
        db,
        {
          shopId: shop.id,
          personId: entry.person.id,
          createdByPersonId: entry.person.id,
          lineItems: [],
        },
        fakeInvoicing(),
      ),
    ).toEqual({ ok: false, reason: "invalid" });

    expect(
      await createOrder(
        db,
        {
          shopId: shop.id,
          personId: "00000000-0000-4000-8000-000000000000",
          createdByPersonId: entry.person.id,
          lineItems,
        },
        fakeInvoicing(),
      ),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("creates an order, invoices the connected account, and lists/fetches it", async () => {
    const { db, shop, entry } = await orderContext();
    await upsertShopStripeAccount(db, shop.id, "acct_123");
    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    const result = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: entry.person.id,
        createdByPersonId: entry.person.id,
        bookingId: entry.booking.id,
        lineItems,
      },
      fakeInvoicing(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.totalCents).toBe(22_000);
    expect(result.order.status).toBe("open");
    expect(result.order.stripeAccountId).toBe("acct_123");

    const fetched = await getOrder(db, shop.id, result.order.id);
    expect(fetched?.lineItems).toHaveLength(2);
    expect(fetched?.person.id).toBe(entry.person.id);

    const list = await listOrders(db, shop.id);
    expect(list.map((row) => row.order.id)).toContain(result.order.id);

    // Not yet paid: the booking's payment gate is untouched.
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toBeNull();
  });

  it("is tenant-safe: another shop cannot see or act on the order", async () => {
    const { db, shop, entry } = await orderContext();
    await upsertShopStripeAccount(db, shop.id, "acct_123");
    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const result = await createOrder(
      db,
      { shopId: shop.id, personId: entry.person.id, createdByPersonId: entry.person.id, lineItems },
      fakeInvoicing(),
    );
    if (!result.ok) throw new Error("expected order creation to succeed");

    const otherShopId = "00000000-0000-4000-8000-000000000000";
    expect(await getOrder(db, otherShopId, result.order.id)).toBeNull();
    expect(await voidOrder(db, otherShopId, result.order.id, fakeInvoicing())).toBeNull();
  });

  it("voids an open order via the connected account", async () => {
    const { db, shop, entry } = await orderContext();
    await upsertShopStripeAccount(db, shop.id, "acct_123");
    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const result = await createOrder(
      db,
      { shopId: shop.id, personId: entry.person.id, createdByPersonId: entry.person.id, lineItems },
      fakeInvoicing(),
    );
    if (!result.ok) throw new Error("expected order creation to succeed");

    const voided = await voidOrder(db, shop.id, result.order.id, fakeInvoicing());
    expect(voided?.status).toBe("void");
    expect(voided?.voidedAt).not.toBeNull();

    // Voiding again is a no-op (already not open).
    expect(await voidOrder(db, shop.id, result.order.id, fakeInvoicing())).toBeNull();
  });

  it("refreshes status from Stripe as a fallback when the webhook isn't configured", async () => {
    const { db, shop, entry } = await orderContext();
    await upsertShopStripeAccount(db, shop.id, "acct_123");
    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const result = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: entry.person.id,
        createdByPersonId: entry.person.id,
        bookingId: entry.booking.id,
        lineItems,
      },
      fakeInvoicing(),
    );
    if (!result.ok) throw new Error("expected order creation to succeed");

    const refreshed = await refreshOrderStatus(db, shop.id, result.order.id, fakeInvoicing());
    expect(refreshed?.status).toBe("paid");
    expect(refreshed?.amountPaidCents).toBe(22_000);

    const payment = await getBookingPayment(db, shop.id, entry.booking.id);
    expect(payment).toMatchObject({ status: "paid", provider: "stripe" });
  });

  it("refunds a paid order and reopens the linked booking payment gate", async () => {
    const { db, shop, entry } = await orderContext();
    await upsertShopStripeAccount(db, shop.id, "acct_123");
    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const result = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: entry.person.id,
        createdByPersonId: entry.person.id,
        bookingId: entry.booking.id,
        lineItems,
      },
      fakeInvoicing({
        async retrieveInvoice(): Promise<InvoiceLookupResult> {
          return {
            status: "ok",
            invoice: {
              status: "paid",
              hostedInvoiceUrl: null,
              invoicePdfUrl: null,
              amountPaidCents: 22_000,
              totalCents: 22_000,
            },
          };
        },
        async refundInvoice(): Promise<RefundInvoiceResult> {
          return { status: "refunded", refundId: "re_1" };
        },
      }),
    );
    if (!result.ok) throw new Error("expected order creation to succeed");

    await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, result.order.totalCents);
    const refunded = await refundOrder(db, shop.id, result.order.id, fakeInvoicing());
    expect(refunded?.status).toBe("refunded");
    expect(refunded?.amountPaidCents).toBe(0);
    expect(refunded?.refundedAt).not.toBeNull();
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toMatchObject({
      status: "refunded",
      providerRef: result.order.stripeInvoiceId,
    });
    expect(await refundOrder(db, shop.id, result.order.id, fakeInvoicing())).toBeNull();
  });

  it("marks an order paid from a webhook invoice.paid event and cascades to its booking", async () => {
    const { db, shop, entry } = await orderContext();
    await upsertShopStripeAccount(db, shop.id, "acct_123");
    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const result = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: entry.person.id,
        createdByPersonId: entry.person.id,
        bookingId: entry.booking.id,
        lineItems,
      },
      fakeInvoicing(),
    );
    if (!result.ok) throw new Error("expected order creation to succeed");

    const paid = await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, 22_000);
    expect(paid?.status).toBe("paid");
    expect(paid?.paidAt).not.toBeNull();

    const payment = await getBookingPayment(db, shop.id, entry.booking.id);
    expect(payment).toMatchObject({
      status: "paid",
      provider: "stripe",
      providerRef: result.order.stripeInvoiceId,
    });

    // An unknown invoice id is a no-op, never an error.
    expect(await markOrderPaidByInvoiceId(db, "in_unknown", 100)).toBeNull();

    const voided = await markOrderVoidedByInvoiceId(db, result.order.stripeInvoiceId);
    // Already paid: void applies (status flips) but does not retroactively unpay the booking.
    expect(voided?.status).toBe("void");
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toMatchObject({
      status: "paid",
    });
  });

  it("surfaces the trip's price through booking context so the order form can auto-fill it", async () => {
    const { db, shop, reef, entry } = await orderContext();
    expect(await getBookingContext(db, shop.id, entry.booking.id)).toMatchObject({
      trip: { id: reef.id, priceCents: null },
    });

    await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: reef.plannedDives,
      priceCents: 18_000,
    });
    expect(await getBookingContext(db, shop.id, entry.booking.id)).toMatchObject({
      trip: { priceCents: 18_000 },
    });
  });
});
