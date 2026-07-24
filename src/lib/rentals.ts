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
   * shop stocks for everyone defaults on, as does the dive computer (safety kit
   * most divers want); only the GoPro defaults off, so nobody is packed a GoPro
   * they never asked for. Note the computer defaults on but is priced as its own
   * add-on line — being on by default is separate from being part of the set.
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
    defaultRented: true,
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

/**
 * The core kit that makes up a "set". A shop usually prices these five as one
 * cheaper bundle; a diver who takes all of them is quoted the set, and anyone
 * taking a partial set pays per piece. The `dive_computer` and `gopro` add-ons
 * and nitrox are always priced on their own, never folded into the set — the
 * computer defaults on for every diver but is billed as its own line, so a diver
 * who brings their own keeps the full-set discount on the hard goods.
 */
export const CORE_RENTAL_KINDS = [
  "bcd",
  "regulator",
  "wetsuit",
  "mask_fins",
  "weights",
] as const satisfies readonly RentableItemKind[];

export type CoreRentalKind = (typeof CORE_RENTAL_KINDS)[number];

/**
 * A shop's rental price list, all in minor units (cents). Nothing here is an
 * inventory or an allocation — it is only what a diver is quoted for the gear
 * they choose. Every field is optional: a shop that prices nothing online keeps
 * the "ask the shop" behaviour, and an item with no price simply isn't quoted.
 */
export type RentalPricing = {
  /** Price for the full core set (all of {@link CORE_RENTAL_KINDS}). null = no set price. */
  setCents: number | null;
  /** Per-piece price for each rentable item. A missing key means "not priced online". */
  perItemCents: Partial<Record<RentableItemKind, number>>;
  /** Enriched-air surcharge, charged per dive. null = not priced online. */
  nitroxCents: number | null;
};

export const EMPTY_RENTAL_PRICING: RentalPricing = {
  setCents: null,
  perItemCents: {},
  nitroxCents: null,
};

/** True when a shop has set at least one rental price — drives whether divers see any pricing. */
export function hasAnyRentalPricing(pricing: RentalPricing): boolean {
  return (
    pricing.setCents !== null ||
    pricing.nitroxCents !== null ||
    Object.keys(pricing.perItemCents).length > 0
  );
}

export type RentalQuoteLine = {
  /** `"set"` and `"nitrox"` are synthetic; every other value is a rentable kind. */
  kind: RentableItemKind | "set" | "nitrox";
  label: string;
  cents: number;
};

export type RentalQuote = {
  lines: RentalQuoteLine[];
  subtotalCents: number;
  /**
   * A gear item the diver chose that the shop hasn't priced online, so it is
   * absent from the quote and settled at the shop. Lets a surface say "plus a
   * few items priced at the shop" instead of quoting a misleadingly low total.
   */
  unpricedKinds: RentableItemKind[];
};

const ITEM_LABEL: Record<RentableItemKind, string> = {
  bcd: "BCD",
  regulator: "Regulator",
  wetsuit: "Wetsuit",
  mask_fins: "Mask & fins",
  weights: "Weights",
  dive_computer: "Dive computer",
  gopro: "GoPro",
};

/**
 * What a diver is quoted for the gear they picked. Taking every core item the
 * shop offers is billed at the set price when the shop has one (cheaper than the
 * pieces, by design); a partial set is billed per piece. The dive-computer and
 * GoPro add-ons and nitrox are always separate. Items the shop hasn't priced are
 * left off the total and reported in `unpricedKinds`, so a quote is never
 * silently short. `plannedDives` scales the per-dive nitrox surcharge.
 */
export function quoteRentalFit(
  pricing: RentalPricing,
  fit: {
    rentedKinds: readonly RentableItemKind[];
    /**
     * The kinds this shop actually stocks (its rental catalog). The "set" is
     * every core item the shop offers, so a shop that doesn't rent a dive
     * computer still reaches its set with the core it does stock — and set
     * eligibility never depends on an item the diver can't pick.
     */
    offeredKinds: readonly RentableItemKind[];
    wantsNitrox: boolean;
    plannedDives: number;
  },
): RentalQuote {
  const rented = new Set(fit.rentedKinds);
  const offered = new Set(fit.offeredKinds);
  const lines: RentalQuoteLine[] = [];
  const unpricedKinds: RentableItemKind[] = [];

  const offeredCore = CORE_RENTAL_KINDS.filter((kind) => offered.has(kind));
  const rentedCore = offeredCore.filter((kind) => rented.has(kind));
  const takesFullSet = offeredCore.length > 0 && rentedCore.length === offeredCore.length;
  if (takesFullSet && pricing.setCents !== null) {
    lines.push({ kind: "set", label: "Full rental set", cents: pricing.setCents });
  } else {
    for (const kind of rentedCore) {
      const cents = pricing.perItemCents[kind];
      if (cents === undefined) unpricedKinds.push(kind);
      else lines.push({ kind, label: ITEM_LABEL[kind], cents });
    }
  }

  for (const kind of ["dive_computer", "gopro"] as const) {
    if (!rented.has(kind)) continue;
    const cents = pricing.perItemCents[kind];
    if (cents === undefined) unpricedKinds.push(kind);
    else lines.push({ kind, label: ITEM_LABEL[kind], cents });
  }

  if (fit.wantsNitrox && pricing.nitroxCents !== null) {
    const dives = Math.max(1, fit.plannedDives);
    lines.push({
      kind: "nitrox",
      label: `Enriched air — ${dives} ${dives === 1 ? "dive" : "dives"}`,
      cents: pricing.nitroxCents * dives,
    });
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.cents, 0);
  return { lines, subtotalCents, unpricedKinds };
}
