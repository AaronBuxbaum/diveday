import { and, eq } from "drizzle-orm";
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
import { dbNow, dbNowPlus, seededShopContext } from "@/test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "@/test/staff-session";
import { createBooking } from "./bookings";
import { updateCourse } from "./courses";
import {
  countOpenTripOrders,
  createOrder,
  getBookingContext,
  getOrder,
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
import { startPaymentOperation } from "./payment-operations";
import { getBookingPayment, setBookingPayment } from "./payments";
import { orders, paymentOperationIntents } from "./schema";
import { setShopCurrency, setShopTaxEnabled } from "./shops";
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
        taxCents: 0,
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
          taxCents: 0,
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

  it("requires and passes a billing location when tax is enabled", async () => {
    const { db, shop, entry, staff } = await orderContext();
    await connectedShop(db, shop.id);
    await setShopTaxEnabled(db, shop.id, true);
    const seen: CreateInvoiceRequest[] = [];
    const invoicing = fakeInvoicing({
      async createInvoice(request) {
        seen.push(request);
        return fakeInvoicing().createInvoice(request);
      },
    });

    expect(
      await createOrder(
        db,
        {
          shopId: shop.id,
          personId: entry.person.id,
          createdByPersonId: staff,
          lineItems,
        },
        invoicing,
      ),
    ).toEqual({ ok: false, reason: "tax_location_required" });
    expect(seen).toHaveLength(0);

    const customerAddress = {
      line1: "1 Harbor Way",
      city: "Key West",
      state: "FL",
      postalCode: "33040",
      country: "US",
    };
    const result = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: entry.person.id,
        createdByPersonId: staff,
        customerAddress,
        lineItems,
      },
      invoicing,
    );
    expect(result.ok).toBe(true);
    expect(seen[0]?.taxEnabled).toBe(true);
    expect(seen[0]?.customerAddress).toEqual(customerAddress);
  });

  it("preserves recorded tax when a paid webhook has no tax evidence", async () => {
    const { db, shop, entry, staff } = await orderContext();
    await connectedShop(db, shop.id);
    await setShopTaxEnabled(db, shop.id, true);
    const invoicing = fakeInvoicing({
      async createInvoice(request) {
        const created = await fakeInvoicing().createInvoice(request);
        if (created.status !== "created") throw new Error("expected invoice creation to succeed");
        return { ...created, totalCents: created.totalCents + 1_800, taxCents: 1_800 };
      },
    });
    const result = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: entry.person.id,
        createdByPersonId: staff,
        bookingId: entry.booking.id,
        customerAddress: {
          line1: "1 Harbor Way",
          city: "Key West",
          state: "FL",
          postalCode: "33040",
          country: "US",
        },
        lineItems,
      },
      invoicing,
    );
    if (!result.ok) throw new Error("expected order creation to succeed");
    expect(result.order.taxCents).toBe(1_800);

    const paid = await markOrderPaidByInvoiceId(
      db,
      result.order.stripeInvoiceId,
      result.order.totalCents,
      undefined,
      null,
    );
    expect(paid?.taxCents).toBe(1_800);
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

    const { rows: list } = await listShopOrders(db, shop.id);
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
              taxCents: 0,
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
    if (refunded.status !== "refunded")
      throw new Error(`expected a refund, got ${refunded.status}`);
    expect(refunded.order.amountPaidCents).toBe(0);
    expect(refunded.order.refundedAt).not.toBeNull();
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toMatchObject({
      status: "refunded",
      providerRef: result.order.stripeInvoiceId,
    });
    expect(await refundOrder(db, shop.id, result.order.id, fakeInvoicing())).toEqual({
      status: "not_paid",
    });
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

    expect((await refundOrder(db, shop.id, result.order.id, invoicing)).status).toBe("refunded");
    expect(refundInvoiceCalls).toBe(1);

    // Second attempt: already refunded, so it never reaches the provider and
    // the order is left exactly as the first refund settled it.
    expect(await refundOrder(db, shop.id, result.order.id, invoicing)).toEqual({
      status: "not_paid",
    });
    expect(refundInvoiceCalls).toBe(1);
    const [row] = await db.select().from(orders).where(eq(orders.id, result.order.id));
    expect(row).toMatchObject({ status: "refunded", amountPaidCents: 0 });
  });

  /**
   * PAY-L3. The test above only proves the *sequential* case: the first refund
   * has fully settled (`status: "refunded"`) before the second tap is read, so
   * the plain `status !== "paid"` read is enough to turn it away. The exposure
   * is the window that read cannot see — a second attempt landing while the
   * first one is still inside its Stripe round trip, with the order row still
   * saying `paid`. Both attempts pass the check, both mint their own intent
   * (so their own distinct `Idempotency-Key`, deliberately — PAY-C1), and both
   * reach Stripe. Only Stripe's own over-refund rejection stops the money
   * moving twice, which is a second network round trip's worth of trust in a
   * refusal we can make locally.
   *
   * **What PGlite can and cannot prove here.** It is single-connection, so
   * this is not two transactions genuinely contending on the order row — the
   * `FOR UPDATE` in `claimOrderRefund` takes an uncontended lock and returns
   * immediately (same limitation documented in `src/db/bookings.ts` and
   * `src/db/money-replay.test.ts`; real contention needs the real-Postgres CI
   * job, HD-19). What it proves exactly is the *ordering* the lock exists to
   * impose: the second attempt is driven re-entrantly from inside the first
   * one's Stripe call — precisely the mid-flight window, after the first
   * attempt's intent has committed and before its order update has — and must
   * be refused locally, with a code, before the provider is asked again.
   */
  it("refuses a second refund that lands while the first is still at Stripe", async () => {
    const { db, shop, entry, staff } = await orderContext();
    await connectedShop(db, shop.id);
    let orderId = "";
    let refundInvoiceCalls = 0;
    let midFlight: Awaited<ReturnType<typeof refundOrder>> | null = null;
    const invoicing: InvoicingProvider = fakeInvoicing({
      async refundInvoice(): Promise<RefundInvoiceResult> {
        refundInvoiceCalls += 1;
        // The second staff tap, arriving while this first one is still in
        // flight. It must never reach this provider again.
        if (refundInvoiceCalls === 1) {
          midFlight = await refundOrder(db, shop.id, orderId, invoicing);
        }
        return { status: "refunded", refundId: `re_${refundInvoiceCalls}` };
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
    orderId = result.order.id;
    await markOrderPaidByInvoiceId(db, result.order.stripeInvoiceId, result.order.totalCents);

    const first = await refundOrder(db, shop.id, orderId, invoicing);

    expect(first.status).toBe("refunded");
    expect(midFlight).toEqual({ status: "in_progress" });
    expect(refundInvoiceCalls).toBe(1);
    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(row).toMatchObject({ status: "refunded", amountPaidCents: 0 });
    // One refund intent, not two: the refused attempt never claimed one, so
    // the money trail shows a single attempt against this order.
    const intents = await db
      .select()
      .from(paymentOperationIntents)
      .where(eq(paymentOperationIntents.orderId, orderId));
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ kind: "refund", status: "succeeded" });
  });

  /**
   * The other half of the same guard: a claim is a short-lived guard for one
   * Stripe round trip, never a permanent lock a crashed process can leave on
   * an order forever. Same self-healing rule (and the same `STALE_AFTER_MS`
   * horizon) `claimBookingsForCheckout` already applies to a booking's
   * checkout claim. Past that horizon Stripe's over-refund rejection is the
   * gate again, which is exactly where this started — the local lock is a
   * second gate, never a replacement for it.
   */
  it("stops blocking once an abandoned refund attempt goes stale", async () => {
    const { db, shop, entry, staff } = await orderContext();
    await connectedShop(db, shop.id);
    let refundInvoiceCalls = 0;
    const invoicing = fakeInvoicing({
      async refundInvoice(): Promise<RefundInvoiceResult> {
        refundInvoiceCalls += 1;
        return { status: "refunded", refundId: "re_after_stale" };
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

    // A process that died mid-refund: its intent is still `started` and will
    // never resolve itself.
    await startPaymentOperation(db, {
      shopId: shop.id,
      kind: "refund",
      orderId: result.order.id,
    });
    expect(await refundOrder(db, shop.id, result.order.id, invoicing)).toEqual({
      status: "in_progress",
    });
    expect(refundInvoiceCalls).toBe(0);

    // Treat that abandoned intent as stale even though it just started. The
    // bound is read off the *database's* clock, the one that stamped
    // `started_at` — the frozen `DIVEDAY_CLOCK` never reaches it, so a bound
    // derived from `nowDate()` would compare two different clocks (see `dbNow`
    // in src/test/db.ts, and `claimBookingsForCheckout`'s identical option).
    expect(
      (
        await refundOrder(db, shop.id, result.order.id, invoicing, {
          staleBefore: await dbNowPlus(db, 1_000),
        })
      ).status,
    ).toBe("refunded");
    expect(refundInvoiceCalls).toBe(1);
    // The abandoned intent is left exactly as the dead process left it — this
    // guard ignores it, it does not rewrite someone else's money trail.
    const stillStarted = await db
      .select({ status: paymentOperationIntents.status })
      .from(paymentOperationIntents)
      .where(
        and(
          eq(paymentOperationIntents.orderId, result.order.id),
          eq(paymentOperationIntents.status, "started"),
        ),
      );
    expect(stillStarted).toHaveLength(1);
  });

  it("refuses an order that belongs to another shop without asking Stripe", async () => {
    const { db, shop, entry, staff } = await orderContext();
    await connectedShop(db, shop.id);
    let refundInvoiceCalls = 0;
    const invoicing = fakeInvoicing({
      async refundInvoice(): Promise<RefundInvoiceResult> {
        refundInvoiceCalls += 1;
        return { status: "refunded", refundId: "re_cross_tenant" };
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

    expect(await refundOrder(db, crypto.randomUUID(), result.order.id, invoicing)).toEqual({
      status: "not_found",
    });
    expect(refundInvoiceCalls).toBe(0);
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
                taxCents: 0,
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
            taxCents: 0,
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
      trip: { id: reef.id, priceCents: 9500 },
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
              taxCents: 0,
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

  /**
   * The trip pulse's money fact. What it has to get right is not the count —
   * it is *which* orders the count is of, because the fact links to the Orders
   * index filtered the same way and a staffer who taps "2 orders are awaiting
   * payment" and finds one row stops trusting the strip.
   */
  describe("countOpenTripOrders", () => {
    it("counts only this trip's open orders — not paid ones, another trip's, or an unbooked invoice", async () => {
      const { db, shop, reef, entry, staff } = await orderContext();
      await connectedShop(db, shop.id);
      // One invoicing fake for the whole test: each instance mints invoice ids
      // from its own counter, and two of them would collide on `in_1`.
      const invoicing = fakeInvoicing();

      // A departure with no invoices raised against it says nothing at all —
      // the pulse renders no fact (principle 9: "none" is not a status).
      expect(await countOpenTripOrders(db, shop.id, reef.id)).toBe(0);

      const open = await createOrder(
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
      if (!open.ok) throw new Error("expected the open order to be created");
      expect(await countOpenTripOrders(db, shop.id, reef.id)).toBe(1);

      // An invoice Stripe has since reported paid is not work — settling it is
      // exactly what makes the fact disappear.
      const paid = await createOrder(
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
      if (!paid.ok) throw new Error("expected the second order to be created");
      expect(await countOpenTripOrders(db, shop.id, reef.id)).toBe(2);
      await markOrderPaidByInvoiceId(db, paid.order.stripeInvoiceId, paid.order.totalCents);
      expect(await countOpenTripOrders(db, shop.id, reef.id)).toBe(1);

      // A shop-wide invoice (a gear sale, a course deposit taken off any
      // booking) belongs to no departure, so no departure's pulse claims it.
      const unbooked = await createOrder(
        db,
        {
          shopId: shop.id,
          personId: entry.person.id,
          createdByPersonId: staff,
          lineItems,
        },
        invoicing,
      );
      if (!unbooked.ok) throw new Error("expected the unbooked order to be created");
      expect(await countOpenTripOrders(db, shop.id, reef.id)).toBe(1);

      // …and an open order on a *different* departure stays on that departure.
      const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
      const otherTrip = upcoming.find((trip) => trip.id !== reef.id && trip.booked > 0);
      if (!otherTrip) throw new Error("demo shop is missing a second booked trip");
      const [otherEntry] = await getTripRoster(db, shop.id, otherTrip.id);
      if (!otherEntry) throw new Error("demo booking missing on the second trip");
      const elsewhere = await createOrder(
        db,
        {
          shopId: shop.id,
          personId: otherEntry.person.id,
          createdByPersonId: staff,
          bookingId: otherEntry.booking.id,
          lineItems,
        },
        invoicing,
      );
      if (!elsewhere.ok) throw new Error("expected the other trip's order to be created");
      expect(await countOpenTripOrders(db, shop.id, reef.id)).toBe(1);
      expect(await countOpenTripOrders(db, shop.id, otherTrip.id)).toBe(1);
    });

    it("agrees with the Orders index the fact links to, and stays inside the tenant", async () => {
      const { db, shop, reef, entry, staff } = await orderContext();
      await connectedShop(db, shop.id);
      const created = await createOrder(
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
      if (!created.ok) throw new Error("expected the order to be created");

      // The contract the pulse depends on: the number on the strip is the
      // number of rows behind `?tripId=…&status=open`.
      const filtered = await listShopOrders(db, shop.id, { tripId: reef.id, status: "open" });
      expect(filtered.total).toBe(await countOpenTripOrders(db, shop.id, reef.id));
      expect(filtered.rows.map((row) => row.order.id)).toEqual([created.order.id]);

      const otherShopId = "00000000-0000-4000-8000-000000000000";
      expect(await countOpenTripOrders(db, otherShopId, reef.id)).toBe(0);
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

describe("openOrdersForBookings", () => {
  it("finds nothing for a booking that was never invoiced", async () => {
    const { db, shop, entry } = await orderContext();
    expect(await openOrdersForBookings(db, shop.id, [entry.booking.id])).toEqual(new Map());
  });

  it("returns an empty map for an empty booking list without querying", async () => {
    const { db, shop } = await orderContext();
    expect(await openOrdersForBookings(db, shop.id, [])).toEqual(new Map());
  });

  it("finds the open order for an invoiced booking", async () => {
    const { db, shop, entry, order } = await invoicedOrderContext();
    const batch = await openOrdersForBookings(db, shop.id, [entry.booking.id]);
    const found = batch.get(entry.booking.id);
    expect(found?.id).toBe(order.id);
    expect(found?.hostedInvoiceUrl).toBe(order.hostedInvoiceUrl);
  });

  it("stops surfacing a booking's order once it is paid — no longer 'open'", async () => {
    const { db, shop, entry, order } = await invoicedOrderContext();
    await markOrderPaidByInvoiceId(db, order.stripeInvoiceId, order.totalCents);
    expect(await openOrdersForBookings(db, shop.id, [entry.booking.id])).toEqual(new Map());
  });

  it("never leaks an order across shops", async () => {
    const { db, entry } = await invoicedOrderContext();
    const otherShopId = "00000000-0000-4000-8000-000000000000";
    expect(await openOrdersForBookings(db, otherShopId, [entry.booking.id])).toEqual(new Map());
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

/**
 * **Half a refund is what a shop actually gives** (issue #699).
 *
 * Four ordinary things were impossible while every refund was total: a policy
 * step rather than a cliff, returning the fare and keeping the non-refundable
 * fee, releasing one diver out of a party that booked on one shared checkout,
 * and the goodwill part-refund after weather cuts a boat short. Stripe has
 * supported partial refunds the whole time; the limit was ours.
 *
 * The order is $220 (`lineItems`), so the arithmetic below is readable on
 * sight.
 */
describe("orders — a partial refund", () => {
  async function paidOrder(invoicing = fakeInvoicing()) {
    const { db, shop, entry, staff } = await orderContext();
    await connectedShop(db, shop.id);
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
    return { db, shop, entry, order: result.order };
  }

  it("sends back part of the money and leaves the rest with the shop", async () => {
    const { db, shop, entry, order } = await paidOrder();
    const refunded = await refundOrder(db, shop.id, order.id, fakeInvoicing(), {
      amountCents: 5_000,
    });
    if (refunded.status !== "refunded")
      throw new Error(`expected a refund, got ${refunded.status}`);
    expect(refunded.order).toMatchObject({
      status: "partly_refunded",
      amountPaidCents: 17_000,
      refundedCents: 5_000,
    });
    // Stamped on the *first* money to come back, not only on the last.
    expect(refunded.order.refundedAt).not.toBeNull();
    // The seat still reads as money-in, at what is left of it.
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toMatchObject({
      status: "partly_refunded",
      amountCents: 17_000,
      providerRef: order.stripeInvoiceId,
    });
  });

  // Both of these are the same defect seen from two sides: `refundOrder` has
  // to commit its claim before calling Stripe, so the order snapshot it holds
  // afterwards is arbitrarily old — and writing figures derived from it as
  // *absolutes* made `applyOrderUpdate`'s own `FOR UPDATE` decorative.
  it("adds up two refunds that overlap, instead of the later erasing the earlier", async () => {
    const { db, shop, order } = await paidOrder();
    // A second refund lands while this one is at Stripe — exactly the window
    // the claim's lock cannot cover, since it commits before the network call.
    const racing = fakeInvoicing({
      async refundInvoice(_account, _invoice, _key, amountCents): Promise<RefundInvoiceResult> {
        await db
          .update(orders)
          .set({ status: "partly_refunded", amountPaidCents: 15_000, refundedCents: 7_000 })
          .where(eq(orders.id, order.id));
        return { status: "refunded", refundId: "re_racing", amountCents };
      },
    });

    const outcome = await refundOrder(db, shop.id, order.id, racing, { amountCents: 5_000 });

    if (outcome.status !== "refunded") throw new Error(`expected a refund, got ${outcome.status}`);
    // 7,000 already back + 5,000 now = 12,000, against the row as it stands —
    // not 5,000 computed from a snapshot that never saw the other refund.
    expect(outcome.order).toMatchObject({
      status: "partly_refunded",
      refundedCents: 12_000,
      amountPaidCents: 10_000,
    });
  });

  it("refuses rather than reverses again when Stripe already paid out on a stalled attempt", async () => {
    const { db, shop, order } = await paidOrder();
    // An attempt that reached Stripe and died before its local write: the
    // intent still reads `started`, and carries the refund id as durable
    // evidence money moved.
    const stalled = await startPaymentOperation(db, {
      shopId: shop.id,
      kind: "refund",
      orderId: order.id,
    });
    await db
      .update(paymentOperationIntents)
      .set({ stripeObjectId: "re_already_sent" })
      .where(eq(paymentOperationIntents.id, stalled.id));

    const asked: number[] = [];
    const counting = fakeInvoicing({
      async refundInvoice(_a, _i, _k, amountCents): Promise<RefundInvoiceResult> {
        asked.push(amountCents ?? -1);
        return { status: "refunded", refundId: "re_second", amountCents };
      },
    });

    // Past the horizon, so the ordinary in-progress guard has let go — the
    // bound is read off the *database's* clock, which the frozen app clock
    // never reaches (see `dbNow`, and the sibling abandoned-intent test above).
    const outcome = await refundOrder(db, shop.id, order.id, counting, {
      staleBefore: await dbNowPlus(db, 1_000),
      amountCents: 5_000,
    });

    // A full refund had Stripe's own over-refund rejection behind it. A
    // partial leaves refundable balance on the charge, so nothing but this
    // stops a second real payout (issue #699 security review).
    expect(outcome).toEqual({ status: "needs_reconciliation" });
    expect(asked).toEqual([]);
    expect((await getOrder(db, shop.id, order.id))?.order).toMatchObject({
      status: "paid",
      amountPaidCents: 22_000,
      refundedCents: 0,
    });
  });

  it("refreshes a part-refunded order's links without undoing the refund", async () => {
    // Stripe leaves the invoice `paid` and its `amount_paid` at the full figure
    // after a refund, so a refresh used to log an illegal transition and drop
    // the URLs it was pressed for (CodeRabbit review on #949).
    const { db, shop, order } = await paidOrder();
    await refundOrder(db, shop.id, order.id, fakeInvoicing(), { amountCents: 5_000 });
    const stripeSaysPaid = fakeInvoicing({
      async retrieveInvoice(): Promise<InvoiceLookupResult> {
        return {
          status: "ok",
          invoice: {
            status: "paid",
            totalCents: 22_000,
            amountPaidCents: 22_000,
            hostedInvoiceUrl: "https://stripe.test/refreshed",
            invoicePdfUrl: "https://stripe.test/refreshed.pdf",
            taxCents: 0,
          },
        };
      },
    });

    const refreshed = await refreshOrderStatus(db, shop.id, order.id, stripeSaysPaid);

    // The links arrive; the refund is untouched.
    expect(refreshed).toMatchObject({
      status: "partly_refunded",
      amountPaidCents: 17_000,
      refundedCents: 5_000,
      hostedInvoiceUrl: "https://stripe.test/refreshed",
      invoicePdfUrl: "https://stripe.test/refreshed.pdf",
    });
  });

  it("passes the amount to Stripe, and passes nothing at all for a full refund", async () => {
    const seen: (number | undefined)[] = [];
    const watching = () =>
      fakeInvoicing({
        async refundInvoice(_account, _invoice, _key, amountCents): Promise<RefundInvoiceResult> {
          seen.push(amountCents);
          return { status: "refunded", refundId: `re_${seen.length}`, amountCents };
        },
      });
    const { db, shop, order } = await paidOrder();
    await refundOrder(db, shop.id, order.id, watching(), { amountCents: 5_000 });
    await refundOrder(db, shop.id, order.id, watching());
    // An absent amount is Stripe's own "all of it" — never the full figure
    // spelled out, which would be a different request it could reject.
    expect(seen).toEqual([5_000, undefined]);
  });

  it("can be refunded again, down to zero, and then refuses", async () => {
    const { db, shop, entry, order } = await paidOrder();
    await refundOrder(db, shop.id, order.id, fakeInvoicing(), { amountCents: 20_000 });
    const rest = await refundOrder(db, shop.id, order.id, fakeInvoicing(), { amountCents: 2_000 });
    if (rest.status !== "refunded") throw new Error(`expected a refund, got ${rest.status}`);
    expect(rest.order).toMatchObject({
      status: "refunded",
      amountPaidCents: 0,
      refundedCents: 22_000,
    });
    expect(await getBookingPayment(db, shop.id, entry.booking.id)).toMatchObject({
      status: "refunded",
      amountCents: 0,
    });
    // Nothing left to give back.
    expect(await refundOrder(db, shop.id, order.id, fakeInvoicing())).toEqual({
      status: "not_paid",
    });
  });

  it("refuses more than the order still holds, without asking Stripe", async () => {
    let calls = 0;
    const counting = fakeInvoicing({
      async refundInvoice(): Promise<RefundInvoiceResult> {
        calls += 1;
        return { status: "refunded", refundId: "re_over" };
      },
    });
    const { db, shop, order } = await paidOrder();
    expect(await refundOrder(db, shop.id, order.id, counting, { amountCents: 22_001 })).toEqual({
      status: "invalid_amount",
    });
    // And the bound follows the balance down, not the original charge.
    await refundOrder(db, shop.id, order.id, fakeInvoicing(), { amountCents: 20_000 });
    expect(await refundOrder(db, shop.id, order.id, counting, { amountCents: 2_001 })).toEqual({
      status: "invalid_amount",
    });
    expect(calls).toBe(0);
  });

  it.each([
    ["zero", 0],
    ["negative", -100],
    ["fractional", 12.5],
    ["unparseable", Number.NaN],
  ])("refuses a %s amount", async (_name, amountCents) => {
    const { db, shop, order } = await paidOrder();
    expect(await refundOrder(db, shop.id, order.id, fakeInvoicing(), { amountCents })).toEqual({
      status: "invalid_amount",
    });
  });

  it("records what Stripe says it reversed, not what was asked for", async () => {
    // Stripe is the authority on what actually moved (ADR
    // 20260806-stale-quote-and-refund-lock). A disagreement has to land in the
    // ledger as the truth rather than as silent drift between two systems.
    const { db, shop, order } = await paidOrder();
    const refunded = await refundOrder(
      db,
      shop.id,
      order.id,
      fakeInvoicing({
        async refundInvoice(): Promise<RefundInvoiceResult> {
          return { status: "refunded", refundId: "re_short", amountCents: 4_999 };
        },
      }),
      { amountCents: 5_000 },
    );
    if (refunded.status !== "refunded")
      throw new Error(`expected a refund, got ${refunded.status}`);
    expect(refunded.order).toMatchObject({ refundedCents: 4_999, amountPaidCents: 17_001 });
  });

  it("cannot be driven negative by a provider claiming more than the order holds", async () => {
    const { db, shop, order } = await paidOrder();
    const refunded = await refundOrder(
      db,
      shop.id,
      order.id,
      fakeInvoicing({
        async refundInvoice(): Promise<RefundInvoiceResult> {
          return { status: "refunded", refundId: "re_huge", amountCents: 999_999 };
        },
      }),
      { amountCents: 5_000 },
    );
    if (refunded.status !== "refunded")
      throw new Error(`expected a refund, got ${refunded.status}`);
    expect(refunded.order).toMatchObject({
      status: "refunded",
      amountPaidCents: 0,
      refundedCents: 22_000,
    });
  });

  it("still refuses a second refund racing the first", async () => {
    // The claim is per *order*, not per amount: two part-refunds are two
    // reversals and must serialize exactly as two full ones did (PAY-L3).
    const { db, shop, order } = await paidOrder();
    let calls = 0;
    const slow = fakeInvoicing({
      async refundInvoice(): Promise<RefundInvoiceResult> {
        calls += 1;
        return { status: "refunded", refundId: `re_${calls}` };
      },
    });
    const [first, second] = await Promise.all([
      refundOrder(db, shop.id, order.id, slow, { amountCents: 1_000 }),
      refundOrder(db, shop.id, order.id, slow, { amountCents: 1_000 }),
    ]);
    const outcomes = [first.status, second.status].sort();
    expect(outcomes).toEqual(["in_progress", "refunded"]);
    expect(calls).toBe(1);
  });
});
