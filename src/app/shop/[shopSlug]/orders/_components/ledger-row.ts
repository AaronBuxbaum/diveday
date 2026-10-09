import type { ShopOrderListRow } from "@/db/orders";
import { ORDER_COLLECTION_KEYS, ORDER_STATUS_KEYS, ORDER_STATUS_TONES } from "@/i18n/order-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import type { OrderLedgerRow } from "./OrdersLedger";

/** One order, worded and formatted for the day ledger (`OrdersLedger`). */
export function orderLedgerRow(
  row: ShopOrderListRow,
  { t, locale, shopSlug }: { t: StaffTranslator; locale: string; shopSlug: string },
): OrderLedgerRow {
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
