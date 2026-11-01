import type { OrderCollection, OrderStatus } from "@/db/schema";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * Shared status-label map. The database enum key requires a label for every
 * order status.
 */
export const ORDER_STATUS_KEYS: Record<OrderStatus, StaffMessageKey> = {
  open: "divers.shared.orderStatus.open",
  paid: "divers.shared.orderStatus.paid",
  void: "divers.shared.orderStatus.void",
  uncollectible: "divers.shared.orderStatus.uncollectible",
  partly_refunded: "divers.shared.orderStatus.partlyRefunded",
  refunded: "divers.shared.orderStatus.refunded",
};

/**
 * Status tone: open is primary, paid success, void neutral, uncollectible
 * danger, and both refund states warning. Void is not a loss; refunds need
 * reconciliation attention. Callers decide whether to show a badge; this
 * total map still provides paid's tone where it is shown.
 */
export const ORDER_STATUS_TONES = {
  open: "primary",
  paid: "success",
  void: "neutral",
  uncollectible: "danger",
  partly_refunded: "warning",
  refunded: "warning",
} as const satisfies Record<OrderStatus, string>;

type CounterCollection = Exclude<OrderCollection, "stripe_invoice">;

/**
 * Counter-collection labels (ADR 20261009-counter-payments). Stripe invoices
 * are excluded and have no collection label.
 */
export const ORDER_COLLECTION_KEYS: Record<CounterCollection, StaffMessageKey> = {
  cash: "orders.collection.cash",
  card_machine: "orders.collection.card_machine",
  room_charge: "orders.collection.room_charge",
};

/** Room charges use `paidAtCounterLine`, which includes the room. */
export const ORDER_PAID_AT_COUNTER_KEYS: Record<
  Exclude<CounterCollection, "room_charge">,
  StaffMessageKey
> = {
  cash: "orders.detail.paidAtCounter.cash",
  card_machine: "orders.detail.paidAtCounter.card_machine",
};

/**
 * Formats the recorded collection method and date. Room charges also include
 * the order's room and optional hotel.
 */
export function paidAtCounterLine(
  t: StaffTranslator,
  input: {
    collection: CounterCollection;
    date: string;
    roomNumber?: string | null;
    roomHotel?: string | null;
  },
): string {
  if (input.collection === "room_charge") {
    const room = input.roomNumber ?? "";
    return input.roomHotel
      ? t("orders.detail.paidAtCounter.room_charge_hotel", {
          room,
          hotel: input.roomHotel,
          date: input.date,
        })
      : t("orders.detail.paidAtCounter.room_charge", { room, date: input.date });
  }
  return t(ORDER_PAID_AT_COUNTER_KEYS[input.collection], { date: input.date });
}
