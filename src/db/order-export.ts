/**
 * **The Orders ledger as a bookkeeper's file** (third UX review, item 34).
 *
 * One row per order line, under the same filter the Orders index is reading
 * (`shopOrderWhere`, the one `where` the list, its total and the trip pulse
 * already share), so "Download orders (CSV)" holds exactly the orders on
 * screen, across every page of them. The 84-file data export was the only
 * other way to get order rows out.
 *
 * Shop-scoped on every table it reads: the order through `shopOrderWhere`,
 * and each join on its own `shop_id`, so no row of another shop's can ride
 * along a foreign key.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { type ShopOrderFilter, shopOrderWhere } from "./orders";
import { bookings, orderLineItems, orders, people, trips } from "./schema";

/**
 * The most rows one download will carry. A season of a busy shop is a few
 * thousand orders; past this the right tool is the full data export, and the
 * file says so by stopping rather than by timing out.
 */
export const ORDER_EXPORT_MAX_LINES = 20_000;

export type OrderExportLine = {
  orderId: string;
  createdAt: Date;
  status: (typeof orders.$inferSelect)["status"];
  currency: string;
  totalCents: number;
  taxCents: number;
  amountPaidCents: number;
  refundedCents: number;
  diverName: string;
  tripTitle: string | null;
  tripStartsAt: Date | null;
  line: {
    kind: (typeof orderLineItems.$inferSelect)["kind"];
    description: string;
    quantity: number;
    unitAmountCents: number;
  } | null;
};

export async function listOrderLinesForExport(
  db: DbExecutor,
  shopId: string,
  filter: ShopOrderFilter,
): Promise<OrderExportLine[]> {
  const rows = await db
    .select({
      orderId: orders.id,
      createdAt: orders.createdAt,
      status: orders.status,
      currency: orders.currency,
      totalCents: orders.totalCents,
      taxCents: orders.taxCents,
      amountPaidCents: orders.amountPaidCents,
      refundedCents: orders.refundedCents,
      diverName: people.fullName,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
      lineId: orderLineItems.id,
      lineKind: orderLineItems.kind,
      lineDescription: orderLineItems.description,
      lineQuantity: orderLineItems.quantity,
      lineUnitAmountCents: orderLineItems.unitAmountCents,
    })
    .from(orders)
    // The joins `listShopOrders` makes, in its shape, so `shopOrderWhere`'s
    // name, departure and trip conditions read the same columns here.
    .innerJoin(people, and(eq(people.id, orders.personId), eq(people.shopId, shopId)))
    .leftJoin(bookings, and(eq(bookings.id, orders.bookingId), eq(bookings.shopId, shopId)))
    // diveday:allow-deleted-trips: an order names the departure it was raised for, deleted or not.
    .leftJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .leftJoin(
      orderLineItems,
      and(eq(orderLineItems.orderId, orders.id), eq(orderLineItems.shopId, shopId)),
    )
    .where(shopOrderWhere(shopId, filter))
    .orderBy(
      desc(orders.createdAt),
      asc(people.fullName),
      desc(orders.id),
      asc(orderLineItems.createdAt),
      asc(orderLineItems.id),
    )
    .limit(ORDER_EXPORT_MAX_LINES);
  return rows.map((row) => ({
    orderId: row.orderId,
    createdAt: row.createdAt,
    status: row.status,
    currency: row.currency,
    totalCents: row.totalCents,
    taxCents: row.taxCents,
    amountPaidCents: row.amountPaidCents,
    refundedCents: row.refundedCents,
    diverName: row.diverName,
    tripTitle: row.tripTitle,
    tripStartsAt: row.tripStartsAt,
    line:
      row.lineId !== null && row.lineKind !== null
        ? {
            kind: row.lineKind,
            description: row.lineDescription ?? "",
            quantity: row.lineQuantity ?? 1,
            unitAmountCents: row.lineUnitAmountCents ?? 0,
          }
        : null,
  }));
}
