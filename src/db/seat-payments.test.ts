import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { pagedOrdersByDay } from "./orders";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  orders,
  people,
  shops,
  trips,
} from "./schema";
import { listSeatPaymentsForExport, owedSeatsAfterSailing } from "./seat-payments";

/**
 * The seats divers paid for online, on the Money ledger and in its file
 * (fourth UX review, item 18), and the seats that sailed owing money with no
 * order behind them (item 23).
 */

const PAID_AT = new Date("2031-06-15T15:00:00Z");
const NOW = new Date("2031-08-01T00:00:00Z");
let seq = 0;

async function freshShop(db: AppDb) {
  seq += 1;
  const [shop] = await db
    .insert(shops)
    .values({ name: "Seat Shop", slug: `seat-shop-${seq}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  return shop.id;
}

async function person(db: AppDb, shopId: string, fullName: string) {
  const [row] = await db.insert(people).values({ shopId, fullName }).returning();
  if (!row) throw new Error("person insert failed");
  return row.id;
}

async function trip(db: AppDb, shopId: string, startsAt: Date, priceCents = 9_500) {
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 60 * 60 * 1000),
      capacity: 10,
      priceCents,
    })
    .returning();
  if (!row) throw new Error("trip insert failed");
  return row.id;
}

async function book(db: AppDb, shopId: string, tripId: string, personId: string) {
  const [row] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId, tripId, personId, status: "booked" })
    .returning();
  if (!row) throw new Error("booking insert failed");
  return row.id;
}

/** A completed party checkout: one charge, a seat per booking, split by what each was asked. */
async function partyCheckout(
  db: AppDb,
  shopId: string,
  tripId: string,
  seats: Array<{ bookingId: string; tripCents: number; gearCents?: number }>,
  money: { settledTotalCents: number; refundedCents?: number; taxCents?: number },
) {
  seq += 1;
  const asked = seats.reduce((sum, seat) => sum + seat.tripCents + (seat.gearCents ?? 0), 0);
  const [row] = await db
    .insert(bookingCheckouts)
    .values({
      shopId,
      currency: "usd",
      tripId,
      status: "completed",
      stripeAccountId: "acct_seats",
      stripeSessionId: `cs_seats_${seq}`,
      amountPerDiverCents: seats[0]?.tripCents ?? 0,
      totalCents: asked,
      taxCents: money.taxCents ?? 0,
      settledTotalCents: money.settledTotalCents,
      refundedCents: money.refundedCents ?? 0,
      completedAt: PAID_AT,
    })
    .returning();
  if (!row) throw new Error("checkout insert failed");
  await db.insert(bookingCheckoutBookings).values(
    seats.map((seat) => ({
      shopId,
      checkoutId: row.id,
      bookingId: seat.bookingId,
      tripCents: seat.tripCents,
      gearCents: seat.gearCents ?? 0,
    })),
  );
  return row.id;
}

describe("seat payments on the Money ledger", () => {
  it("lists every seat of a completed checkout, each with its share of the charge", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const reef = await trip(db, shopId, new Date("2031-06-20T13:00:00Z"));
    const dana = await person(db, shopId, "Dana Reyes");
    const lee = await person(db, shopId, "Lee Reyes");
    await partyCheckout(
      db,
      shopId,
      reef,
      [
        { bookingId: await book(db, shopId, reef, dana), tripCents: 9_500, gearCents: 2_500 },
        { bookingId: await book(db, shopId, reef, lee), tripCents: 9_500 },
      ],
      { settledTotalCents: 21_500 },
    );

    const ledger = await pagedOrdersByDay(db, shopId, "UTC");
    const rows = ledger.groups.flatMap((group) => group.orders);
    expect(rows.map((row) => row.kind)).toEqual(["seat", "seat"]);
    const amounts = rows.flatMap((row) =>
      row.kind === "seat" ? [[row.seat.person.fullName, row.seat.amountCents]] : [],
    );
    // 21,500 split 12,000 : 9,500, the asks.
    expect(amounts).toEqual([
      ["Dana Reyes", 12_000],
      ["Lee Reyes", 9_500],
    ]);
    expect(ledger.groups[0]?.subtotals).toEqual([{ currency: "usd", cents: 21_500 }]);
    expect(ledger.page.total).toBe(2);
  });

  it("puts orders and seat payments on one page, newest first, and filters both alike", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const reef = await trip(db, shopId, new Date("2031-06-20T13:00:00Z"));
    const ana = await person(db, shopId, "Ana Ruiz");
    await partyCheckout(
      db,
      shopId,
      reef,
      [{ bookingId: await book(db, shopId, reef, ana), tripCents: 9_500 }],
      { settledTotalCents: 9_500, refundedCents: 2_500 },
    );
    await db.insert(orders).values({
      shopId,
      personId: ana,
      createdByPersonId: ana,
      status: "open",
      currency: "usd",
      totalCents: 4_000,
      stripeAccountId: "acct_seats",
      stripeCustomerId: "cus_seats",
      stripeInvoiceId: "in_seats_open",
      createdAt: new Date("2031-06-16T10:00:00Z"),
    });

    const all = await pagedOrdersByDay(db, shopId, "UTC");
    expect(all.groups.flatMap((group) => group.orders).map((row) => row.kind)).toEqual([
      "order",
      "seat",
    ]);
    const partly = await pagedOrdersByDay(db, shopId, "UTC", { status: "partly_refunded" });
    expect(partly.groups.flatMap((group) => group.orders).map((row) => row.kind)).toEqual(["seat"]);
    const open = await pagedOrdersByDay(db, shopId, "UTC", { status: "open" });
    expect(open.groups.flatMap((group) => group.orders).map((row) => row.kind)).toEqual(["order"]);
    const byTrip = await pagedOrdersByDay(db, shopId, "UTC", { tripId: reef });
    expect(byTrip.page.total).toBe(1);

    const exported = await listSeatPaymentsForExport(db, shopId, {}, 100);
    expect(exported.map((seat) => [seat.status, seat.amountCents, seat.refundedCents])).toEqual([
      ["partly_refunded", 9_500, 2_500],
    ]);
  });

  it("never shows another shop's seats", async () => {
    const db = await unseededTestDb();
    const mine = await freshShop(db);
    const theirs = await freshShop(db);
    const reef = await trip(db, theirs, new Date("2031-06-20T13:00:00Z"));
    const diver = await person(db, theirs, "Their Diver");
    await partyCheckout(
      db,
      theirs,
      reef,
      [{ bookingId: await book(db, theirs, reef, diver), tripCents: 9_500 }],
      { settledTotalCents: 9_500 },
    );
    expect((await pagedOrdersByDay(db, mine, "UTC")).page.total).toBe(0);
    expect(await listSeatPaymentsForExport(db, mine, {}, 100)).toEqual([]);
  });
});

describe("seats that sailed owing money", () => {
  it("counts an unpaid or deposit-only seat on a boat that left, and nothing else", async () => {
    const db = await unseededTestDb();
    const shopId = await freshShop(db);
    const sailed = await trip(db, shopId, new Date("2031-07-20T13:00:00Z"));
    const upcoming = await trip(db, shopId, new Date("2031-08-20T13:00:00Z"));
    const unpaid = await book(db, shopId, sailed, await person(db, shopId, "Tomás Ferreira"));
    const deposit = await book(db, shopId, sailed, await person(db, shopId, "June Park"));
    const paid = await book(db, shopId, sailed, await person(db, shopId, "Paid Diver"));
    await book(db, shopId, upcoming, await person(db, shopId, "Next Week"));
    const invoiced = await person(db, shopId, "Invoiced Diver");
    const invoicedBooking = await book(db, shopId, sailed, invoiced);
    await db.insert(bookingPayments).values([
      { shopId, bookingId: unpaid, status: "unpaid", currency: "usd" },
      { shopId, bookingId: deposit, status: "deposit_paid", amountCents: 2_000, currency: "usd" },
      { shopId, bookingId: paid, status: "paid", amountCents: 9_500, currency: "usd" },
    ]);
    // An open order on the seat is counted among the orders, never twice.
    await db.insert(orders).values({
      shopId,
      bookingId: invoicedBooking,
      personId: invoiced,
      createdByPersonId: invoiced,
      status: "open",
      currency: "usd",
      totalCents: 9_500,
      stripeAccountId: "acct_seats",
      stripeCustomerId: "cus_owed",
      stripeInvoiceId: "in_owed",
    });

    expect(await owedSeatsAfterSailing(db, shopId, NOW)).toEqual({
      count: 2,
      cents: 9_500 + 7_500,
    });
  });
});
