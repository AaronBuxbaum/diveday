import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHOP_RENTAL_ITEMS,
  EMPTY_RENTAL_PRICING,
  hasAnyRentalPricing,
  offeredRentableItems,
  quoteRentalFit,
  RENTABLE_ITEMS,
  type RentalPricing,
  toRentableKinds,
} from "./rentals";

const PRICING: RentalPricing = {
  setCents: 4500,
  perItemCents: {
    bcd: 1500,
    regulator: 1500,
    wetsuit: 1200,
    mask_fins: 800,
    weights: 500,
    dive_computer: 1000,
    gopro: 2000,
  },
  nitroxCents: 1000,
};

// A shop that stocks the whole catalog, so set eligibility turns only on what
// the diver picks. Tests that need a shop without the computer pass their own.
const ALL_OFFERED = [
  "bcd",
  "regulator",
  "wetsuit",
  "mask_fins",
  "weights",
  "dive_computer",
  "gopro",
] as const;

describe("rentable items", () => {
  it("defaults a new shop to the core gear including the dive computer, not the GoPro", () => {
    expect(DEFAULT_SHOP_RENTAL_ITEMS).toEqual([
      "bcd",
      "regulator",
      "wetsuit",
      "mask_fins",
      "weights",
      "dive_computer",
    ]);
    // The dive computer is now part of the default kit; only the GoPro is opt-in.
    expect(DEFAULT_SHOP_RENTAL_ITEMS).toContain("dive_computer");
    expect(RENTABLE_ITEMS.map((item) => item.kind)).toContain("gopro");
    expect(DEFAULT_SHOP_RENTAL_ITEMS).not.toContain("gopro");
  });

  it("narrows stored/form values to known kinds, dropping junk and dupes", () => {
    expect(toRentableKinds(["bcd", "gopro", "nonsense", "bcd", "boots"])).toEqual(["bcd", "gopro"]);
  });

  it("offers items in canonical order regardless of the stored order", () => {
    const offered = offeredRentableItems(["gopro", "bcd", "wetsuit"]);
    expect(offered.map((item) => item.kind)).toEqual(["bcd", "wetsuit", "gopro"]);
  });

  it("offers nothing when the catalog is empty", () => {
    expect(offeredRentableItems([])).toEqual([]);
  });
});

describe("rental pricing", () => {
  it("treats an all-empty price list as unpriced", () => {
    expect(hasAnyRentalPricing(EMPTY_RENTAL_PRICING)).toBe(false);
    expect(hasAnyRentalPricing({ ...EMPTY_RENTAL_PRICING, setCents: 4500 })).toBe(true);
    expect(hasAnyRentalPricing({ ...EMPTY_RENTAL_PRICING, perItemCents: { gopro: 2000 } })).toBe(
      true,
    );
  });

  it("bills the five core items at the set price and the dive computer as its own line", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights", "dive_computer"],
      offeredKinds: ALL_OFFERED,
      wantsNitrox: false,
      plannedDives: 2,
    });
    // The computer is default-on but priced separately, never folded into the set.
    expect(quote.lines.map((line) => line.kind)).toEqual(["set", "dive_computer"]);
    expect(quote.subtotalCents).toBe(4500 + 1000);
    expect(quote.unpricedKinds).toEqual([]);
  });

  it("keeps the full-set discount when the diver skips the offered computer", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights"],
      offeredKinds: ALL_OFFERED,
      wantsNitrox: false,
      plannedDives: 2,
    });
    // The computer isn't part of the set, so an own-computer diver still gets the set price.
    expect(quote.lines).toEqual([{ kind: "set", label: "Full rental set", cents: 4500 }]);
    expect(quote.subtotalCents).toBe(4500);
  });

  it("still reaches the set with five core items when the shop doesn't stock a computer", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights"],
      // Catalog without a dive computer: the set is the core this shop offers.
      offeredKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights", "gopro"],
      wantsNitrox: false,
      plannedDives: 2,
    });
    expect(quote.lines).toEqual([{ kind: "set", label: "Full rental set", cents: 4500 }]);
    expect(quote.subtotalCents).toBe(4500);
  });

  it("bills a partial kit per piece, never the set", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "wetsuit"],
      offeredKinds: ALL_OFFERED,
      wantsNitrox: false,
      plannedDives: 2,
    });
    expect(quote.lines.map((line) => line.kind)).toEqual(["bcd", "wetsuit"]);
    expect(quote.subtotalCents).toBe(1500 + 1200);
  });

  it("adds add-ons and per-dive nitrox on top of the set", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: [
        "bcd",
        "regulator",
        "wetsuit",
        "mask_fins",
        "weights",
        "dive_computer",
        "gopro",
      ],
      offeredKinds: ALL_OFFERED,
      wantsNitrox: true,
      plannedDives: 3,
    });
    expect(quote.lines.map((line) => line.kind)).toEqual([
      "set",
      "dive_computer",
      "gopro",
      "nitrox",
    ]);
    // set 4500 + dive computer 1000 + gopro 2000 + nitrox 1000 × 3 dives
    expect(quote.subtotalCents).toBe(4500 + 1000 + 2000 + 3000);
  });

  it("falls back to per-piece when the shop has no set price", () => {
    const quote = quoteRentalFit(
      { ...PRICING, setCents: null },
      {
        rentedKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights", "dive_computer"],
        offeredKinds: ALL_OFFERED,
        wantsNitrox: false,
        plannedDives: 1,
      },
    );
    expect(quote.lines.map((line) => line.kind)).toEqual([
      "bcd",
      "regulator",
      "wetsuit",
      "mask_fins",
      "weights",
      "dive_computer",
    ]);
    expect(quote.subtotalCents).toBe(1500 + 1500 + 1200 + 800 + 500 + 1000);
  });

  it("reports chosen gear the shop hasn't priced instead of quoting it low", () => {
    const quote = quoteRentalFit(
      { setCents: null, perItemCents: { bcd: 1500 }, nitroxCents: null },
      {
        rentedKinds: ["bcd", "wetsuit"],
        offeredKinds: ALL_OFFERED,
        wantsNitrox: true,
        plannedDives: 2,
      },
    );
    expect(quote.subtotalCents).toBe(1500);
    expect(quote.unpricedKinds).toEqual(["wetsuit"]);
    // Nitrox wanted but unpriced → no nitrox line, and it isn't a "gear" unpriced kind.
    expect(quote.lines.some((line) => line.kind === "nitrox")).toBe(false);
  });
});
