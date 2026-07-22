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

describe("rentable items", () => {
  it("defaults a new shop to the core gear, not the add-ons", () => {
    expect(DEFAULT_SHOP_RENTAL_ITEMS).toEqual([
      "bcd",
      "regulator",
      "wetsuit",
      "mask_fins",
      "weights",
    ]);
    // The add-ons exist but are opt-in.
    expect(RENTABLE_ITEMS.map((item) => item.kind)).toContain("dive_computer");
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

  it("bills the full core kit at the cheaper set price", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights"],
      wantsNitrox: false,
      plannedDives: 2,
    });
    expect(quote.lines).toEqual([{ kind: "set", label: "Full rental set", cents: 4500 }]);
    expect(quote.subtotalCents).toBe(4500);
    expect(quote.unpricedKinds).toEqual([]);
  });

  it("bills a partial kit per piece, never the set", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "wetsuit"],
      wantsNitrox: false,
      plannedDives: 2,
    });
    expect(quote.lines.map((line) => line.kind)).toEqual(["bcd", "wetsuit"]);
    expect(quote.subtotalCents).toBe(1500 + 1200);
  });

  it("adds add-ons and per-dive nitrox on top of the set", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights", "gopro"],
      wantsNitrox: true,
      plannedDives: 3,
    });
    expect(quote.lines.map((line) => line.kind)).toEqual(["set", "gopro", "nitrox"]);
    // set 4500 + gopro 2000 + nitrox 1000 × 3 dives
    expect(quote.subtotalCents).toBe(4500 + 2000 + 3000);
  });

  it("falls back to per-piece when the shop has no set price", () => {
    const quote = quoteRentalFit(
      { ...PRICING, setCents: null },
      {
        rentedKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights"],
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
    ]);
    expect(quote.subtotalCents).toBe(1500 + 1500 + 1200 + 800 + 500);
  });

  it("reports chosen gear the shop hasn't priced instead of quoting it low", () => {
    const quote = quoteRentalFit(
      { setCents: null, perItemCents: { bcd: 1500 }, nitroxCents: null },
      { rentedKinds: ["bcd", "wetsuit"], wantsNitrox: true, plannedDives: 2 },
    );
    expect(quote.subtotalCents).toBe(1500);
    expect(quote.unpricedKinds).toEqual(["wetsuit"]);
    // Nitrox wanted but unpriced → no nitrox line, and it isn't a "gear" unpriced kind.
    expect(quote.lines.some((line) => line.kind === "nitrox")).toBe(false);
  });
});
