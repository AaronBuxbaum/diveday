/**
 * The one definition of what a shop can rent. Both rental-fit forms (diver and
 * staff), the shop settings catalog, and the persistence actions read this list
 * so the checkbox set, the stored columns, and the shop's offer never drift
 * apart. "boots" is deliberately absent: it is not selected on its own but rides
 * along with a wetsuit in the prep list (src/lib/dive-prep.ts).
 */

export type RentableItemKind =
  | "bcd"
  | "regulator"
  | "wetsuit"
  | "mask_fins"
  | "weights"
  | "dive_computer"
  | "gopro";

export type RentalFitField =
  | "rentsBcd"
  | "rentsRegulator"
  | "rentsWetsuit"
  | "rentsMaskFins"
  | "rentsWeights"
  | "rentsDiveComputer"
  | "rentsGopro";

export type RentableItem = {
  kind: RentableItemKind;
  /** The `rental_fit_profiles` boolean column this item toggles. */
  field: RentalFitField;
  /** The HTML checkbox `name` the capture forms and actions agree on. */
  name: string;
  label: string;
  /**
   * Whether a diver with no fit on file defaults to renting this. Core gear a
   * shop stocks for everyone defaults on; add-ons a diver usually owns (a
   * computer) or may not want (a GoPro) default off, so nobody is packed a
   * GoPro they never asked for.
   */
  defaultRented: boolean;
};

export const RENTABLE_ITEMS: readonly RentableItem[] = [
  { kind: "bcd", field: "rentsBcd", name: "bcd", label: "BCD", defaultRented: true },
  {
    kind: "regulator",
    field: "rentsRegulator",
    name: "regulator",
    label: "Regulator",
    defaultRented: true,
  },
  {
    kind: "wetsuit",
    field: "rentsWetsuit",
    name: "wetsuit",
    label: "Wetsuit",
    defaultRented: true,
  },
  {
    kind: "mask_fins",
    field: "rentsMaskFins",
    name: "maskFins",
    label: "Mask & fins",
    defaultRented: true,
  },
  {
    kind: "weights",
    field: "rentsWeights",
    name: "weights",
    label: "Weights",
    defaultRented: true,
  },
  {
    kind: "dive_computer",
    field: "rentsDiveComputer",
    name: "diveComputer",
    label: "Dive computer",
    defaultRented: false,
  },
  { kind: "gopro", field: "rentsGopro", name: "gopro", label: "GoPro", defaultRented: false },
] as const;

/** The catalog a new shop starts with: the core gear, not the optional add-ons. */
export const DEFAULT_SHOP_RENTAL_ITEMS: RentableItemKind[] = RENTABLE_ITEMS.filter(
  (item) => item.defaultRented,
).map((item) => item.kind);

const KINDS = new Set<string>(RENTABLE_ITEMS.map((item) => item.kind));

/** Narrow arbitrary stored/form strings to the known rentable kinds, order preserved. */
export function toRentableKinds(values: readonly string[]): RentableItemKind[] {
  const seen = new Set<string>();
  const kinds: RentableItemKind[] = [];
  for (const value of values) {
    if (KINDS.has(value) && !seen.has(value)) {
      seen.add(value);
      kinds.push(value as RentableItemKind);
    }
  }
  return kinds;
}

/** The rentable items a shop offers, in canonical order, from its stored catalog. */
export function offeredRentableItems(rentalItems: readonly string[]): RentableItem[] {
  const offered = new Set(toRentableKinds(rentalItems));
  return RENTABLE_ITEMS.filter((item) => offered.has(item.kind));
}
