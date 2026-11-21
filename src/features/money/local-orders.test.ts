import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as authz from "../../db/authz";
import { createBooking } from "../../db/bookings";
import { getBookingPayment } from "../../db/payments";
import { createPerson } from "../../db/people";
import { activityEvents, collectionEntries, orders, shops } from "../../db/schema";
import * as currencies from "../../db/stripe-accounts";
import { getTripRoster } from "../../db/trips";
import { upcomingTripsWithCounts } from "../../db/trips-queries.test-support";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../../test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "../../test/staff-session";
import { anonymizeDiver } from "../records/anonymize";
import { createLocalOrder, recordLocalOrderReceipt, voidLocalOrder } from "./local-orders";
import { recordPurchaseRefund } from "./recorded-purchases";

const context = fileScopedShopContext();
async function setup() {
  const { db, shop } = context;
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  const payer = await createPerson(db, {
    shopId: shop.id,
    fullName: "Local balance diver",
    email: "local-balance@example.com",
    phone: null,
    origin: "counter",
  });
  const input = {
    shopId: shop.id,
    personId: payer.id,
    actorPersonId: owner,
    attemptId: randomUUID(),
    currency: "usd",
    description: "Rental and purchase",
    lineItems: [
      { kind: "rental" as const, description: "BCD rental", quantity: 1, unitAmountCents: 10000 },
    ],
  };
  return { db, shop, owner, captain, payer, input };
}
async function opened() {
  const fixture = await setup();
  const result = await createLocalOrder(fixture.db, fixture.input);
  if (!result.ok) throw new Error("local order refused");
  const payment = {
    shopId: fixture.shop.id,
    orderId: result.order.id,
    actorPersonId: fixture.captain,
    attemptId: randomUUID(),
    expectedTotalCents: 10000,
    currency: "usd",
    collection: "cash" as const,
    taxCents: 700,
    tipCents: 300,
    receiptReference: "Counter receipt 100",
  };
  return { ...fixture, order: result.order, payment };
}

