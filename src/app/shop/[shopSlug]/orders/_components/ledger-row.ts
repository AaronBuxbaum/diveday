import type { LedgerRow } from "@/db/orders";
import { ORDER_COLLECTION_KEYS, ORDER_STATUS_KEYS, ORDER_STATUS_TONES } from "@/i18n/order-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import type { OrderLedgerRow } from "./OrdersLedger";

/**
 * One ledger row, worded and formatted for the day ledger (`OrdersLedger`):
 * an order, or a seat a diver paid for online at booking (fourth UX review,
 * item 18), which opens its departure, since it has no order record of its own.
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
    // The diver and the amount, and deliberately not the date: the day
    // heading above already carries it, in the accessibility tree as
    // well as on screen (`OrdersLedger.test.tsx`).
    linkLabel: t("orders.index.ledger.rowLabel", { name: row.person.fullName, amount }),
    diver: row.person.fullName,
    // The departure, or the order's own description.
    detail: (row.trip?.title ?? row.order.description) || null,
    // Paid is the expected state and renders as nothing at all; only the
    // exceptional statuses earn a badge (principle 9). That is this
    // page's call, made here — `ORDER_STATUS_TONES` still knows paid is
    // `success`, because the two surfaces that do show it need that.
    status:
      row.order.status === "paid"
        ? null
        : {
            word: ORDER_STATUS_KEYS[row.order.status]
              ? t(ORDER_STATUS_KEYS[row.order.status])
              : row.order.status,
            tone: ORDER_STATUS_TONES[row.order.status] ?? "neutral",
          },
    // Money taken at the counter says how (ADR 20261009-counter-payments); a
    // Stripe invoice is the ordinary case and says nothing.
    method:
      row.order.collection === "stripe_invoice"
        ? null
        : t(ORDER_COLLECTION_KEYS[row.order.collection]),
    amount,
  };
}
