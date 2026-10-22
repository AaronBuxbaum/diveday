import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import {
  billableWindow,
  closePricingMonth,
  latestPricingStatement,
  markPricingStatementReported,
  meterIdentifier,
  processedVolumeCents,
} from "./pricing-volume";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  importedPaymentHistory,
  orderLineItems,
  orders,
  people,
  shops,
  trips,
} from "./schema";

/**
 * The percent plan's volume (ADR 20261022-pricing-ab-test), read against
 * hand-built rows in a shop of its own. The shop sits in Key Largo
 * (UTC-4 in June 2031), so June runs from 04:00Z on 1 June to 04:00Z on 1 July.
 */
const JUNE = { year: 2031, month: 6 };
const MID_JUNE = new Date("2031-06-15T15:00:00Z");
const ZONE = "America/New_York";
const PERCENT = { plan: "percent_of_volume", monthlyCents: 0, basisPoints: 300 } as const;

let seq = 0;

async function freshShop(db: AppDb) {
  seq += 1;
  const [shop] = await db
    .insert(shops)
    .values({ name: "Volume Shop", slug: `volume-shop-${seq}`, timezone: ZONE })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  const [owner] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Owner Person" })
    .returning();
  if (!owner) throw new Error("person insert failed");
  return { shopId: shop.id, personId: owner.id };
}

async function paidOrder(
  db: AppDb,
  shop: { shopId: string; personId: string },
  lines: Array<{ kind: NonNullable<(typeof orderLineItems.$inferInsert)["kind"]>; cents: number }>,
  options: {
    refundedCents?: number;
    taxCents?: number;
    paidAt?: Date;
    collection?: "cash" | "card_machine";
  } = {},
) {
  seq += 1;
  const subtotal = lines.reduce((sum, line) => sum + line.cents, 0);
  const taxCents = options.taxCents ?? 0;
  const totalCents = subtotal + taxCents;
  const refundedCents = options.refundedCents ?? 0;
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.shopId,
      personId: shop.personId,
      createdByPersonId: shop.personId,
      status: refundedCents > 0 ? "partly_refunded" : "paid",
      currency: "usd",
      totalCents,
      taxCents,
      amountPaidCents: totalCents - refundedCents,
      refundedCents,
      ...(options.collection
        ? { collection: options.collection }
        : {
            stripeAccountId: "acct_volume",
            stripeCustomerId: `cus_v${seq}`,
            stripeInvoiceId: `in_v${seq}`,
          }),
      paidAt: options.paidAt ?? MID_JUNE,
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  await db.insert(orderLineItems).values(
    lines.map((line) => ({
      shopId: shop.shopId,
      orderId: order.id,
      kind: line.kind,
      description: line.kind,
      quantity: 1,
      unitAmountCents: line.cents,
    })),
  );
}

async function trip(db: AppDb, shopId: string) {
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Two-Tank Reef",
      startsAt: new Date("2031-07-04T13:00:00Z"),
      endsAt: new Date("2031-07-04T16:00:00Z"),
      capacity: 10,
    })
    .returning();
  if (!row) throw new Error("trip insert failed");
  return row.id;
}

async function checkout(
  db: AppDb,
  shopId: string,
  money: {
    totalCents: number;
    taxCents?: number;
    refundedCents?: number;
    passThroughCents?: number;
  },
) {
  seq += 1;
  const tripId = await trip(db, shopId);
  const passThrough = money.passThroughCents ?? 0;
  const tax = money.taxCents ?? 0;
  const [diver] = await db
    .insert(people)
    .values({ shopId, fullName: `Diver ${seq}` })
    .returning();
  if (!diver) throw new Error("person insert failed");
  const [booking] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId, tripId, personId: diver.id, status: "booked" })
    .returning();
  if (!booking) throw new Error("booking insert failed");
  const [row] = await db
    .insert(bookingCheckouts)
    .values({
      shopId,
      currency: "usd",
      tripId,
      status: "completed",
      stripeAccountId: "acct_volume",
      stripeSessionId: `cs_volume_${seq}`,
      amountPerDiverCents: money.totalCents - passThrough,
      totalCents: money.totalCents,
      passThroughCents: passThrough,
      taxEnabled: tax > 0,
      taxCents: tax,
      settledTotalCents: money.totalCents + tax,
      refundedCents: money.refundedCents ?? 0,
      completedAt: MID_JUNE,
    })
    .returning();
  if (!row) throw new Error("checkout insert failed");
  await db.insert(bookingCheckoutBookings).values({
    shopId,
    checkoutId: row.id,
    bookingId: booking.id,
    tripCents: money.totalCents - passThrough,
    gearCents: 0,
    passThroughCents: passThrough,
    taxCents: tax,
  });
}

