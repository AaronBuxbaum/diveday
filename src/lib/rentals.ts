/**
 * The one definition of what a shop can rent. Both rental-fit forms (diver and
 * staff), the shop settings catalog, and the persistence actions read this list
 * so the checkbox set, the stored columns, and the shop's offer never drift
 * apart. "boots" is deliberately absent: it is not selected on its own but rides
 * along with a wetsuit in the prep list (src/lib/dive-prep.ts).
 *
 * Nitrox fills are a separate concept, kept out of this list: most shops don't
 * fill Nitrox at all, and unlike the items above a fill has no size or
 * `rental_fit_profiles` column — it's a per-booking request, gated by a
 * verified card (src/db/nitrox.ts). It still lives in the same stored catalog
 * (`shops.rental_items`) so shop settings has one "what we offer" list; see
 * {@link NITROX_CATALOG_ITEM} and {@link shopOffersNitrox}.
 */

export type RentableItemKind =
  | "bcd"
  | "regulator"
  | "wetsuit"
  | "mask_fins"
  | "weights"
  | "dive_computer"
  | "gopro";

/** Everything a shop's catalog can hold: the rental-fit gear plus nitrox fills. */
export type ShopCatalogKind = RentableItemKind | "nitrox";

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
  /**
   * Whether a diver with no fit on file is *assumed* to want this. Core gear a
   * shop stocks for everyone defaults on, as does the dive computer (safety kit
   * most divers want); only the GoPro defaults off, so nobody is packed a GoPro
   * they never asked for.
   *
   * This is a packing assumption, never a purchase. It seeds the post-booking
   * rental-fit form, the staff fit editor, and a new shop's catalog
   * ({@link DEFAULT_SHOP_RENTAL_ITEMS}) — all places where a tick only states a
   * plan. The booking form's gear picker deliberately ignores it and starts
   * empty, because there the same tick is a paid line item on the diver's card
   * (docs ADR 20260801-checkout-upsells-rental-gear).
   */
  defaultRented: boolean;
};

/**
 * `kind` is the only code a caller needs — this file returns codes, never
 * rendered words. A staff surface resolves a word through
 * `src/i18n/rental-labels.ts`'s `rentableItemLabel` (staff.json); the diver
 * rental-fit form (`RentalFitForm.tsx`, the only diver-facing caller of this
 * list) resolves its own words against diver.json, since a shared label here
 * would tie one bundle to the other (see the domain-strings-common notes on a
 * function rendered on both a staff and a diver page).
 */
export const RENTABLE_ITEMS: readonly RentableItem[] = [
  { kind: "bcd", field: "rentsBcd", name: "bcd", defaultRented: true },
  {
    kind: "regulator",
    field: "rentsRegulator",
    name: "regulator",
    defaultRented: true,
  },
  {
    kind: "wetsuit",
    field: "rentsWetsuit",
    name: "wetsuit",
    defaultRented: true,
  },
  {
    kind: "mask_fins",
    field: "rentsMaskFins",
    name: "maskFins",
    defaultRented: true,
  },
  {
    kind: "weights",
    field: "rentsWeights",
    name: "weights",
    defaultRented: true,
  },
  {
    kind: "dive_computer",
    field: "rentsDiveComputer",
    name: "diveComputer",
    defaultRented: true,
  },
  { kind: "gopro", field: "rentsGopro", name: "gopro", defaultRented: false },
] as const;

/**
 * The catalog entry for nitrox fills — shaped like {@link RentableItem} minus
 * `field`, since a fill has no `rental_fit_profiles` column to toggle. Most
 * shops don't fill Nitrox, so this defaults off, unlike every core gear
 * item above.
 */
export const NITROX_CATALOG_ITEM = {
  kind: "nitrox",
  name: "nitrox",
  defaultRented: false,
} as const satisfies { kind: ShopCatalogKind; name: string; defaultRented: boolean };

/** Every entry a shop's "what we rent" settings can show and save. */
export const SHOP_CATALOG_ITEMS = [...RENTABLE_ITEMS, NITROX_CATALOG_ITEM] as const;

/** The catalog a new shop starts with: the core gear, not the optional add-ons. */
export const DEFAULT_SHOP_RENTAL_ITEMS: RentableItemKind[] = RENTABLE_ITEMS.filter(
  (item) => item.defaultRented,
).map((item) => item.kind);

