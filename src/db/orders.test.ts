import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { courseTotalCents } from "@/lib/courses";
import type {
  CreateInvoiceRequest,
  CreateInvoiceResult,
  InvoiceLookupResult,
  InvoicingProvider,
  RefundInvoiceResult,
  ResendInvoiceResult,
  VoidInvoiceResult,
} from "@/lib/payments/invoicing";
import { dbNow, seededShopContext } from "@/test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "@/test/staff-session";
import { createBooking } from "./bookings";
import { updateCourse } from "./courses";
import {
  createOrder,
  getBookingContext,
  getOpenOrderForBooking,
  getOrder,
  listOrders,
  listShopOrders,
  MAX_LINE_ITEM_UNIT_AMOUNT_MAJOR,
  markOrderPaidByInvoiceId,
  markOrderVoidedByInvoiceId,
  maxLineItemUnitAmountCents,
  openOrdersForBookings,
  refreshOrderStatus,
  refundOrder,
  resendOrderInvoice,
  voidOrder,
} from "./orders";
import { getBookingPayment, setBookingPayment } from "./payments";
import { orders } from "./schema";
import { setShopCurrency } from "./shops";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getTripRoster, upcomingTripsWithCounts, updateTrip } from "./trips";

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
    async resendInvoice(): Promise<ResendInvoiceResult> {
      return { status: "sent" };
    },
    ...overrides,
  };
}

async function orderContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [entry] = await getTripRoster(db, shop.id, reef.id);
  if (!entry) throw new Error("demo booking missing");
  // Whoever raises the invoice has to pass `createOrder`'s own owner/manager
  // check (H-14), so the fixture's creator is the seeded owner — not the diver
  // being billed, which is what these tests used before the gate existed.
  const staff = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { db, shop, reef, entry, staff };
}

const lineItems = [
  {
    kind: "trip_fee" as const,
    description: "Two-tank charter",
    quantity: 1,
    unitAmountCents: 18_000,
  },
  {
    kind: "rental" as const,
    description: "Full rental set",
    quantity: 1,
    unitAmountCents: 4_000,
  },
];

const EMPTY_PRICING = { title: "", priceCents: null, eLearningPriceCents: null };

