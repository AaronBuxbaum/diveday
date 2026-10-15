import type { OrderExportLine } from "@/db/order-export";
import type { SeatPaymentRow } from "@/db/seat-payments";
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
 * Status, method and line kind are their stable codes (`paid`, `cash`,
 * `trip_fee`): a file that is filtered and pivoted reads better on a word that
 * never changes than on one that follows the reader's language.
 *
 * **"Paid on" and "Method"** (fourth UX review, item 28): a bookkeeper matches
 * a deposit by the day the money arrived and how it came, and "Raised" is
 * neither. A Stripe invoice and a seat paid online both say `stripe`.
 *
 * **A seat paid online at booking is its own row** (item 18), its "Order" the
 * checkout that took the card, so a party's seats group under the one Stripe
 * charge. Its figures are the seat's own share of that charge, on every seat
 * row, so the Paid column still sums to the money taken.
 */
export const ORDERS_CSV_HEADER = [
  "Order",
  "Raised",
  "Diver",
  "Departure",
  "Departure date",
  "Status",
  "Paid on",
  "Method",
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

/** The method code a row carries: how the money was taken. */
const METHOD_CODES = {
  stripe_invoice: "stripe",
  cash: "cash",
  card_machine: "card_machine",
} as const satisfies Record<OrderExportLine["collection"], string>;

function orderRows(lines: readonly OrderExportLine[], timeZone: string) {
  const seen = new Set<string>();
  return lines.map((row) => {
    const first = !seen.has(row.orderId);
    seen.add(row.orderId);
    const major = (cents: number) => minorToMajor(cents, row.currency);
    const values: CsvValue[] = [
      row.orderId,
      exportDateStamp(row.createdAt, timeZone),
      row.diverName,
      row.tripTitle,
      row.tripStartsAt ? exportDateStamp(row.tripStartsAt, timeZone) : null,
      row.status,
      row.paidAt ? exportDateStamp(row.paidAt, timeZone) : null,
      METHOD_CODES[row.collection],
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
    return { at: row.createdAt, values };
  });
}

function seatRows(seats: readonly SeatPaymentRow[], timeZone: string) {
  return seats.map((seat) => {
    const major = (cents: number) => minorToMajor(cents, seat.currency);
    const paidOn = exportDateStamp(seat.paidAt, timeZone);
    const values: CsvValue[] = [
      seat.checkoutId,
      paidOn,
      seat.person.fullName,
      seat.trip.title,
      exportDateStamp(seat.trip.startsAt, timeZone),
      seat.status,
      paidOn,
      "stripe",
      "seat",
      seat.trip.title,
      1,
      major(seat.amountCents),
      major(seat.amountCents),
      major(seat.taxCents),
      major(seat.amountCents - seat.refundedCents),
      major(seat.refundedCents),
      seat.currency.toUpperCase(),
    ];
    return { at: seat.paidAt, values };
  });
}

/**
 * Orders and seat payments as one list, newest first. Each input arrives
 * newest first already, so the two are merged rather than re-sorted, which
 * keeps an order's lines together in the order its reader gave them.
 */
export function ordersCsv(
  lines: readonly OrderExportLine[],
  seats: readonly SeatPaymentRow[],
  timeZone: string,
): string {
  const fromOrders = orderRows(lines, timeZone);
  const fromSeats = seatRows(seats, timeZone);
  const rows: CsvValue[][] = [];
  let o = 0;
  let s = 0;
  while (o < fromOrders.length || s < fromSeats.length) {
    const order = fromOrders[o];
    const seat = fromSeats[s];
    if (seat && (!order || seat.at.getTime() > order.at.getTime())) {
      rows.push(seat.values);
      s += 1;
    } else if (order) {
      rows.push(order.values);
      o += 1;
    }
  }
  return buildCsv(ORDERS_CSV_HEADER, rows);
}
