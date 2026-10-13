import type { OrderExportLine } from "@/db/order-export";
import { buildCsv, type CsvValue, exportDateStamp } from "@/lib/export";
import { minorToMajor } from "@/lib/money";

/**
 * **What a bookkeeper asks for** (third UX review, item 34): one row per order
 * line, with the order it belongs to, the day it was raised in the shop's own
 * zone, the diver, the departure, and the money as plain numbers in the
 * order's currency, so a spreadsheet sums them as they come.
 *
 * The order's own figures (total, tax, paid, refunded) stand on its first line
 * only and are blank on the rest, so a column sum counts each order once.
 * Status and line kind are their stable codes (`paid`, `trip_fee`): a file
 * that is filtered and pivoted reads better on a word that never changes than
 * on one that follows the reader's language.
 */
export const ORDERS_CSV_HEADER = [
  "Order",
  "Raised",
  "Diver",
  "Departure",
  "Departure date",
  "Status",
  "Line kind",
  "Line",
  "Quantity",
  "Line amount",
  "Order total",
  "Tax",
  "Paid",
  "Refunded",
  "Currency",
];

export function ordersCsv(lines: readonly OrderExportLine[], timeZone: string): string {
  const seen = new Set<string>();
  const rows: CsvValue[][] = lines.map((row) => {
    const first = !seen.has(row.orderId);
    seen.add(row.orderId);
    const major = (cents: number) => minorToMajor(cents, row.currency);
    return [
      row.orderId,
      exportDateStamp(row.createdAt, timeZone),
      row.diverName,
      row.tripTitle,
      row.tripStartsAt ? exportDateStamp(row.tripStartsAt, timeZone) : null,
      row.status,
      row.line?.kind ?? null,
      row.line?.description ?? null,
      row.line?.quantity ?? null,
      row.line ? major(row.line.unitAmountCents * row.line.quantity) : null,
      first ? major(row.totalCents) : null,
      first ? major(row.taxCents) : null,
      first ? major(row.amountPaidCents) : null,
      first ? major(row.refundedCents) : null,
      row.currency.toUpperCase(),
    ];
  });
  return buildCsv(ORDERS_CSV_HEADER, rows);
}
