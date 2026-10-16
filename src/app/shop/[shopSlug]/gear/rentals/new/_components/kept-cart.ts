import { readKeptTyped } from "@/components/KeepTypedOnRefusal";
import {
  COUNTER_RENTAL_FORM,
  PAYMENT_FIELD,
  PRICE_FIELD_PREFIX,
  RENTAL_PAYMENTS,
  type RentalPayment,
  SET_PRICE_FIELD,
  UNIT_FIELD,
} from "../../rental-form";

export type KeptCart = {
  ids: string[];
  prices: Record<string, string>;
  setFigure?: string;
  payment?: RentalPayment;
};

/**
 * The bill this tab last submitted, read back after a refusal (fifth loop,
 * item 14): the picks still on the register, their typed prices, the set
 * price and the payment. Null when nothing was kept.
 */
export function readKeptCart(
  scope: string,
  isOnRegister: (id: string) => boolean,
): KeptCart | null {
  const kept = readKeptTyped(COUNTER_RENTAL_FORM, scope);
  if (!kept) return null;
  const ids = (kept[UNIT_FIELD] ?? "").split(" ").filter(isOnRegister);
  const prices: Record<string, string> = {};
  for (const id of ids) {
    const price = kept[`${PRICE_FIELD_PREFIX}${id}`];
    if (price !== undefined) prices[id] = price;
  }
  return {
    ids,
    prices,
    setFigure: kept[SET_PRICE_FIELD],
    payment: RENTAL_PAYMENTS.find((value) => value === kept[PAYMENT_FIELD]),
  };
}
