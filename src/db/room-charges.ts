import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { orders } from "./schema";

export type RoomChargeTotal = {
  /** The hotel the rooms belong to; null where the shop named none. */
  hotel: string | null;
  currency: string;
  /** Charged and not refunded, in `currency`'s minor units. */
  totalCents: number;
  orders: number;
};

/**
 * **The month's room charges, per hotel** (fifth-loop ideas, item 57): what a
 * resort center bills the front desk for. Orders charged to a room and paid
 * inside `[from, to)`, less anything refunded since.
 */
export async function roomChargesByHotel(
  db: DbExecutor,
  shopId: string,
  from: Date,
  to: Date,
): Promise<RoomChargeTotal[]> {
  const rows = await db
    .select({
      hotel: orders.roomHotel,
      currency: orders.currency,
      totalCents: sql<number>`coalesce(sum(${orders.amountPaidCents} - ${orders.refundedCents}), 0)::int`,
      orders: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, shopId),
        eq(orders.collection, "room_charge"),
        gte(orders.paidAt, from),
        lt(orders.paidAt, to),
      ),
    )
    .groupBy(orders.roomHotel, orders.currency)
    .orderBy(asc(orders.roomHotel));
  return rows;
}
