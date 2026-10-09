import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { getMonthMoneyDetail } from "./report-lines";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  courses,
  divePackageEntitlements,
  divePackages,
  orderLineItems,
  orders,
  people,
  shops,
  trips,
  workOrderBills,
  workOrders,
} from "./schema";

/**
 * The Reports page's line-by-line money, package dives owed and returning
 * divers, read against hand-built rows in a shop of their own. June 2031 in
 * UTC is the month throughout, so nothing seeded elsewhere can wander in.
 */
const JUNE = new Date("2031-06-01T00:00:00Z");
const JULY = new Date("2031-07-01T00:00:00Z");
const MID_JUNE = new Date("2031-06-15T15:00:00Z");
const NOW = new Date("2031-08-01T00:00:00Z");

let seq = 0;

async function freshShop(db: AppDb) {
  seq += 1;
  const [shop] = await db
    .insert(shops)
    .values({ name: "Lines Shop", slug: `lines-shop-${seq}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  const [owner] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Owner Person" })
    .returning();
  if (!owner) throw new Error("person insert failed");
  return { shopId: shop.id, personId: owner.id };
}

async function person(db: AppDb, shopId: string, name: string) {
  const [row] = await db.insert(people).values({ shopId, fullName: name }).returning();
  if (!row) throw new Error("person insert failed");
  return row.id;
}

async function trip(db: AppDb, shopId: string, startsAt: Date, courseId: string | null = null) {
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 60 * 60 * 1000),
      capacity: 10,
      courseId,
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

/** A paid (or part-refunded) invoice with the given lines, paid mid-June. */
async function paidOrder(
  db: AppDb,
  shop: { shopId: string; personId: string },
  lines: Array<{
    kind: NonNullable<(typeof orderLineItems.$inferInsert)["kind"]>;
    cents: number;
    quantity?: number;
    packageId?: string;
  }>,
  options: { refundedCents?: number; taxCents?: number; bookingId?: string; paidAt?: Date } = {},
) {
  seq += 1;
  const subtotal = lines.reduce((sum, line) => sum + line.cents * (line.quantity ?? 1), 0);
  const taxCents = options.taxCents ?? 0;
  const totalCents = subtotal + taxCents;
  const refundedCents = options.refundedCents ?? 0;
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.shopId,
      personId: shop.personId,
      createdByPersonId: shop.personId,
      bookingId: options.bookingId ?? null,
      status: refundedCents > 0 ? "partly_refunded" : "paid",
      currency: "usd",
      totalCents,
      taxCents,
      amountPaidCents: totalCents - refundedCents,
      refundedCents,
      stripeAccountId: "acct_lines",
      stripeCustomerId: `cus_${seq}`,
      stripeInvoiceId: `in_lines_${seq}`,
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
      quantity: line.quantity ?? 1,
      unitAmountCents: line.cents,
      packageId: line.packageId ?? null,
    })),
  );
  return order;
}

describe("the month's money by line", () => {
  it("puts each invoice line on its own line, a refund netted where it was paid", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    await paidOrder(db, shop, [
      { kind: "rental", cents: 4_000 },
      { kind: "merchandise", cents: 2_500 },
      { kind: "pass_through_fee", cents: 1_000 },
    ]);
    // A $500 course, half of it refunded, with tax on top: the line is $250.
    await paidOrder(db, shop, [{ kind: "course_fee", cents: 50_000 }], {
      taxCents: 5_000,
      refundedCents: 27_500,
    });
    // Paid in May: not June's money.
    await paidOrder(db, shop, [{ kind: "merchandise", cents: 9_900 }], {
      paidAt: new Date("2031-05-31T23:00:00Z"),
    });

    const detail = await getMonthMoneyDetail(db, shop.shopId, JUNE, JULY, NOW);
    expect(detail.lines).toEqual([
      { line: "courses", cents: 25_000 },
      { line: "rentals", cents: 4_000 },
      { line: "retail", cents: 2_500 },
    ]);
  });

  it("bills a gear-bench job to the gear bench", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const order = await paidOrder(db, shop, [
      { kind: "other", cents: 6_000 },
      { kind: "merchandise", cents: 1_500 },
    ]);
    const [ticket] = await db
      .insert(workOrders)
      .values({
        shopId: shop.shopId,
        personId: shop.personId,
        number: 1,
        reportedProblem: "Free-flows at depth",
      })
      .returning();
    if (!ticket) throw new Error("work order insert failed");
    await db
      .insert(workOrderBills)
      .values({ shopId: shop.shopId, workOrderId: ticket.id, orderId: order.id });

    const detail = await getMonthMoneyDetail(db, shop.shopId, JUNE, JULY, NOW);
    expect(detail.lines).toEqual([{ line: "gearBench", cents: 7_500 }]);
  });

  it("splits a booking checkout's seat between its departure's line and Rentals", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const [course] = await db
      .insert(courses)
      .values({ shopId: shop.shopId, title: "Open Water", slug: "open-water" })
      .returning();
    if (!course) throw new Error("course insert failed");
    const reef = await trip(db, shop.shopId, new Date("2031-07-04T13:00:00Z"));
    const lesson = await trip(db, shop.shopId, new Date("2031-07-05T13:00:00Z"), course.id);

    async function checkout(
      tripId: string,
      seat: { tripCents: number; gearCents: number; passThroughCents?: number },
      money: { settledTotalCents: number; taxCents: number; refundedCents?: number },
    ) {
      seq += 1;
      const diver = await person(db, shop.shopId, `Diver ${seq}`);
      const bookingId = await book(db, shop.shopId, tripId, diver);
      const totalCents = seat.tripCents + seat.gearCents + (seat.passThroughCents ?? 0);
      const [row] = await db
        .insert(bookingCheckouts)
        .values({
          shopId: shop.shopId,
          currency: "usd",
          tripId,
          status: "completed",
          stripeAccountId: "acct_lines",
          stripeSessionId: `cs_lines_${seq}`,
          amountPerDiverCents: seat.tripCents,
          totalCents,
          passThroughCents: seat.passThroughCents ?? 0,
          taxEnabled: money.taxCents > 0,
          taxCents: money.taxCents,
          settledTotalCents: money.settledTotalCents,
          refundedCents: money.refundedCents ?? 0,
          completedAt: MID_JUNE,
        })
        .returning();
      if (!row) throw new Error("checkout insert failed");
      await db.insert(bookingCheckoutBookings).values({
        shopId: shop.shopId,
        checkoutId: row.id,
        bookingId,
        tripCents: seat.tripCents,
        gearCents: seat.gearCents,
        passThroughCents: seat.passThroughCents ?? 0,
        taxCents: money.taxCents,
      });
    }

    // Paid in June for a July boat: June's money, by the line it bought.
    await checkout(
      reef,
      { tripCents: 18_000, gearCents: 4_000, passThroughCents: 1_000 },
      { settledTotalCents: 24_400, taxCents: 1_400 },
    );
    // A course seat, a quarter refunded.
    await checkout(
      lesson,
      { tripCents: 40_000, gearCents: 0 },
      { settledTotalCents: 40_000, taxCents: 0, refundedCents: 10_000 },
    );

    const detail = await getMonthMoneyDetail(db, shop.shopId, JUNE, JULY, NOW);
    expect(detail.lines).toEqual([
      { line: "courses", cents: 30_000 },
      { line: "funDives", cents: 18_000 },
      { line: "rentals", cents: 4_000 },
    ]);
  });
});

describe("package dives the shop still owes", () => {
  async function soldPackage(db: AppDb, shop: { shopId: string; personId: string }) {
    const [pkg] = await db
      .insert(divePackages)
      .values({ shopId: shop.shopId, name: "Ten-dive card", diveCount: 10, priceCents: 45_000 })
      .returning();
    if (!pkg) throw new Error("package insert failed");
    const order = await paidOrder(db, shop, [
      { kind: "dive_package", cents: 40_000, packageId: pkg.id },
    ]);
    const rows = await db
      .insert(divePackageEntitlements)
      .values(
        Array.from({ length: 10 }, () => ({
          shopId: shop.shopId,
          packageId: pkg.id,
          personId: shop.personId,
          orderId: order.id,
          createdAt: MID_JUNE,
        })),
      )
      .returning();
    return { pkg, order, rows };
  }

  it("counts the unused dives at the price they were bought for", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const { rows } = await soldPackage(db, shop);
    // Three spent in June, one spent in July (still owed at the end of June),
    // and one that lapsed in June.
    // A dive is spent on a booking, so each spend names one.
    const boat = await trip(db, shop.shopId, new Date("2031-06-20T13:00:00Z"));
    const bookingId = await book(db, shop.shopId, boat, shop.personId);
    const spent = rows.slice(0, 3).map((row) => row.id);
    for (const id of spent) {
      await db
        .update(divePackageEntitlements)
        .set({ bookingId, consumedAt: new Date("2031-06-20T12:00:00Z") })
        .where(eqId(id));
    }
    await db
      .update(divePackageEntitlements)
      .set({ bookingId, consumedAt: new Date("2031-07-02T12:00:00Z") })
      .where(eqId(rows[3]?.id ?? ""));
    await db
      .update(divePackageEntitlements)
      .set({ expiresAt: new Date("2031-06-25T23:59:59Z") })
      .where(eqId(rows[4]?.id ?? ""));

    const june = await getMonthMoneyDetail(db, shop.shopId, JUNE, JULY, NOW);
    // 10 − 3 spent − 1 lapsed = 6, at the $400 paid over 10 dives.
    expect(june.packageDivesOwed).toEqual({ dives: 6, valueCents: 24_000 });
    // May's report predates the sale.
    const may = await getMonthMoneyDetail(
      db,
      shop.shopId,
      new Date("2031-05-01T00:00:00Z"),
      JUNE,
      NOW,
    );
    expect(may.packageDivesOwed).toEqual({ dives: 0, valueCents: 0 });
  });

  it("owes nothing on a package whose money went back", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const { order } = await soldPackage(db, shop);
    await db
      .update(orders)
      .set({ status: "refunded", amountPaidCents: 0 })
      .where(eqOrder(order.id));
    const detail = await getMonthMoneyDetail(db, shop.shopId, JUNE, JULY, NOW);
    expect(detail.packageDivesOwed).toEqual({ dives: 0, valueCents: 0 });
  });
});

describe("returning divers", () => {
  it("counts a diver who had been out before this month, once", async () => {
    const db = await unseededTestDb();
    const shop = await freshShop(db);
    const may = await trip(db, shop.shopId, new Date("2031-05-10T13:00:00Z"));
    const juneOne = await trip(db, shop.shopId, new Date("2031-06-05T13:00:00Z"));
    const juneTwo = await trip(db, shop.shopId, new Date("2031-06-20T13:00:00Z"));
    const regular = await person(db, shop.shopId, "Rita Regular");
    const newcomer = await person(db, shop.shopId, "Nico New");
    await book(db, shop.shopId, may, regular);
    await book(db, shop.shopId, juneOne, regular);
    await book(db, shop.shopId, juneTwo, regular);
    // Two boats this month does not make a diver a returning one.
    await book(db, shop.shopId, juneOne, newcomer);
    await book(db, shop.shopId, juneTwo, newcomer);

    const detail = await getMonthMoneyDetail(db, shop.shopId, JUNE, JULY, NOW);
    expect(detail.divers).toEqual({ total: 2, returning: 1 });
  });
});

function eqId(id: string) {
  return eq(divePackageEntitlements.id, id);
}

function eqOrder(id: string) {
  return eq(orders.id, id);
}
