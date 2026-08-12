import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHOP_RENTAL_ITEMS,
  EMPTY_RENTAL_PRICING,
  hasAnyRentalPricing,
  nitroxAvailableOn,
  offeredRentableItems,
  quoteRentalFit,
  RENTABLE_ITEMS,
  type RentalFitSizes,
  type RentalPricing,
  rentalFitCompleteness,
  SHOP_CATALOG_ITEMS,
  shopOffersNitrox,
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

describe("nitrox catalog", () => {
  it("defaults a new shop to not filling nitrox", () => {
    expect(DEFAULT_SHOP_RENTAL_ITEMS).not.toContain("nitrox");
  });

  it("lists nitrox in the shop settings catalog but not the rental-fit gear list", () => {
    expect(SHOP_CATALOG_ITEMS.map((item) => item.kind)).toContain("nitrox");
    expect(RENTABLE_ITEMS.map((item) => item.kind)).not.toContain("nitrox");
  });

  it("keeps nitrox out of the rental-fit gear checklist even when a shop offers it", () => {
    expect(offeredRentableItems(["bcd", "nitrox"]).map((item) => item.kind)).toEqual(["bcd"]);
  });

  it("round-trips nitrox through the stored catalog", () => {
    expect(toRentableKinds(["bcd", "nitrox"])).toEqual(["bcd", "nitrox"]);
  });

  it("reports whether a shop's catalog includes nitrox", () => {
    expect(shopOffersNitrox(["bcd", "nitrox"])).toBe(true);
    expect(shopOffersNitrox(["bcd"])).toBe(false);
    expect(shopOffersNitrox([])).toBe(false);
  });

  it("needs both the shop's fills and the course's permission", () => {
    const fills = ["bcd", "nitrox"];
    // An ordinary charter has no course to ask, so the shop's answer stands —
    // exactly what this gate was before courses got a say.
    expect(nitroxAvailableOn(fills, null)).toBe(true);
    expect(nitroxAvailableOn(fills, undefined)).toBe(true);
    // A course taught on air closes the box at a shop that fills nitrox all
    // day: an Open Water class is the case this exists for.
    expect(nitroxAvailableOn(fills, { nitroxCompatible: false })).toBe(false);
    expect(nitroxAvailableOn(fills, { nitroxCompatible: true })).toBe(true);
  });

  it("never opens on a course's say-so alone", () => {
    // A shop that does not fill nitrox cannot be talked into it by a catalog
    // row — the two gates are an AND in that direction too.
    expect(nitroxAvailableOn(["bcd"], { nitroxCompatible: true })).toBe(false);
    expect(nitroxAvailableOn([], null)).toBe(false);
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

  it("bills all six core items, including the dive computer, at the set price", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights", "dive_computer"],
      offeredKinds: ALL_OFFERED,
      wantsNitrox: false,
      plannedDives: 2,
    });
    // The dive computer is part of the set, so a full set is a single line.
    expect(quote.lines).toEqual([{ kind: "set", cents: 4500 }]);
    expect(quote.subtotalCents).toBe(4500);
    expect(quote.unpricedKinds).toEqual([]);
  });

  it("keeps the set discount when the diver skips the offered computer, since it's cheaper", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights"],
      offeredKinds: ALL_OFFERED,
      wantsNitrox: false,
      plannedDives: 2,
    });
    // Five core pieces individually (1500+1500+1200+800+500=5500) cost more than
    // the 4500 set price, so a diver bringing their own computer is quoted the
    // cheaper set price rather than losing the discount (H-06, HD-9).
    expect(quote.lines).toEqual([{ kind: "set", cents: 4500 }]);
    expect(quote.subtotalCents).toBe(4500);
  });

  it("reports the piece-by-piece price the set beat, so a surface can strike it through", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights", "dive_computer"],
      offeredKinds: ALL_OFFERED,
      wantsNitrox: true,
      plannedDives: 2,
    });
    // Pieces: 1500+1500+1200+800+500+1000 = 6500, plus 1000 × 2 dives of nitrox.
    expect(quote.listSubtotalCents).toBe(6500 + 2000);
    expect(quote.subtotalCents).toBe(4500 + 2000);
    // Nitrox is never part of the set, so the saving is the gear discount alone.
    expect(quote.setSavingsCents).toBe(6500 - 4500);
  });

  it("reports no saving when the pieces were already the cheaper answer", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "wetsuit"],
      offeredKinds: ALL_OFFERED,
      wantsNitrox: false,
      plannedDives: 2,
    });
    expect(quote.listSubtotalCents).toBe(quote.subtotalCents);
    expect(quote.setSavingsCents).toBe(0);
  });

  it("never claims a saving against a piece the shop hasn't priced", () => {
    const quote = quoteRentalFit(
      { ...PRICING, perItemCents: { ...PRICING.perItemCents, weights: undefined } },
      {
        rentedKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights", "dive_computer"],
        offeredKinds: ALL_OFFERED,
        wantsNitrox: false,
        plannedDives: 2,
      },
    );
    // One core piece is unpriced, so the set/per-piece comparison can't run —
    // and with no set line there is nothing to strike through.
    expect(quote.unpricedKinds).toEqual(["weights"]);
    expect(quote.setSavingsCents).toBe(0);
    expect(quote.listSubtotalCents).toBe(quote.subtotalCents);
  });

  it("bills per piece when the partial pick is already cheaper than the set", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "wetsuit"],
      offeredKinds: ALL_OFFERED,
      wantsNitrox: false,
      plannedDives: 2,
    });
    // 1500 + 1200 = 2700, cheaper than the 4500 set, so per-piece wins outright.
    expect(quote.lines.map((line) => line.kind)).toEqual(["bcd", "wetsuit"]);
    expect(quote.subtotalCents).toBe(1500 + 1200);
  });

  it("still reaches the set with five core items when the shop doesn't stock a computer", () => {
    const quote = quoteRentalFit(PRICING, {
      rentedKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights"],
      // Catalog without a dive computer: the set is the core this shop offers.
      offeredKinds: ["bcd", "regulator", "wetsuit", "mask_fins", "weights", "gopro"],
      wantsNitrox: false,
      plannedDives: 2,
    });
    expect(quote.lines).toEqual([{ kind: "set", cents: 4500 }]);
    expect(quote.subtotalCents).toBe(4500);
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
    // The dive computer is part of the set; only the GoPro and nitrox are separate.
    expect(quote.lines.map((line) => line.kind)).toEqual(["set", "gopro", "nitrox"]);
    // set 4500 + gopro 2000 + nitrox 1000 × 3 dives
    expect(quote.subtotalCents).toBe(4500 + 2000 + 3000);
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

/**
 * A fit is a *size record*, so "is it complete?" is a question about each item
 * the diver rents — not about whether a row exists. The bug this describes:
 * a diver who ticked BCD, wetsuit and weights and typed one fin size read as
 * a saved, complete fit, while three of the four things they'd be handed on
 * the dock had no size against them.
 */
describe("rentalFitCompleteness", () => {
  const OWN_KIT: RentalFitSizes = {
    rentsBcd: false,
    rentsWetsuit: false,
    rentsMaskFins: false,
    rentsWeights: false,
    bcdSize: null,
    wetsuitSize: null,
    bootSize: null,
    finSize: null,
    weightPreference: null,
  };

  it("treats no fit on file as its own state, never as incomplete", () => {
    expect(rentalFitCompleteness(null)).toEqual({ state: "not_recorded" });
    expect(rentalFitCompleteness(undefined)).toEqual({ state: "not_recorded" });
  });

  it("counts a diver who rents nothing as complete — own kit is an answer", () => {
    expect(rentalFitCompleteness(OWN_KIT)).toEqual({ state: "complete" });
  });

  it("is incomplete when a rented item has no size, even with another size on file", () => {
    // The reported case: BCD ticked, only a fin size typed.
    expect(rentalFitCompleteness({ ...OWN_KIT, rentsBcd: true, finSize: "M" })).toEqual({
      state: "incomplete",
      missing: ["bcd"],
    });
  });

  it("names every missing piece, in canonical order", () => {
    expect(
      rentalFitCompleteness({
        ...OWN_KIT,
        rentsBcd: true,
        rentsWetsuit: true,
        rentsMaskFins: true,
        rentsWeights: true,
      }),
    ).toEqual({
      state: "incomplete",
      missing: ["bcd", "wetsuit", "boots", "mask_fins", "weights"],
    });
  });

  it("is complete once every rented item has its size", () => {
    expect(
      rentalFitCompleteness({
        ...OWN_KIT,
        rentsBcd: true,
        rentsWetsuit: true,
        rentsMaskFins: true,
        rentsWeights: true,
        bcdSize: "M",
        wetsuitSize: "3 mm / M",
        finSize: "9",
        weightPreference: "12 lbs",
      }),
    ).toEqual({ state: "complete" });
  });

  it("takes one shoe size for both the suit's boots and the fins, from either column", () => {
    const suitAndFins = { ...OWN_KIT, rentsWetsuit: true, rentsMaskFins: true, wetsuitSize: "M" };
    expect(rentalFitCompleteness({ ...suitAndFins, finSize: "9" })).toEqual({ state: "complete" });
    // Imports carry a boot size of their own and no fin size — same answer.
    expect(rentalFitCompleteness({ ...suitAndFins, bootSize: "9" })).toEqual({ state: "complete" });
    // A blank fin size is not an answer, so the boot column still gets asked.
    expect(rentalFitCompleteness({ ...suitAndFins, finSize: "", bootSize: "9" })).toEqual({
      state: "complete",
    });
    // Neither column holds one: both pieces are loose ends, because both are
    // separate lines on the packing list.
    expect(rentalFitCompleteness(suitAndFins)).toEqual({
      state: "incomplete",
      missing: ["boots", "mask_fins"],
    });
  });

  it("reads a blank or whitespace size as no size at all", () => {
    expect(rentalFitCompleteness({ ...OWN_KIT, rentsBcd: true, bcdSize: "   " })).toEqual({
      state: "incomplete",
      missing: ["bcd"],
    });
  });

  it("never asks for a size the one-size gear doesn't have", () => {
    // Regulator, dive computer and GoPro have no size column, so a diver who
    // rents only those has told the shop everything there is to tell.
    expect(
      rentalFitCompleteness({
        ...OWN_KIT,
        // Deliberately shaped like a stored row that also carries the
        // sizeless toggles — they must not reach the answer.
        ...{ rentsRegulator: true, rentsDiveComputer: true, rentsGopro: true },
      } as RentalFitSizes),
    ).toEqual({ state: "complete" });
  });

  it("stops asking for a size once the shop drops that item from its catalog", () => {
    const rentsBcd = { ...OWN_KIT, rentsBcd: true, rentsWeights: true, weightPreference: "12 lbs" };
    expect(rentalFitCompleteness(rentsBcd, ["bcd", "weights"])).toEqual({
      state: "incomplete",
      missing: ["bcd"],
    });
    // Same fit, a shop that no longer rents BCDs: nothing left to hand over,
    // so nothing left to chase.
    expect(rentalFitCompleteness(rentsBcd, ["weights"])).toEqual({ state: "complete" });
  });

  it("counts every item when no catalog is supplied", () => {
    expect(rentalFitCompleteness({ ...OWN_KIT, rentsWeights: true })).toEqual({
      state: "incomplete",
      missing: ["weights"],
    });
  });
});
