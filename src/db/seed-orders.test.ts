import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { listShopOrders, ORDER_DEFAULT_RANGE_DAYS } from "./orders";
import { orderLineItems, orderStatus, orders } from "./schema";

/**
 * The seeded billing states (src/db/seed-orders.ts). The history back-fill
 * already floods this table with paid trip fees, so what these assert is the
 * *spread* — every status the index's filter offers resolves to something, and
 * none of the added rows can move a booking's payment gate.
 */
describe("seeded order states", () => {
  it("resolves every status the orders filter offers", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    for (const status of orderStatus.enumValues) {
      const page = await listShopOrders(db, shop.id, { status });
      expect(page.total, `no seeded order in status ${status}`).toBeGreaterThan(0);
    }
  });

  it("bills something other than a trip fee, and something part-paid", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const lines = await db
      .select({ kind: orderLineItems.kind })
      .from(orderLineItems)
      .where(eq(orderLineItems.shopId, shop.id));
    const kinds = new Set(lines.map((line) => line.kind));
    // The retail counter, not just the boat: the kinds the back-fill never
    // reaches.
    for (const kind of ["merchandise", "rental", "nitrox", "course_fee"] as const) {
      expect(kinds, `no seeded order line of kind ${kind}`).toContain(kind);
    }

    const rows = await db.select().from(orders).where(eq(orders.shopId, shop.id));
    const partPaid = rows.filter(
      (order) => order.amountPaidCents > 0 && order.amountPaidCents < order.totalCents,
    );
    expect(partPaid.length).toBeGreaterThan(0);
  });

  it("keeps every settling order off a booking, so no seat's payment gate moves", async () => {
    // The invariant the whole module rests on: `applyOrderUpdate` cascades a
    // paid or refunded *booking-linked* order onto that booking's payment
    // record, so a seeded refunded order hung off a seat would contradict the
    // `booking_payments` row the bookings scenario wrote for it — and could
    // change who may board the wreck charter, whose readiness other specs
    // assert exactly.
    //
    // Narrowed 2026-08-14 from "every non-paid order" to the statuses that
    // actually cascade. The old assertion was wider than the reason above it
    // and banned a shape the mechanism does not care about: `applyOrderUpdate`
    // reaches `recordBookingPayment` only under `status === "paid"` or
    // `status === "refunded"` (read it — the two branches are explicit), so an
    // `open` invoice settles nothing and moves no gate. That is what let
    // `seed-open-invoice.ts` put one unpaid seat on today's reef boat, which
    // the trip pulse's money fact needs in order to render at all; its own test
    // asserts from the other side that no seat on that departure is held by
    // payment.
    const { db, shop } = await seededShopContext({ history: true });
    const rows = await db.select().from(orders).where(eq(orders.shopId, shop.id));
    for (const order of rows) {
      if (order.status !== "refunded") continue;
      expect(order.bookingId, `order ${order.id} in status ${order.status} is booking-linked`).toBe(
        null,
      );
    }
  });

  it("dates them inside the index's default window, so they need no 'show all'", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    // Through the clock, like the seed that dated these rows: a direct
    // wall-clock read drifts past the frozen instant (`check:clock`).
    const from = new Date(nowMs() - ORDER_DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
    const standalone = (await db.select().from(orders).where(eq(orders.shopId, shop.id))).filter(
      (order) => order.bookingId === null,
    );
    expect(standalone.length).toBeGreaterThan(0);
    for (const order of standalone) {
      expect(order.createdAt.getTime()).toBeGreaterThan(from.getTime());
    }
  });
});