describe("account-free ancillary amounts due", () => {
  it("creates one unpaid named order with no collection, provider ids, or booking fare", async () => {
    const { db, input, payer } = await setup();
    const first = await createLocalOrder(db, input);
    expect(first).toMatchObject({
      ok: true,
      order: {
        collection: "local_invoice",
        status: "open",
        personId: payer.id,
        bookingId: null,
        amountPaidCents: 0,
        counterReceipt: null,
        stripeInvoiceId: null,
        stripeAccountId: null,
      },
    });
    expect(await createLocalOrder(db, input)).toMatchObject({ ok: true });
    expect(await createLocalOrder(db, { ...input, description: "Changed request" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await db.select().from(orders).where(eq(orders.id, input.attemptId))).toHaveLength(1);
    expect(
      await db
        .select()
        .from(collectionEntries)
        .where(eq(collectionEntries.sourceId, input.attemptId)),
    ).toEqual([]);
  });
  it("preserves billing permission while letting live counter staff record money already received", async () => {
    const { db, input, captain, payment } = await opened();
    expect(
      await createLocalOrder(db, { ...input, actorPersonId: captain, attemptId: randomUUID() }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await recordLocalOrderReceipt(db, payment)).toMatchObject({
      ok: true,
      order: {
        status: "paid",
        collection: "cash",
        amountPaidCents: 10000,
        bookingId: null,
        counterReceipt: { taxCents: 700, tipCents: 300, reference: "Counter receipt 100" },
      },
    });
    expect(await recordLocalOrderReceipt(db, payment)).toMatchObject({ ok: true });
    expect(await recordLocalOrderReceipt(db, { ...payment, collection: "bank_transfer" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await recordLocalOrderReceipt(db, { ...payment, attemptId: randomUUID() })).toEqual({
      ok: false,
      reason: "invalid",
    });
    const collections = await db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.sourceId, input.attemptId));
    expect(collections).toHaveLength(1);
    expect(collections[0].amountCents).toBe(9000);
    expect(
      await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.orderId, input.attemptId),
            eq(activityEvents.code, "purchase_recorded"),
          ),
        ),
    ).toHaveLength(1);
  });
  it("never clears or alters the same diver’s booking payment", async () => {
    const { db, shop, payer, payment } = await opened();
    const target = (await upcomingTripsWithCounts(db, shop.id, nowDate())).find(
      (trip) => !trip.courseId && trip.booked < trip.sellableCapacity,
    );
    if (!target) throw new Error("no seeded departure");
    const booking = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: target.id,
      personId: payer.id,
      fullName: payer.fullName,
      email: payer.email ?? undefined,
    });
    if (!booking.ok) throw new Error(`booking ${booking.reason}`);
    const before = await getBookingPayment(db, shop.id, booking.bookingId);
    expect((await recordLocalOrderReceipt(db, payment)).ok).toBe(true);
    expect(await getBookingPayment(db, shop.id, booking.bookingId)).toEqual(before);
    expect(
      (await getTripRoster(db, shop.id, target.id)).find(
        (seat) => seat.booking.id === booking.bookingId,
      )?.booking.tripId,
    ).toBe(target.id);
  });
  it("refuses foreign or erased customers and stale total/currency without moving money", async () => {
    const { db, shop, owner, input, payer, payment } = await opened();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other shop", slug: `other-${randomUUID()}`, timezone: "America/New_York" })
      .returning();
    expect(
      await createLocalOrder(db, { ...input, shopId: other.id, attemptId: randomUUID() }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await recordLocalOrderReceipt(db, { ...payment, shopId: other.id })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await recordLocalOrderReceipt(db, { ...payment, expectedTotalCents: 9999 })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await recordLocalOrderReceipt(db, { ...payment, currency: "jpy" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      (await anonymizeDiver(db, { shopId: shop.id, personId: payer.id, actorPersonId: owner })).ok,
    ).toBe(true);
    expect(await createLocalOrder(db, { ...input, attemptId: randomUUID() })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await recordLocalOrderReceipt(db, payment)).toEqual({ ok: false, reason: "invalid" });
  });
  it("retains original receipt splits for zero-fee-basis receipts and external returns after erasure", async () => {
    const { db, shop, owner, payer, payment } = await opened();
    expect(
      (await recordLocalOrderReceipt(db, { ...payment, taxCents: 10000, tipCents: 0 })).ok,
    ).toBe(true);
    expect(
      await db
        .select()
        .from(collectionEntries)
        .where(eq(collectionEntries.sourceId, payment.orderId)),
    ).toEqual([]);
    expect(
      (await anonymizeDiver(db, { shopId: shop.id, personId: payer.id, actorPersonId: owner })).ok,
    ).toBe(true);
    const refund = await recordPurchaseRefund(db, {
      shopId: shop.id,
      orderId: payment.orderId,
      actorPersonId: owner,
      attemptId: randomUUID(),
      amountCents: 10000,
      currency: "usd",
      expectedRefundedCents: 0,
      reason: "Returned outside DiveDay",
    });
    expect(refund).toMatchObject({
      ok: true,
      order: {
        status: "refunded",
        amountPaidCents: 0,
        counterReceipt: { taxCents: 10000, tipCents: 0, reference: null },
      },
    });
  });
  it("refuses provider-backed and arbitrary method-only open orders as local receipts", async () => {
    const { db, input, payment } = await opened();
    for (const stripe of [false, true]) {
      const [other] = await db
        .insert(orders)
        .values({
          shopId: input.shopId,
          personId: input.personId,
          createdByPersonId: input.actorPersonId,
          collection: stripe ? "stripe_invoice" : "other",
          status: "open",
          currency: "usd",
          totalCents: 10000,
          stripeAccountId: stripe ? "acct_provider" : null,
          stripeCustomerId: stripe ? "cus_provider" : null,
          stripeInvoiceId: stripe ? "in_provider" : null,
        })
        .returning();
      expect(await recordLocalOrderReceipt(db, { ...payment, orderId: other.id })).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });
  it("voids only unpaid local orders, with manager authorization and no financial entry", async () => {
    const { db, shop, owner, captain, order, payment } = await opened();
    expect(
      await voidLocalOrder(db, { shopId: shop.id, orderId: order.id, actorPersonId: captain }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await voidLocalOrder(db, { shopId: shop.id, orderId: order.id, actorPersonId: owner }),
    ).toMatchObject({ ok: true, order: { status: "void" } });
    expect(await recordLocalOrderReceipt(db, payment)).toEqual({ ok: false, reason: "invalid" });
    expect(
      await db.select().from(collectionEntries).where(eq(collectionEntries.sourceId, order.id)),
    ).toEqual([]);
  });
});

afterEach(() => vi.restoreAllMocks());
it("rechecks billing permission after waiting for the payer lock", async () => {
  const { db, input } = await setup();
  vi.spyOn(authz, "canPersonManageOrders").mockResolvedValueOnce(true).mockResolvedValue(false);
  expect(await createLocalOrder(db, input)).toEqual({ ok: false, reason: "invalid" });
});
it("rechecks native currency after waiting for the payer lock", async () => {
  const { db, input } = await setup();
  vi.spyOn(currencies, "getShopCurrency").mockResolvedValueOnce("usd").mockResolvedValue("eur");
  expect(await createLocalOrder(db, input)).toEqual({ ok: false, reason: "invalid" });
});

it("rechecks staff permission after the receipt order lock", async () => {
  const { db, payment } = await opened();
  vi.spyOn(authz, "loadActiveStaffRoles")
    .mockResolvedValueOnce(["captain"])
    .mockResolvedValue(null);
  expect(await recordLocalOrderReceipt(db, payment)).toEqual({ ok: false, reason: "invalid" });
});
it("rechecks billing permission after the unpaid void lock", async () => {
  const { db, shop, owner, order } = await opened();
  vi.spyOn(authz, "canPersonManageOrders").mockResolvedValueOnce(true).mockResolvedValue(false);
  expect(
    await voidLocalOrder(db, { shopId: shop.id, orderId: order.id, actorPersonId: owner }),
  ).toEqual({ ok: false, reason: "invalid" });
});
it("collects the saved order currency after the shop changes its native currency", async () => {
  const { db, shop, payment } = await opened();
  await db.update(shops).set({ currency: "eur" }).where(eq(shops.id, shop.id));
  expect((await recordLocalOrderReceipt(db, payment)).ok).toBe(true);
});