/** A shop with a connected, charges-enabled Stripe account. */
async function connectedShop(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
) {
  await upsertShopStripeAccount(db, shopId, "acct_123");
  await setShopStripeAccountStatus(db, "acct_123", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
}

describe("orders", () => {
  it("refuses a captain outright — billing a diver is owner/manager work", async () => {
    // The second line of defense under `createOrderAction`'s gate (H-14, ADR
    // 20260724-role-authorization): a caller that never checked still cannot
    // put an invoice in front of a customer. Asserted on a shop that *can*
    // take money and with a working invoicing fake, so the refusal is the role
    // and nothing else — and checked before the roster row, so nothing was
    // written and Stripe was never asked.
    const { db, shop, entry } = await orderContext();
    await connectedShop(db, shop.id);
    const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
    const invoicing = fakeInvoicing();
    const createInvoice = vi.spyOn(invoicing, "createInvoice");
    const before = (await db.select({ id: orders.id }).from(orders)).length;

    const result = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: entry.person.id,
        createdByPersonId: captain,
        lineItems,
      },
      invoicing,
    );

    expect(result).toEqual({ ok: false, reason: "not_authorized" });
    expect(createInvoice).not.toHaveBeenCalled();
    expect((await db.select({ id: orders.id }).from(orders)).length).toBe(before);
  });

  it("refuses to create an order when the shop has no payment-ready Stripe account", async () => {
    const { db, shop, entry, staff } = await orderContext();
    const result = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: entry.person.id,
        createdByPersonId: staff,
        lineItems,
      },
      fakeInvoicing(),
    );
    expect(result).toEqual({ ok: false, reason: "not_connected" });
  });

  it("rejects an order with no line items or an unknown customer", async () => {
    const { db, shop, entry, staff } = await orderContext();
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
          createdByPersonId: staff,
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
          createdByPersonId: staff,
          lineItems,
        },
        fakeInvoicing(),
      ),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a line item outside its numeric or enum bounds (CR-016)", async () => {
    const { db, shop, entry, staff } = await orderContext();
    await upsertShopStripeAccount(db, shop.id, "acct_123");
    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const base = { shopId: shop.id, personId: entry.person.id, createdByPersonId: staff };
    const goodItem = lineItems[0];
    if (!goodItem) throw new Error("fixture missing");

    const cases: Array<Record<string, unknown>> = [
      { ...goodItem, kind: "not_a_real_kind" },
      { ...goodItem, quantity: 0 },
      { ...goodItem, quantity: 1.5 },
      { ...goodItem, quantity: 101 },
      { ...goodItem, unitAmountCents: -1 },
      { ...goodItem, unitAmountCents: 1.5 },
      { ...goodItem, unitAmountCents: 100_000 * 100 + 1 },
      { ...goodItem, description: "" },
      { ...goodItem, description: "x".repeat(201) },
    ];
    for (const badItem of cases) {
      expect(
        await createOrder(db, { ...base, lineItems: [badItem as never] }, fakeInvoicing()),
      ).toEqual({ ok: false, reason: "invalid" });
    }

    // Too many line items in one order, even if each is individually valid.
    const tooMany = Array.from({ length: 21 }, () => goodItem);
    expect(await createOrder(db, { ...base, lineItems: tooMany }, fakeInvoicing())).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("creates an order, invoices the connected account, and lists/fetches it", async () => {
    const { db, shop, entry, staff } = await orderContext();
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
        createdByPersonId: staff,
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
    // Who raised it, for the detail page's "Raised {date} by {name}" line — the
    // staff member who billed the diver, never the diver being billed.
    expect(fetched?.createdBy).toEqual({ id: staff, fullName: "Dana Reyes" });
    // …and it stays inside the tenant: a lookup scoped to another shop finds no
    // order at all, so nothing about its creator leaks either.
    expect(fetched?.order.createdByPersonId).toBe(staff);

    const list = await listOrders(db, shop.id);
    expect(list.map((row) => row.order.id)).toContain(result.order.id);

    // Not yet paid: the booking's payment gate is untouched.
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toBeNull();
  });

  it("invoices in the shop's currency, not a hardcoded usd", async () => {
    const { db, shop, entry, staff } = await orderContext();
    await connectedShop(db, shop.id);
    await setShopCurrency(db, shop.id, "eur");
    // Stripe reports a different settlement currency for the connected
    // account. That is advisory only (`stripeCurrencyMismatch` surfaces it in
    // settings) and never overrides what the shop declared.
    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      defaultCurrency: "usd",
    });
    const seen: CreateInvoiceRequest[] = [];
    const result = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: entry.person.id,
        createdByPersonId: staff,
        lineItems,
      },
      fakeInvoicing({
        async createInvoice(request) {
          seen.push(request);
          return fakeInvoicing().createInvoice(request);
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen[0]?.currency).toBe("eur");
    expect(result.order.currency).toBe("eur");
  });

  it("never divides a zero-decimal currency by 100, and bounds it in major units", async () => {
    const { db, shop, entry, staff } = await orderContext();
    await connectedShop(db, shop.id);
    await setShopCurrency(db, shop.id, "jpy");
    const base = {
      shopId: shop.id,
      personId: entry.person.id,
      createdByPersonId: staff,
    };

    // ¥18,000 stays 18000 minor units end to end.
    const result = await createOrder(
      db,
      { ...base, lineItems: [{ ...lineItems[0], unitAmountCents: 18_000 }] },
      fakeInvoicing(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.currency).toBe("jpy");
    expect(result.order.totalCents).toBe(18_000);

    // The ceiling is ¥100,000, the same *major-unit* bound a USD shop gets at
    // $100,000 — not the hundred-times-looser one a literal `100_000 * 100`
    // would have allowed (docs ADR 20260731-shop-currency).
    expect(maxLineItemUnitAmountCents("jpy")).toBe(MAX_LINE_ITEM_UNIT_AMOUNT_MAJOR);
    expect(maxLineItemUnitAmountCents("usd")).toBe(MAX_LINE_ITEM_UNIT_AMOUNT_MAJOR * 100);
    expect(
      await createOrder(
        db,
        {
          ...base,
          lineItems: [{ ...lineItems[0], unitAmountCents: MAX_LINE_ITEM_UNIT_AMOUNT_MAJOR + 1 }],
        },
        fakeInvoicing(),
      ),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("keeps a settled order's own currency after the shop switches", async () => {
    const { db, shop, entry, staff } = await orderContext();
    await connectedShop(db, shop.id);
    await setShopCurrency(db, shop.id, "eur");
    const result = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: entry.person.id,
        createdByPersonId: staff,
        bookingId: entry.booking.id,
        lineItems,
      },
      fakeInvoicing(),
    );
    if (!result.ok) throw new Error("expected ok");
    await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, result.order.totalCents);

    await setShopCurrency(db, shop.id, "jpy");
    const settled = await getOrder(db, shop.id, result.order.id);
    // Evidence of what was billed — never re-read through today's setting.
    expect(settled?.order.currency).toBe("eur");
    expect(settled?.order.totalCents).toBe(22_000);
    expect((await getBookingPayment(db, shop.id, entry.booking.id))?.currency).toBe("eur");
  });

  it("is tenant-safe: another shop cannot see or act on the order", async () => {
    const { db, shop, entry, staff } = await orderContext();
    await upsertShopStripeAccount(db, shop.id, "acct_123");
    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const result = await createOrder(
      db,
      { shopId: shop.id, personId: entry.person.id, createdByPersonId: staff, lineItems },
      fakeInvoicing(),
    );
    if (!result.ok) throw new Error("expected order creation to succeed");

    const otherShopId = "00000000-0000-4000-8000-000000000000";
    expect(await getOrder(db, otherShopId, result.order.id)).toBeNull();
    expect(await voidOrder(db, otherShopId, result.order.id, fakeInvoicing())).toBeNull();
  });

  it("voids an open order via the connected account", async () => {
    const { db, shop, entry, staff } = await orderContext();
    await upsertShopStripeAccount(db, shop.id, "acct_123");
    await setShopStripeAccountStatus(db, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const result = await createOrder(
      db,
      { shopId: shop.id, personId: entry.person.id, createdByPersonId: staff, lineItems },
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
    const { db, shop, entry, staff } = await orderContext();
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
        createdByPersonId: staff,
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
    const { db, shop, entry, staff } = await orderContext();
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
        createdByPersonId: staff,
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

  // The same repeated-tap exposure `refundBookingOnCancellation` has (see
  // src/db/refunds.test.ts): the guard is `status !== "paid"`, and the test
  // above passes a *fresh* provider to each call, so it can only prove the
  // second call returns null — never that Stripe was left alone. One provider
  // across both calls is what actually holds "the diver's money moves once".
  it("asks Stripe for the refund once, however many times refundOrder is called", async () => {
    const { db, shop, entry, staff } = await orderContext();
    await connectedShop(db, shop.id);
    let refundInvoiceCalls = 0;
    const invoicing = fakeInvoicing({
      async refundInvoice(): Promise<RefundInvoiceResult> {
        refundInvoiceCalls += 1;
        return { status: "refunded", refundId: "re_once" };
      },
    });
    const result = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: entry.person.id,
        createdByPersonId: staff,
        bookingId: entry.booking.id,
        lineItems,
      },
      invoicing,
    );
    if (!result.ok) throw new Error("expected order creation to succeed");
    await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, result.order.totalCents);

    expect((await refundOrder(db, shop.id, result.order.id, invoicing))?.status).toBe("refunded");
    expect(refundInvoiceCalls).toBe(1);

    // Second attempt: already refunded, so it never reaches the provider and
    // the order is left exactly as the first refund settled it.
    expect(await refundOrder(db, shop.id, result.order.id, invoicing)).toBeNull();
    expect(refundInvoiceCalls).toBe(1);
    const [row] = await db.select().from(orders).where(eq(orders.id, result.order.id));
    expect(row).toMatchObject({ status: "refunded", amountPaidCents: 0 });
  });

  it("marks an order paid from a webhook invoice.paid event and cascades to its booking", async () => {
    const { db, shop, entry, staff } = await orderContext();
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
        createdByPersonId: staff,
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
  });

  // Security review finding: applyOrderUpdate's transition table must refuse
  // an illegal move, not just the ones each caller happens to guard against
  // today. voidOrder already required status === "open" before this fix; the
  // webhook-driven mark functions had no equivalent guard.
  describe("applyOrderUpdate transition guard", () => {
    it("markOrderVoidedByInvoiceId on a paid order leaves it paid", async () => {
      const { db, shop, entry, staff } = await orderContext();
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
          createdByPersonId: staff,
          bookingId: entry.booking.id,
          lineItems,
        },
        fakeInvoicing(),
      );
      if (!result.ok) throw new Error("expected order creation to succeed");
      await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, 22_000);

      // A replayed or out-of-order invoice.voided event must not flip an
      // already-paid order back to void.
      const voided = await markOrderVoidedByInvoiceId(db, result.order.stripeInvoiceId);
      expect(voided?.status).toBe("paid");
      const [row] = await db.select().from(orders).where(eq(orders.id, result.order.id));
      expect(row?.status).toBe("paid");
      expect(row?.voidedAt).toBeNull();
      expect(await getBookingPayment(db, shop.id, entry.booking.id)).toMatchObject({
        status: "paid",
      });
    });

    it("markOrderPaidByInvoiceId replayed after refundOrder leaves status refunded", async () => {
      const { db, shop, entry, staff } = await orderContext();
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
          createdByPersonId: staff,
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
      await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, 22_000);
      const refunded = await refundOrder(db, shop.id, result.order.id, fakeInvoicing());
      expect(refunded?.status).toBe("refunded");

      // A delayed/duplicate delivery of the original "paid" event arrives
      // after the refund already went through.
      const replayed = await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, 22_000);
      expect(replayed?.status).toBe("refunded");
      const [row] = await db.select().from(orders).where(eq(orders.id, result.order.id));
      expect(row?.status).toBe("refunded");
      expect(row?.amountPaidCents).toBe(0);
    });

    it("a replayed invoice.paid on an already-paid order is a no-op success", async () => {
      const { db, shop, entry, staff } = await orderContext();
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
          createdByPersonId: staff,
          bookingId: entry.booking.id,
          lineItems,
        },
        fakeInvoicing(),
      );
      if (!result.ok) throw new Error("expected order creation to succeed");
      const first = await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, 22_000);
      expect(first?.status).toBe("paid");

      const replayed = await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, 22_000);
      expect(replayed?.status).toBe("paid");
      expect(replayed?.paidAt?.getTime()).toBe(first?.paidAt?.getTime());
      expect(await getBookingPayment(db, shop.id, entry.booking.id)).toMatchObject({
        status: "paid",
      });
    });

    // Defense-in-depth (security review finding): a webhook event whose
    // top-level `account` disagrees with the order's own connected account
    // is refused even though the invoice id alone already matched a row.
    it("refuses to mark an order paid or voided when the expected account doesn't match", async () => {
      const { db, shop, entry, staff } = await orderContext();
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
          createdByPersonId: staff,
          bookingId: entry.booking.id,
          lineItems,
        },
        fakeInvoicing(),
      );
      if (!result.ok) throw new Error("expected order creation to succeed");

      expect(
        await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, 22_000, "acct_evil"),
      ).toBeNull();
      expect(
        await markOrderVoidedByInvoiceId(db, result.order.stripeInvoiceId, "acct_evil"),
      ).toBeNull();
      const [row] = await db.select().from(orders).where(eq(orders.id, result.order.id));
      expect(row?.status).toBe("open");

      // The real account still works.
      expect(
        (await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, 22_000, "acct_123"))
          ?.status,
      ).toBe("paid");
    });
  });

  // CR-004: fault injection — simulate a crash between the order-status write
  // and the booking-payment cascade (as could happen before both were one
  // transaction) by forcing the order straight to "paid" without ever
  // writing the booking payment, then prove a replay of the same webhook
  // self-heals rather than short-circuiting on "already paid".
  it("replay repairs a booking payment left unwritten by a prior partial run", async () => {
    const { db, shop, entry, staff } = await orderContext();
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
        createdByPersonId: staff,
        bookingId: entry.booking.id,
        lineItems,
      },
      fakeInvoicing({
        async createInvoice(): Promise<CreateInvoiceResult> {
          return {
            status: "created",
            stripeCustomerId: "cus_partial",
            stripeInvoiceId: "in_partial",
            stripeStatus: "open", // created open, not paid — no cascade runs yet
            hostedInvoiceUrl: null,
            invoicePdfUrl: null,
            totalCents: 22_000,
          };
        },
      }),
    );
    if (!result.ok) throw new Error("expected order creation to succeed");
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toBeNull();

    // A prior run got as far as flipping the order to "paid" but crashed
    // before the booking-payment write landed.
    await db.update(orders).set({ status: "paid" }).where(eq(orders.id, result.order.id));
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toBeNull();

    const replayed = await markOrderPaidByInvoiceId(db, "in_partial", 22_000);
    expect(replayed?.status).toBe("paid");
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toMatchObject({
      status: "paid",
      providerRef: "in_partial",
    });
  });

  // CR-004: a duplicate or out-of-order webhook must never regress a booking
  // a human already refunded back to "paid".
  it("does not regress an already-refunded booking back to paid on a duplicate webhook", async () => {
    const { db, shop, entry, staff } = await orderContext();
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
        createdByPersonId: staff,
        bookingId: entry.booking.id,
        lineItems,
      },
      fakeInvoicing(),
    );
    if (!result.ok) throw new Error("expected order creation to succeed");
    await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, 22_000);

    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      status: "refunded",
      amountCents: 0,
      currency: "usd",
      provider: "stripe",
      providerRef: "re_manual",
    });

    // A delayed/duplicate delivery of the same "paid" event arrives late.
    await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, 22_000);

    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toMatchObject({
      status: "refunded",
      providerRef: "re_manual",
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

  it("carries a course session's two catalog prices into booking context, and leaves a charter's course null", async () => {
    const { db, shop, entry } = await orderContext();
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const courseSession = trips.find((trip) => trip.course?.title === "Discover Scuba Diving");
    if (!courseSession) throw new Error("demo course session missing");
    const enrolled = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: courseSession.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    if (!enrolled.ok) throw new Error(`expected enrollment to succeed: ${enrolled.reason}`);

    await updateCourse(db, shop.id, courseSession.course?.id ?? "", {
      priceCents: 14_900,
      eLearningPriceCents: 10_000,
    });

    // The order form bills the two catalog lines, not the trip's own price.
    const context = await getBookingContext(db, shop.id, enrolled.bookingId);
    expect(context?.course).toMatchObject({
      title: "Discover Scuba Diving",
      priceCents: 14_900,
      eLearningPriceCents: 10_000,
    });
    expect(courseTotalCents(context?.course ?? EMPTY_PRICING)).toBe(24_900);

    // An ordinary charter has no course, so the form falls back to the trip fee.
    expect((await getBookingContext(db, shop.id, entry.booking.id))?.course).toBeNull();
  });

  describe("listShopOrders", () => {
    it("filters by status, diver, and date range — the /orders index's three filters", async () => {
      const { db, shop, reef, entry, staff } = await orderContext();
      await upsertShopStripeAccount(db, shop.id, "acct_123");
      await setShopStripeAccountStatus(db, "acct_123", {
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      });
      const roster = await getTripRoster(db, shop.id, reef.id);
      const other = roster.find((row) => row.person.id !== entry.person.id);
      if (!other) throw new Error("expected a second diver on the seeded reef trip");

      const openResult = await createOrder(
        db,
        {
          shopId: shop.id,
          personId: entry.person.id,
          createdByPersonId: staff,
          lineItems,
        },
        fakeInvoicing(),
      );
      if (!openResult.ok) throw new Error("expected the open order to be created");

      const paidResult = await createOrder(
        db,
        {
          shopId: shop.id,
          personId: other.person.id,
          createdByPersonId: staff,
          lineItems,
        },
        fakeInvoicing({
          async createInvoice(request) {
            const totalCents = request.lineItems.reduce(
              (sum, item) => sum + item.quantity * item.unitAmountCents,
              0,
            );
            return {
              status: "created",
              stripeCustomerId: "cus_paid",
              stripeInvoiceId: "in_paid",
              stripeStatus: "paid",
              hostedInvoiceUrl: null,
              invoicePdfUrl: null,
              totalCents,
            };
          },
        }),
      );
      if (!paidResult.ok) throw new Error("expected the paid order to be created");

      // No filter: every order this shop has ever sent, newest first.
      const all = await listShopOrders(db, shop.id);
      const allIds = all.rows.map((row) => row.order.id);
      expect(allIds).toContain(openResult.order.id);
      expect(allIds).toContain(paidResult.order.id);

      // Status.
      const paidOnly = await listShopOrders(db, shop.id, { status: "paid" });
      expect(paidOnly.rows.map((row) => row.order.id)).toEqual([paidResult.order.id]);

      // Diver, by exact id (the roster/diver-record "view orders" link) and by
      // a name substring (the index page's own search box).
      const forEntry = await listShopOrders(db, shop.id, { personId: entry.person.id });
      expect(forEntry.rows.map((row) => row.order.id)).toEqual([openResult.order.id]);
      const byNameFragment = await listShopOrders(db, shop.id, {
        personQuery: other.person.fullName.slice(0, 4),
      });
      expect(byNameFragment.rows.map((row) => row.order.id)).toContain(paidResult.order.id);
      expect(byNameFragment.rows.map((row) => row.order.id)).not.toContain(openResult.order.id);

      // Date range: a window around now catches both; a window that closes
      // before now catches neither (Reports' "revenue rows" link a month range
      // this same way).
      // Bounded against the database's clock, not the (frozen) app clock:
      // `orders.created_at` is a `defaultNow()` column, so Postgres is what
      // stamped the rows this window has to straddle.
      const dbTime = (await dbNow(db)).getTime();
      const soon = new Date(dbTime + 60_000);
      const justNow = new Date(dbTime - 60_000);
      const longAgo = new Date("2000-01-01T00:00:00Z");
      const inRange = await listShopOrders(db, shop.id, { from: justNow, to: soon });
      expect(inRange.rows.map((row) => row.order.id)).toEqual(
        expect.arrayContaining([openResult.order.id, paidResult.order.id]),
      );
      const outOfRange = await listShopOrders(db, shop.id, { from: longAgo, to: justNow });
      expect(outOfRange.rows.map((row) => row.order.id)).not.toEqual(
        expect.arrayContaining([openResult.order.id, paidResult.order.id]),
      );
    });

    /**
     * The index is bounded in the query, not by the caller remembering to slice.
     * A shop that has traded for a season has thousands of invoices; the demo
     * shop alone seeds 323, which rendered a ~17,700px page.
     */
    it("pages the index, keeps the total, and never repeats or drops a row", async () => {
      const { db, shop } = await seededShopContext({ history: true });

      const first = await listShopOrders(db, shop.id, {}, { page: 1, pageSize: 10 });
      expect(first.rows).toHaveLength(10);
      expect(first.page).toBe(1);
      // The total counts every match, not just this page — it is what the
      // "323 orders" line in the pager reads.
      expect(first.total).toBeGreaterThan(10);
      expect(first.pageCount).toBe(Math.ceil(first.total / 10));

      const second = await listShopOrders(db, shop.id, {}, { page: 2, pageSize: 10 });
      expect(second.rows).toHaveLength(10);
      expect(second.total).toBe(first.total);

      // The seed writes several orders within the same second, so ordering by
      // `created_at` alone would let a row straddle the boundary. The id
      // tiebreak is what makes the two pages disjoint.
      const firstIds = first.rows.map((row) => row.order.id);
      const secondIds = second.rows.map((row) => row.order.id);
      expect(new Set([...firstIds, ...secondIds]).size).toBe(20);

      // Walking every page visits each order exactly once.
      const seen = new Set<string>();
      for (let page = 1; page <= first.pageCount; page++) {
        const chunk = await listShopOrders(db, shop.id, {}, { page, pageSize: 10 });
        for (const row of chunk.rows) seen.add(row.order.id);
      }
      expect(seen.size).toBe(first.total);
    });

    it("treats a hand-typed page below 1 as the first page rather than a negative offset", async () => {
      const { db, shop } = await seededShopContext({ history: true });
      const first = await listShopOrders(db, shop.id, {}, { page: 1, pageSize: 5 });
      for (const requested of [0, -3, Number.NaN]) {
        const clamped = await listShopOrders(db, shop.id, {}, { page: requested, pageSize: 5 });
        expect(clamped.page).toBe(1);
        expect(clamped.rows.map((row) => row.order.id)).toEqual(
          first.rows.map((row) => row.order.id),
        );
      }
    });

    it("reports one page and no pager when a shop has fewer orders than a page holds", async () => {
      const { db, shop } = await orderContext();
      const empty = await listShopOrders(db, shop.id);
      expect(empty.pageCount).toBe(1);
      expect(empty.total).toBe(0);
      expect(empty.rows).toEqual([]);
    });

    it("is tenant-safe: another shop's filter sees none of this shop's orders", async () => {
      const { db, shop, entry, staff } = await orderContext();
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
          createdByPersonId: staff,
          lineItems,
        },
        fakeInvoicing(),
      );
      if (!result.ok) throw new Error("expected order creation to succeed");

      const otherShopId = "00000000-0000-4000-8000-000000000000";
      const otherShopOrders = await listShopOrders(db, otherShopId);
      expect(otherShopOrders.rows.map((row) => row.order.id)).not.toContain(result.order.id);
    });
  });
});