describe("processedVolumeCents", () => {
  it("counts invoices Stripe collected and booking checkouts, net of tax and refunds", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    // $100 of rentals with $7 tax: $100.
    await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }], { taxCents: 700 });
    // A $200 package, a quarter refunded: $150.
    await paidOrder(db, shop, [{ kind: "dive_package", cents: 20_000 }], { refundedCents: 5_000 });
    // A $180 seat paid online: $180.
    await checkout(db, shop.shopId, { totalCents: 18_000 });
    expect(await processedVolumeCents(db, shop.shopId, JUNE, ZONE)).toBe(43_000);
  });

  it("leaves out pass-through fees, counter money, hand-marked payments and imported history", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    await paidOrder(db, shop, [{ kind: "pass_through_fee", cents: 1_500 }]);
    await paidOrder(db, shop, [{ kind: "merchandise", cents: 4_000 }], { collection: "cash" });
    await paidOrder(db, shop, [{ kind: "rental", cents: 6_000 }], { collection: "card_machine" });
    await checkout(db, shop.shopId, { totalCents: 11_000, passThroughCents: 1_000 });
    const tripId = await trip(db, shop.shopId);
    const [booking] = await db
      .insert(bookings)
      .values({ bookedAs: "diver", shopId: shop.shopId, tripId, personId: shop.personId })
      .returning();
    if (!booking) throw new Error("booking insert failed");
    await db.insert(bookingPayments).values({
      shopId: shop.shopId,
      bookingId: booking.id,
      status: "paid",
      amountCents: 9_000,
      currency: "usd",
      updatedAt: MID_JUNE,
    });
    await db.insert(importedPaymentHistory).values({
      shopId: shop.shopId,
      personId: shop.personId,
      occurredOn: "2031-06-10",
      direction: "payment",
      amountLabel: "$500.00",
      amountCents: 50_000,
      currency: "usd",
      dedupeKey: `volume-import-${seq}`,
      importedAt: MID_JUNE,
    });
    // Only the checkout's own $100 seat, without its $10 park fee.
    expect(await processedVolumeCents(db, shop.shopId, JUNE, ZONE)).toBe(10_000);
  });

  it("reads the month in the shop's own zone", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    // 02:00Z on 1 June is still 31 May in Key Largo; 03:00Z on 1 July is still June.
    await paidOrder(db, shop, [{ kind: "rental", cents: 1_000 }], {
      paidAt: new Date("2031-06-01T02:00:00Z"),
    });
    await paidOrder(db, shop, [{ kind: "rental", cents: 2_000 }], {
      paidAt: new Date("2031-07-01T03:00:00Z"),
    });
    expect(await processedVolumeCents(db, shop.shopId, JUNE, ZONE)).toBe(2_000);
  });

  it("bills nothing taken during the shop's free time", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    await paidOrder(db, shop, [{ kind: "rental", cents: 1_000 }], {
      paidAt: new Date("2031-06-05T12:00:00Z"),
    });
    await paidOrder(db, shop, [{ kind: "rental", cents: 2_000 }], {
      paidAt: new Date("2031-06-20T12:00:00Z"),
    });
    const freeUntil = new Date("2031-06-10T04:00:00Z");
    expect(await processedVolumeCents(db, shop.shopId, JUNE, ZONE, freeUntil)).toBe(2_000);
    // A month entirely inside free time reads nothing.
    expect(
      await processedVolumeCents(db, shop.shopId, JUNE, ZONE, new Date("2031-08-01T00:00:00Z")),
    ).toBe(0);
  });

  it("keeps another shop's money out", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const other = await freshShop(db);
    await paidOrder(db, other, [{ kind: "rental", cents: 9_900 }]);
    expect(await processedVolumeCents(db, shop.shopId, JUNE, ZONE)).toBe(0);
  });
});

describe("billableWindow", () => {
  it("is the month, or the part after free time, and never runs backwards", () => {
    expect(billableWindow(JUNE, ZONE, null)).toEqual({
      from: new Date("2031-06-01T04:00:00Z"),
      to: new Date("2031-07-01T04:00:00Z"),
    });
    const late = billableWindow(JUNE, ZONE, new Date("2031-09-01T00:00:00Z"));
    expect(late.from).toEqual(late.to);
  });
});

describe("closePricingMonth", () => {
  it("writes the month's statement once, with its fee and identifier", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    await paidOrder(db, shop, [{ kind: "rental", cents: 10_050 }]);
    const input = {
      shopId: shop.shopId,
      month: JUNE,
      timeZone: ZONE,
      terms: PERCENT,
      freeUntil: null,
    };
    const first = await closePricingMonth(db, input);
    expect(first).toMatchObject({
      month: "2031-06-01",
      volumeCents: 10_050,
      basisPoints: 300,
      feeCents: 302, // 301.5 rounds up
      stripeMeterIdentifier: meterIdentifier(shop.shopId, JUNE),
      reportedAt: null,
    });
    expect(first.stripeMeterIdentifier).toBe(`diveday-fee-${shop.shopId}-2031-06`);

    // A late payment and a re-run: the closed month does not move.
    await paidOrder(db, shop, [{ kind: "rental", cents: 50_000 }]);
    const again = await closePricingMonth(db, input);
    expect(again).toEqual(first);
    expect(await latestPricingStatement(db, shop.shopId)).toEqual(first);
  });

  it("stamps the first report only", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const statement = await closePricingMonth(db, {
      shopId: shop.shopId,
      month: JUNE,
      timeZone: ZONE,
      terms: PERCENT,
      freeUntil: null,
    });
    const first = new Date("2031-07-02T14:00:00Z");
    await markPricingStatementReported(db, statement.id, first);
    await markPricingStatementReported(db, statement.id, new Date("2031-07-03T14:00:00Z"));
    expect((await latestPricingStatement(db, shop.shopId))?.reportedAt).toEqual(first);
  });
});