const KINDS = new Set<string>(SHOP_CATALOG_ITEMS.map((item) => item.kind));

/** Narrow arbitrary stored/form strings to the known catalog kinds, order preserved. */
export function toRentableKinds(values: readonly string[]): ShopCatalogKind[] {
  const seen = new Set<string>();
  const kinds: ShopCatalogKind[] = [];
  for (const value of values) {
    if (KINDS.has(value) && !seen.has(value)) {
      seen.add(value);
      kinds.push(value as ShopCatalogKind);
    }
  }
  return kinds;
}

/** The rentable gear a shop offers, in canonical order, from its stored catalog. */
export function offeredRentableItems(rentalItems: readonly string[]): RentableItem[] {
  const offered = new Set(toRentableKinds(rentalItems));
  return RENTABLE_ITEMS.filter((item) => offered.has(item.kind));
}

/** Whether this shop fills nitrox tanks at all — the gate for every nitrox-request surface. */
export function shopOffersNitrox(rentalItems: readonly string[]): boolean {
  return toRentableKinds(rentalItems).includes("nitrox");
}

/**
 * The core kit that makes up a "set", including the dive computer (H-06,
 * reconfirmed 2026-08-02 — HD-9). A shop usually prices these six as one
 * cheaper bundle; a diver who takes all of them is quoted the set. A diver
 * taking a partial set (bringing their own dive computer, say) is quoted
 * whichever is cheaper — the set price or the sum of the pieces they
 * actually take — so skipping a piece never costs more than the full set
 * would have; see {@link quoteRentalFit}. The `gopro` add-on and nitrox are
 * always priced on their own, never folded into the set.
 */
export const CORE_RENTAL_KINDS = [
  "bcd",
  "regulator",
  "wetsuit",
  "mask_fins",
  "weights",
  "dive_computer",
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
  /** Nitrox surcharge, charged per dive. null = not priced online. */
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

/**
 * What a diver is quoted for the gear they picked. Any core items taken are
 * billed at whichever is cheaper: the shop's discounted set price, or the sum
 * of just those pieces' per-item prices — so a diver who skips one core piece
 * (bringing their own dive computer, say) is never charged more than the full
 * set would have cost, and still keeps the set discount on the rest (H-06,
 * HD-9). That comparison only runs when every rented core piece has a
 * per-item price; otherwise the shop hasn't priced enough of the pick to
 * compare, and each priced piece is billed on its own. The GoPro add-on and
 * nitrox are always separate. Items the shop hasn't priced are left off the
 * total and reported in `unpricedKinds`, so a quote is never silently short.
 * `plannedDives` scales the per-dive nitrox surcharge.
 */
export function quoteRentalFit(
  pricing: RentalPricing,
  fit: {
    rentedKinds: readonly RentableItemKind[];
    /**
     * The kinds this shop actually stocks (its rental catalog). The "set" is
     * every core item the shop offers, so a shop that doesn't stock a given
     * core item still reaches its set with the core it does stock — and set
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
  if (rentedCore.length > 0) {
    const perPieceLines: RentalQuoteLine[] = [];
    let perPieceTotal = 0;
    let everyRentedCorePiecePriced = true;
    for (const kind of rentedCore) {
      const cents = pricing.perItemCents[kind];
      if (cents === undefined) {
        everyRentedCorePiecePriced = false;
        unpricedKinds.push(kind);
      } else {
        perPieceLines.push({ kind, cents });
        perPieceTotal += cents;
      }
    }
    if (
      everyRentedCorePiecePriced &&
      pricing.setCents !== null &&
      pricing.setCents <= perPieceTotal
    ) {
      lines.push({ kind: "set", cents: pricing.setCents });
    } else {
      lines.push(...perPieceLines);
    }
  }

  for (const kind of ["gopro"] as const) {
    if (!rented.has(kind)) continue;
    const cents = pricing.perItemCents[kind];
    if (cents === undefined) unpricedKinds.push(kind);
    else lines.push({ kind, cents });
  }

  if (fit.wantsNitrox && pricing.nitroxCents !== null) {
    const dives = Math.max(1, fit.plannedDives);
    lines.push({
      kind: "nitrox",
      cents: pricing.nitroxCents * dives,
    });
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.cents, 0);
  return { lines, subtotalCents, unpricedKinds };
}