/** Connects Stripe and creates an open, invoiced order for the fixture booking — the Today payment row's happy path. */
async function invoicedOrderContext() {
  const { db, shop, entry, staff } = await orderContext();
  await upsertShopStripeAccount(db, shop.id, "acct_today");
  await setShopStripeAccountStatus(db, "acct_today", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const result = await createOrder(
    db,
    {
      shopId: shop.id,
      personId: entry.person.id,
      createdByPersonId: staff,
      bookingId: entry.booking.id,
      lineItems,
    },
    fakeInvoicing(),
  );
  if (!result.ok) throw new Error(`expected order creation to succeed: ${result.reason}`);
  return { db, shop, entry, order: result.order };
}

describe("getOpenOrderForBooking / openOrdersForBookings", () => {
  it("finds nothing for a booking that was never invoiced", async () => {
    const { db, shop, entry } = await orderContext();
    expect(await getOpenOrderForBooking(db, shop.id, entry.booking.id)).toBeNull();
    expect(await openOrdersForBookings(db, shop.id, [entry.booking.id])).toEqual(new Map());
  });

  it("returns an empty map for an empty booking list without querying", async () => {
    const { db, shop } = await orderContext();
    expect(await openOrdersForBookings(db, shop.id, [])).toEqual(new Map());
  });

  it("finds the open order for an invoiced booking", async () => {
    const { db, shop, entry, order } = await invoicedOrderContext();
    const found = await getOpenOrderForBooking(db, shop.id, entry.booking.id);
    expect(found?.id).toBe(order.id);
    expect(found?.hostedInvoiceUrl).toBe(order.hostedInvoiceUrl);

    const batch = await openOrdersForBookings(db, shop.id, [entry.booking.id]);
    expect(batch.get(entry.booking.id)?.id).toBe(order.id);
  });

  it("stops surfacing a booking's order once it is paid — no longer 'open'", async () => {
    const { db, shop, entry, order } = await invoicedOrderContext();
    await markOrderPaidByInvoiceId(db, order.stripeInvoiceId, order.totalCents);
    expect(await getOpenOrderForBooking(db, shop.id, entry.booking.id)).toBeNull();
    expect(await openOrdersForBookings(db, shop.id, [entry.booking.id])).toEqual(new Map());
  });

  it("never leaks an order across shops", async () => {
    const { db, entry } = await invoicedOrderContext();
    const otherShopId = "00000000-0000-4000-8000-000000000000";
    expect(await getOpenOrderForBooking(db, otherShopId, entry.booking.id)).toBeNull();
  });
});

describe("resendOrderInvoice", () => {
  it("resends the email for an existing open invoice", async () => {
    const { db, shop, order } = await invoicedOrderContext();
    const resend = vi.fn().mockResolvedValue({ status: "sent" } satisfies ResendInvoiceResult);
    const outcome = await resendOrderInvoice(
      db,
      shop.id,
      order.id,
      fakeInvoicing({ resendInvoice: resend }),
    );
    expect(outcome).toEqual({ status: "sent" });
    expect(resend).toHaveBeenCalledWith(order.stripeAccountId, order.stripeInvoiceId);
  });

  it("reports not_found for an unknown or cross-shop order id", async () => {
    const { db, order } = await invoicedOrderContext();
    const otherShopId = "00000000-0000-4000-8000-000000000000";
    expect(await resendOrderInvoice(db, otherShopId, order.id, fakeInvoicing())).toEqual({
      status: "not_found",
    });
    expect(
      await resendOrderInvoice(
        db,
        (await orderContext()).shop.id,
        "00000000-0000-4000-8000-000000000001",
        fakeInvoicing(),
      ),
    ).toEqual({ status: "not_found" });
  });

  it("refuses to resend an invoice that already closed (paid, voided, or refunded)", async () => {
    const { db, shop, order } = await invoicedOrderContext();
    await markOrderPaidByInvoiceId(db, order.stripeInvoiceId, order.totalCents);
    expect(await resendOrderInvoice(db, shop.id, order.id, fakeInvoicing())).toEqual({
      status: "not_open",
    });
  });

  it("surfaces a Stripe failure instead of pretending the resend happened", async () => {
    const { db, shop, order } = await invoicedOrderContext();
    const outcome = await resendOrderInvoice(
      db,
      shop.id,
      order.id,
      fakeInvoicing({
        async resendInvoice(): Promise<ResendInvoiceResult> {
          return { status: "failed" };
        },
      }),
    );
    expect(outcome).toEqual({ status: "failed" });
  });

  it("reports not_configured when the shop's Stripe connection has since gone away", async () => {
    const { db, shop, order } = await invoicedOrderContext();
    const outcome = await resendOrderInvoice(
      db,
      shop.id,
      order.id,
      fakeInvoicing({
        async resendInvoice(): Promise<ResendInvoiceResult> {
          return { status: "not_configured" };
        },
      }),
    );
    expect(outcome).toEqual({ status: "not_configured" });
  });
});
