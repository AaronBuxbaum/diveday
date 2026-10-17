import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { getMonthlyReport } from "./reporting";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  importedPaymentHistory,
  orders,
  people,
  trips,
} from "./schema";

/**
 * **A departure's net is the month figure's own money** (fifth loop, item 26).
 * Kept beside `reporting.test.ts` rather than in it, which is at its length.
 */

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

const JUNE_START = new Date("2026-06-01T00:00:00Z");
const JULY_START = new Date("2026-07-01T00:00:00Z");

async function makePerson(db: AppDb, shopId: string, name: string): Promise<string> {
  const [row] = await db.insert(people).values({ shopId, fullName: name }).returning();
  if (!row) throw new Error("failed to insert person");
  return row.id;
}

async function makeTrip(
  db: AppDb,
  shopId: string,
  startsAt: Date,
  capacity: number,
  title: string,
) {
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 60 * 60 * 1000),
      capacity,
    })
    .returning();
  if (!row) throw new Error("failed to insert trip");
  return row.id;
}

async function makeBooking(db: AppDb, shopId: string, tripId: string, personId: string) {
  const [row] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId, tripId, personId, status: "booked" })
    .returning();
  if (!row) throw new Error("failed to insert booking");
  return row.id;
}

async function pay(
  db: AppDb,
  shopId: string,
  bookingId: string,
  amountCents: number,
  source: { provider?: string; providerRef?: string } = {},
): Promise<void> {
  await db.insert(bookingPayments).values({
    shopId,
    bookingId,
    status: "paid",
    amountCents,
    currency: "usd",
    ...source,
  });
}

describe("each departure's net", () => {
  it("adds each departure's net, the counter and the imported slice up to the month, to the cent", async () => {
    // Fifth loop, item 26: a ledger row's net is the month figure's own money,
    // so the rows plus what no departure names are the figure. One of every
    // way a seat gets paid for, and money that belongs to no seat.
    const { db, shop } = ctx;
    const divers: string[] = [];
    for (let i = 0; i < 6; i++) divers.push(await makePerson(db, shop.id, `Ledger diver ${i}`));
    const reef = await makeTrip(db, shop.id, new Date("2026-06-08T12:00:00Z"), 10, "Ledger reef");
    const wreck = await makeTrip(db, shop.id, new Date("2026-06-22T12:00:00Z"), 8, "Ledger wreck");
    const [party0, party1, deposit, manual] = [
      await makeBooking(db, shop.id, reef, divers[0]),
      await makeBooking(db, shop.id, reef, divers[1]),
      await makeBooking(db, shop.id, reef, divers[2]),
      await makeBooking(db, shop.id, wreck, divers[3]),
    ];
    const counterPaid = await makeBooking(db, shop.id, wreck, divers[4]);
    const invoiced = await makeBooking(db, shop.id, wreck, divers[5]);

    // A party paid on one Stripe session, tax on top, one seat's line each.
    const [party] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId: reef,
        status: "completed",
        stripeAccountId: "acct_test",
        stripeSessionId: "cs_ledger_party",
        currency: "usd",
        amountPerDiverCents: 15_000,
        totalCents: 30_000,
        taxEnabled: true,
        taxCents: 2_400,
        settledTotalCents: 32_400,
      })
      .returning();
    if (!party) throw new Error("failed to insert party checkout");
    await db.insert(bookingCheckoutBookings).values(
      [party0, party1].map((bookingId) => ({
        shopId: shop.id,
        checkoutId: party.id,
        bookingId,
        tripCents: 15_000,
        taxCents: 1_200,
      })),
    );
    for (const bookingId of [party0, party1]) {
      await pay(db, shop.id, bookingId, 16_200, {
        provider: "stripe",
        providerRef: "cs_ledger_party",
      });
    }
    // A deposit, since topped up: the current row is the balance alone.
    const [depositCheckout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId: reef,
        status: "completed",
        isDeposit: true,
        stripeAccountId: "acct_test",
        stripeSessionId: "cs_ledger_deposit",
        currency: "usd",
        amountPerDiverCents: 5_000,
        totalCents: 5_000,
        settledTotalCents: 5_000,
      })
      .returning();
    if (!depositCheckout) throw new Error("failed to insert deposit checkout");
    await db.insert(bookingCheckoutBookings).values({
      shopId: shop.id,
      checkoutId: depositCheckout.id,
      bookingId: deposit,
    });
    await pay(db, shop.id, deposit, 10_000);
    // A staff mark with no checkout or order behind it.
    await pay(db, shop.id, manual, 7_500);
    // An invoice taken in cash at the counter for a seat, with no payment mirror.
    const order = (input: Partial<typeof orders.$inferInsert>) => ({
      shopId: shop.id,
      personId: divers[4],
      createdByPersonId: divers[4],
      status: "paid" as const,
      collection: "cash" as const,
      currency: "usd",
      totalCents: 9_000,
      amountPaidCents: 9_000,
      paidAt: new Date("2026-06-23T15:00:00Z"),
      finalizedAt: new Date("2026-06-23T15:00:00Z"),
      ...input,
    });
    await db.insert(orders).values([
      order({ bookingId: counterPaid, taxCents: 600 }),
      // A Stripe invoice whose collected total is mirrored to the seat's payment.
      order({
        bookingId: invoiced,
        collection: "stripe_invoice",
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_ledger",
        stripeInvoiceId: "in_ledger",
        taxCents: 500,
      }),
      // A rental at the counter: no booking, so no departure.
      order({ totalCents: 4_000, amountPaidCents: 4_000, taxCents: 300 }),
    ]);
    await pay(db, shop.id, invoiced, 9_000, {
      provider: "stripe",
      providerRef: "in_ledger",
    });
    await db.insert(importedPaymentHistory).values({
      shopId: shop.id,
      personId: divers[0],
      occurredOn: "2026-06-15",
      direction: "payment",
      title: "Imported source",
      statusLabel: "Settled",
      amountLabel: "$25",
      amountCents: 2_500,
      currency: "usd",
      sourceLabel: "Prior shop",
      dedupeKey: "imported-ledger",
      importedAt: new Date("2026-06-01T00:00:00Z"),
    });

    const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START, {
      currency: "usd",
      timeZone: "UTC",
    });
    const net = (title: string) => report.trips.find((trip) => trip.title === title)?.netCents;
    // 2 × 15,000 party + 10,000 balance + 5,000 recovered deposit.
    expect(net("Ledger reef")).toBe(45_000);
    // 7,500 + (9,000 − 600) + (9,000 − 500).
    expect(net("Ledger wreck")).toBe(24_400);
    expect(report.counterCents).toBeGreaterThanOrEqual(3_700);
    const rows = report.trips.reduce((sum, trip) => sum + (trip.netCents ?? 0), 0);
    expect(
      rows + (report.counterCents ?? 0) + report.importedPaymentCents - report.importedRefundCents,
    ).toBe(report.revenueCents);
  });
});
