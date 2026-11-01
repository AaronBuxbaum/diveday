import { readKeptTyped } from "@/components/KeepTypedOnRefusal";
import { FORM_DRAFT_FIELD_MAX } from "@/lib/form-drafts";
import {
  CART_CONFIRMED_FIELD,
  CART_FILLS_FIELD,
  CART_PAYMENT_FIELD,
  CART_PRICE_FIELD_PREFIX,
  CART_SET_PRICE_FIELD,
  CART_UNITS_FIELD,
  COUNTER_RENTAL_FORM,
  KEPT_CART_UNITS_MAX,
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
  fills: Record<string, string>;
  confirmed: string[];
  setFigure?: string;
  payment?: RentalPayment;
};

/**
 * The bill this tab last submitted, read back after a refusal: the picks
 * still on the register, their typed prices, the set
 * price, gas choices, confirmation ticks and payment. Null when nothing was kept.
 */
export function readKeptCart(
  scope: string,
  isOnRegister: (id: string) => boolean,
): KeptCart | null {
  const kept = readKeptTyped(COUNTER_RENTAL_FORM, scope);
  if (!kept) return null;
  const ids = [
    ...new Set(
      (bounded(kept[CART_UNITS_FIELD]) ?? bounded(kept[UNIT_FIELD]) ?? "")
        .split(" ")
        .filter((id) => id !== "" && isOnRegister(id)),
    ),
  ].slice(0, KEPT_CART_UNITS_MAX);
  const prices: Record<string, string> = {};
  for (const id of ids) {
    const price =
      bounded(kept[`${CART_PRICE_FIELD_PREFIX}${id}`]) ??
      bounded(kept[`${PRICE_FIELD_PREFIX}${id}`]);
    if (price !== undefined) prices[id] = price;
  }
  return {
    ids,
    prices,
    fills: readFills(bounded(kept[CART_FILLS_FIELD]), ids),
    confirmed: [
      ...new Set(
        (bounded(kept[CART_CONFIRMED_FIELD]) ?? "").split(" ").filter((id) => ids.includes(id)),
      ),
    ],
    setFigure: bounded(kept[CART_SET_PRICE_FIELD]) ?? bounded(kept[SET_PRICE_FIELD]),
    payment: RENTAL_PAYMENTS.find(
      (value) => value === (kept[CART_PAYMENT_FIELD] ?? kept[PAYMENT_FIELD]),
    ),
  };
}

function bounded(raw: string | undefined): string | undefined {
  return raw !== undefined && raw.length <= FORM_DRAFT_FIELD_MAX ? raw : undefined;
}

/** Stored form text is display state only, never authority to rent a unit. */
function readFills(raw: string | undefined, ids: readonly string[]): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          ids.includes(entry[0]) && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}
