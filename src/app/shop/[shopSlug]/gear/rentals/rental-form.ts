import { shopPath } from "@/lib/staff-notices";

/**
 * Shape of the rent-out form, shared by the page that draws it and the action
 * that reads it back — kept out of the `"use server"` module, which may only
 * export async functions (the same split as `orders/new/order-form.ts`).
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

/** A flagged soft-goods unit the staffer chose to lend anyway posts `confirm-<unit id>`. */
export const CONFIRM_FIELD_PREFIX = "confirm-";

/**
 * The rent-out form for a person and a window — the URL every step of the form
 * lands back on, so a refusal keeps who and when the staffer already chose.
 */
export function counterRentalFormPath(
  shopSlug: string,
  state: { personId?: string; from?: string; until?: string } = {},
): string {
  const search = new URLSearchParams();
  if (state.personId) search.set("personId", state.personId);
  if (state.from) search.set("from", state.from);
  if (state.until) search.set("until", state.until);
  const query = search.toString();
  const path = shopPath(shopSlug, "gear", "rentals", "new");
  return query ? `${path}?${query}` : path;
}
