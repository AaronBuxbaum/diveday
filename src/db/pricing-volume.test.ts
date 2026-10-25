import { eq } from "drizzle-orm";
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
  await insertLines(db, shop, order.id, lines);
  return order;
}

async function insertLines(
  db: AppDb,
  shop: { shopId: string },
  orderId: string,
  lines: Array<{ kind: NonNullable<(typeof orderLineItems.$inferInsert)["kind"]>; cents: number }>,
) {
  const order = { id: orderId };
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

/**
 * **A refund recorded after its month's statement closed** (issue 3024, Aaron:
 * option A). It nets in the month it is recorded: the next statement to close
 * takes it off that month's card money, never lost and never taken twice, and
 * what that month cannot absorb carries to the one after rather than going
 * below zero. Adversarial: the exact close, a part refund, a payment two
 * months back, two refunds of one payment, a re-run.
 */
describe("closePricingMonth and late refunds", () => {
  const MONTHS = {
    june: { year: 2031, month: 6 },
    july: { year: 2031, month: 7 },
    august: { year: 2031, month: 8 },
    september: { year: 2031, month: 9 },
  };
  const MID = {
    july: new Date("2031-07-15T15:00:00Z"),
    august: new Date("2031-08-15T15:00:00Z"),
    september: new Date("2031-09-15T15:00:00Z"),
  };

  async function close(db: AppDb, shopId: string, month: { year: number; month: number }) {
    return closePricingMonth(db, {
      shopId,
      month,
      timeZone: ZONE,
      terms: PERCENT,
      freeUntil: null,
    });
  }

  /** Stripe reported `cents` more reversed on this invoice. */
  async function refund(db: AppDb, order: { id: string }, cents: number) {
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    if (!row) throw new Error("order missing");
    const refundedCents = row.refundedCents + cents;
    await db
      .update(orders)
      .set({
        refundedCents,
        amountPaidCents: row.totalCents - refundedCents,
        status: refundedCents >= row.totalCents ? "refunded" : "partly_refunded",
      })
      .where(eq(orders.id, order.id));
  }

  it("credits a refund recorded after June closed on July's statement, and leaves June as billed", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const june = await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }]);
    const juneStatement = await close(db, shop.shopId, MONTHS.june);
    expect(juneStatement).toMatchObject({ volumeCents: 10_000, feeCents: 300 });

    await refund(db, june, 10_000);
    await paidOrder(db, shop, [{ kind: "rental", cents: 50_000 }], { paidAt: MID.july });
    const july = await close(db, shop.shopId, MONTHS.july);
    expect(july).toMatchObject({
      monthCardCents: 50_000,
      lateRefundCents: 10_000,
      volumeCents: 40_000,
      feeCents: 1_200,
      refundCarryCents: 0,
    });
    // June's own statement still says what it billed.
    expect(await close(db, shop.shopId, MONTHS.june)).toMatchObject({
      volumeCents: 10_000,
      feeCents: 300,
    });
    // August finds nothing new to credit.
    const august = await close(db, shop.shopId, MONTHS.august);
    expect(august).toMatchObject({ lateRefundCents: 0, volumeCents: 0, feeCents: 0 });
  });

  it("takes a refund recorded before the close in that month, and never again after", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const june = await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }]);
    // Recorded on the 2nd, the moment before June's statement is written.
    await refund(db, june, 4_000);
    expect(await close(db, shop.shopId, MONTHS.june)).toMatchObject({ volumeCents: 6_000 });
    await paidOrder(db, shop, [{ kind: "rental", cents: 20_000 }], { paidAt: MID.july });
    expect(await close(db, shop.shopId, MONTHS.july)).toMatchObject({
      lateRefundCents: 0,
      volumeCents: 20_000,
    });
  });

  it("credits a part refund by the part refunded", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const june = await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }]);
    await close(db, shop.shopId, MONTHS.june);
    await refund(db, june, 2_500);
    await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }], { paidAt: MID.july });
    expect(await close(db, shop.shopId, MONTHS.july)).toMatchObject({
      lateRefundCents: 2_500,
      volumeCents: 7_500,
      feeCents: 225,
    });
  });

  it("credits a refund of a payment from two months back on the month it is recorded", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const june = await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }]);
    await close(db, shop.shopId, MONTHS.june);
    await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }], { paidAt: MID.july });
    expect(await close(db, shop.shopId, MONTHS.july)).toMatchObject({ lateRefundCents: 0 });
    await refund(db, june, 6_000);
    await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }], { paidAt: MID.august });
    expect(await close(db, shop.shopId, MONTHS.august)).toMatchObject({
      lateRefundCents: 6_000,
      volumeCents: 4_000,
    });
  });

  it("credits two refunds of one payment once each, on the month each is recorded", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const june = await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }]);
    await close(db, shop.shopId, MONTHS.june);
    await refund(db, june, 3_000);
    await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }], { paidAt: MID.july });
    expect(await close(db, shop.shopId, MONTHS.july)).toMatchObject({ lateRefundCents: 3_000 });
    await refund(db, june, 7_000);
    await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }], { paidAt: MID.august });
    expect(await close(db, shop.shopId, MONTHS.august)).toMatchObject({ lateRefundCents: 7_000 });
    await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }], { paidAt: MID.september });
    expect(await close(db, shop.shopId, MONTHS.september)).toMatchObject({
      lateRefundCents: 0,
      volumeCents: 10_000,
    });
  });

  it("carries a refund bigger than the month's card money forward instead of going below zero", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const june = await paidOrder(db, shop, [{ kind: "rental", cents: 50_000 }]);
    await close(db, shop.shopId, MONTHS.june);
    await refund(db, june, 50_000);
    await paidOrder(db, shop, [{ kind: "rental", cents: 20_000 }], { paidAt: MID.july });
    expect(await close(db, shop.shopId, MONTHS.july)).toMatchObject({
      lateRefundCents: 50_000,
      volumeCents: 0,
      feeCents: 0,
      refundCarryCents: 30_000,
    });
    await paidOrder(db, shop, [{ kind: "rental", cents: 40_000 }], { paidAt: MID.august });
    expect(await close(db, shop.shopId, MONTHS.august)).toMatchObject({
      lateRefundCents: 30_000,
      volumeCents: 10_000,
      feeCents: 300,
      refundCarryCents: 0,
    });
  });

  it("credits nothing twice when a close is run again", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const june = await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }]);
    await close(db, shop.shopId, MONTHS.june);
    await refund(db, june, 5_000);
    await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }], { paidAt: MID.july });
    const first = await close(db, shop.shopId, MONTHS.july);
    expect(await close(db, shop.shopId, MONTHS.july)).toEqual(first);
    await paidOrder(db, shop, [{ kind: "rental", cents: 10_000 }], { paidAt: MID.august });
    expect(await close(db, shop.shopId, MONTHS.august)).toMatchObject({ lateRefundCents: 0 });
  });
});
