import { keptTypedScope } from "@/components/kept-typed-scope";
import { addPanelHref } from "@/lib/add-panel";
import { shopPath } from "@/lib/staff-notices";

/**
 * Shape of the rent-out form, shared by the page that draws it and the action
 * that reads it back — kept out of the `"use server"` module, which may only
 * export async functions (the same split as `orders/_lib/order-form.ts`).
 */

/** The checkbox each picked unit posts its id under. */
export const UNIT_FIELD = "unit";

/** Each unit's price box posts as `price-<unit id>`, in major units. */
export const PRICE_FIELD_PREFIX = "price-";

/**
 * The one price box for the shop's core set, shown when the picks are exactly
 * one set (`isOneCoreSet`). Not a uuid, so it never collides with a unit's box.
 */
export const SET_PRICE_FIELD = "price-set";

/**
 * A tank's recorded gas posts as `fill-<unit id>`: blank (not recorded), or an
 * oxygen percent from 21 (air) to 40, read by `parseTankFill` (issue #2257).
 */
export const FILL_FIELD_PREFIX = "fill-";

/** Kept-form display state precedes rows; the action only reads the fields above/below. */
export const CART_UNITS_FIELD = "cart-units";
export const CART_PAYMENT_FIELD = "cart-payment";
export const CART_SET_PRICE_FIELD = "cart-set-price";
export const CART_PRICE_FIELD_PREFIX = "cart-price-";
export const CART_FILLS_FIELD = "cart-fills";
export const CART_CONFIRMED_FIELD = "cart-confirmed";

/** Mirrors the action's 40-unit bound without changing its validation. */
export const KEPT_CART_UNITS_MAX = 40;

/** A flagged soft-goods unit the staffer chose to lend anyway posts `confirm-<unit id>`. */
export const CONFIRM_FIELD_PREFIX = "confirm-";

/** The register's add-panel value for renting gear out (`/gear?add=rental`). */
export const RENT_OUT_PANEL = "rental";

/**
 * The rent-out panel for a person and a window, on the register (`/gear?add=rental`):
 * the URL every step of the form lands back on, so a refusal keeps who and when
 * the staffer already chose.
 */
export function counterRentalFormPath(
  shopSlug: string,
  state: { personId?: string; from?: string; until?: string } = {},
): string {
  return addPanelHref(shopPath(shopSlug, "gear"), RENT_OUT_PANEL, state);
}

/** The rent-out form's name for `KeepTypedOnRefusal`: a refusal brings the cart back filled. */
export const COUNTER_RENTAL_FORM = "counter-rental";

/** A refused bill belongs to this staffer and this diver, not the next customer. */
export function counterRentalDraftScope(
  shopSlug: string,
  staffId: string,
  personId: string | undefined,
): string {
  const staffScope = keptTypedScope(shopSlug, staffId);
  return personId ? `${staffScope}.${personId}` : staffScope;
}

/** The payment choice posts under this name, one of `RENTAL_PAYMENTS`. */
export const PAYMENT_FIELD = "payment";

/**
 * How a counter rental is paid: recorded as paid in cash or on the shop's own
 * card machine, sent as a Stripe invoice by email, or not charged at all.
 */
export const RENTAL_PAYMENTS = ["cash", "card_machine", "invoice", "none"] as const;
export type RentalPayment = (typeof RENTAL_PAYMENTS)[number];
