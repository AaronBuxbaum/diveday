import type { DeskPayment } from "@/lib/desk-payment";
import type { DiverMessageKey, DiverTranslator } from "./messages";

/**
 * "Pay by card or cash when you arrive.": how the shop takes money, said after a
 * seat that is due at the shop (fifth-loop ideas, item 21). One sentence per
 * code, read by the booking confirmation and `/ready`'s money line; the
 * booking form's money block reads the same keys through its own namespace.
 */
export const DESK_PAYMENT_KEYS: Record<DeskPayment, DiverMessageKey> = {
  card: "booking.money.deskPayment.card",
  cash: "booking.money.deskPayment.cash",
  card_and_cash: "booking.money.deskPayment.card_and_cash",
};

/** The sentence, or null when the shop has not said. */
export function deskPaymentSentence(
  t: DiverTranslator,
  deskPayment: DeskPayment | null | undefined,
): string | null {
  return deskPayment ? t(DESK_PAYMENT_KEYS[deskPayment]) : null;
}
