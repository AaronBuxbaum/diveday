import type { DbExecutor } from "@/db/client";
import { queryAll } from "@/db/query-helpers";
import { listOrderLinesForExport, ORDER_EXPORT_MAX_LINES } from "@/db/order-export";
import { listSeatPaymentsForExport } from "@/db/seat-payments";
import { type MonthRef, monthKey } from "@/lib/calendar";
import { shopMonthBounds } from "@/lib/zoned";
import { ordersCsv } from "./orders-csv";

/**
 * **One month's orders as a file** (fifth loop, item 35): the Orders CSV,
 * cut to the orders and online seat payments of one shop-local month, the
 * second of the month-end files the bookkeeper's email attaches. The same
 * readers and the same serializer as the Orders door, under a filter that is
 * only the month.
 */
export async function ordersMonthFile(
  db: DbExecutor,
  shop: { id: string; slug: string; timezone: string },
  month: MonthRef,
): Promise<{ fileName: string; csv: string }> {
  const { from, to } = shopMonthBounds(month, shop.timezone);
  const filter = { from, to };
  const [lines, seats] = await queryAll(db, [
    () => listOrderLinesForExport(db, shop.id, filter),
    () => listSeatPaymentsForExport(db, shop.id, filter, ORDER_EXPORT_MAX_LINES),
  ]);
  return {
    fileName: `diveday-orders-${shop.slug}-${monthKey(month)}.csv`,
    csv: ordersCsv(lines, seats, shop.timezone),
  };
}
