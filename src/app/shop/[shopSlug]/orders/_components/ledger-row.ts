import type { LedgerRow } from "@/db/orders";
import { ORDER_COLLECTION_KEYS, ORDER_STATUS_KEYS, ORDER_STATUS_TONES } from "@/i18n/order-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import type { OrderLedgerRow } from "./OrdersLedger";

/**
 * One ledger row for an order or a seat paid online at booking. A seat opens
 * its departure because it has no order record of its own.
 */
export function orderLedgerRow(
  row: LedgerRow,
  { t, locale, shopSlug }: { t: StaffTranslator; locale: string; shopSlug: string },
): OrderLedgerRow {
  if (row.kind === "seat") {
    const { seat } = row;
    const seatAmount = formatMoneyCents(seat.amountCents, seat.currency, locale);
    return {
      id: seat.id,
      href: `/shop/${shopSlug}/trips/${seat.trip.id}`,
      linkLabel: t("orders.index.ledger.rowLabel", {
        name: seat.person.fullName,
        amount: seatAmount,
      }),
      diver: seat.person.fullName,
      detail: seat.trip.title,
      status:
        seat.status === "paid"
          ? null
          : { word: t(ORDER_STATUS_KEYS[seat.status]), tone: ORDER_STATUS_TONES[seat.status] },
      method: t("orders.index.ledger.paidAtBooking"),
      amount: seatAmount,
    };
  }
  const amount = formatMoneyCents(row.order.totalCents, row.order.currency, locale);
  return {
    id: row.order.id,
    href: `/shop/${shopSlug}/orders/${row.order.id}`,
    // Include diver and amount, not the date already supplied by the day
    // heading in the accessibility tree and on screen (`OrdersLedger.test.tsx`).
    linkLabel: t("orders.index.ledger.rowLabel", { name: row.person.fullName, amount }),
    diver: row.person.fullName,
    // The departure or the order's own description.
    detail: (row.trip?.title ?? row.order.description) || null,
    // Paid is routine here, so only exceptional statuses get a badge
    // (principle 9). Other surfaces still use its `success` tone.
    status:
      row.order.status === "paid"
        ? null
        : {
            word: ORDER_STATUS_KEYS[row.order.status]
              ? t(ORDER_STATUS_KEYS[row.order.status])
              : row.order.status,
            tone: ORDER_STATUS_TONES[row.order.status] ?? "neutral",
          },
    // Name the counter collection method; omit the ordinary Stripe invoice
    // case (ADR 20261009-counter-payments).
    method:
      row.order.collection === "stripe_invoice"
        ? null
        : t(ORDER_COLLECTION_KEYS[row.order.collection]),
    amount,
  };
}
