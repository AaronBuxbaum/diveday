import { describe, expect, it } from "vitest";
import {
  configuredPricing,
  DEFAULT_PRICING_CONFIG,
  effectivePricing,
  FLAT_MONTHLY_CENTS,
  isPricingPlan,
  isTodaysPrice,
  PRICING_PLANS,
  type PricingConfig,
  parsePricingPlanArgs,
  percentFeeCents,
  termsFor,
} from "./pricing-plans";

describe("configured pricing", () => {
  it.each([
    [9900, 0, "flat_monthly"],
    [0, 300, "percent_of_volume"],
    [2900, 250, "percent_of_volume"],
    [0, 0, "flat_monthly"],
  ] as const)("uses monthly %s and basis points %s", (monthlyCents, basisPoints, plan) => {
    expect(configuredPricing({ monthlyCents, basisPoints })).toEqual({
      plan,
      monthlyCents,
      basisPoints,
    });
  });

  it("defaults new subscriptions to no monthly fee and three percent", () => {
    expect(DEFAULT_PRICING_CONFIG).toEqual({ monthlyCents: 0, basisPoints: 300 });
    expect(isTodaysPrice(configuredPricing(DEFAULT_PRICING_CONFIG))).toBe(false);
    expect(isTodaysPrice(configuredPricing({ monthlyCents: 9900, basisPoints: 300 }))).toBe(false);
    expect(PRICING_PLANS).toEqual(["flat_monthly", "percent_of_volume"]);
    expect(isPricingPlan("bogus")).toBe(false);
    expect(termsFor("flat_monthly", { monthlyCents: 2900, basisPoints: 300 })).toEqual({
      plan: "flat_monthly",
      monthlyCents: 2900,
      basisPoints: 0,
    });
  });
});

describe("effectivePricing", () => {
  const config: PricingConfig = { monthlyCents: 2900, basisPoints: 250 };
  const stored = {
    plan: "percent_of_volume",
    source: "assigned",
    monthlyCents: 0,
    basisPoints: 300,
  };

  it("uses the configured offer for an unsubscribed shop regardless of a former assignment", () => {
    for (const saved of [null, stored, { ...stored, plan: "flat_monthly" }]) {
      expect(effectivePricing({ stored: saved, config, hasLiveSubscription: false })).toEqual(
        configuredPricing(config),
      );
    }
  });

  it("keeps live subscribers on their agreed terms", () => {
    expect(effectivePricing({ stored, config, hasLiveSubscription: true })).toEqual({
      plan: "percent_of_volume",
      monthlyCents: 0,
      basisPoints: 300,
    });
    expect(
      effectivePricing({ stored, config: DEFAULT_PRICING_CONFIG, hasLiveSubscription: true }),
    ).toEqual({ plan: "percent_of_volume", monthlyCents: 0, basisPoints: 300 });
  });

  it("keeps a live flat subscriber on its sold terms under the new default", () => {
    expect(
      effectivePricing({
        stored: { plan: "flat_monthly", source: "assigned", monthlyCents: 9900, basisPoints: 0 },
        config: DEFAULT_PRICING_CONFIG,
        hasLiveSubscription: true,
      }),
    ).toEqual({ plan: "flat_monthly", monthlyCents: 9900, basisPoints: 0 });
  });

  it("keeps an existing subscriber without a snapshot on the original monthly price", () => {
    expect(effectivePricing({ stored: null, config, hasLiveSubscription: true })).toEqual({
      plan: "flat_monthly",
      monthlyCents: FLAT_MONTHLY_CENTS,
      basisPoints: 0,
    });
  });

  it("honors an explicit deal before subscription", () => {
    expect(
      effectivePricing({
        stored: { ...stored, source: "override" },
        config,
        hasLiveSubscription: false,
      }),
    ).toEqual({ plan: "percent_of_volume", monthlyCents: 0, basisPoints: 300 });
  });
});

describe("percentFeeCents", () => {
  it("is the basis points of the volume, in whole cents", () => {
    expect(percentFeeCents(100_000, 300)).toBe(3_000);
    expect(percentFeeCents(100_000, 250)).toBe(2_500);
    expect(percentFeeCents(0, 300)).toBe(0);
    expect(percentFeeCents(100_000, 0)).toBe(0);
  });

  it("rounds half a cent up", () => {
    expect(percentFeeCents(50, 300)).toBe(2); // 1.5
    expect(percentFeeCents(49, 300)).toBe(1); // 1.47
    expect(percentFeeCents(16, 300)).toBe(0); // 0.48
    expect(percentFeeCents(17, 300)).toBe(1); // 0.51
  });

  it("is never negative, even on a month refunds took below zero", () => {
    expect(percentFeeCents(-10_000, 300)).toBe(0);
    expect(percentFeeCents(10_000, -300)).toBe(0);
  });

  it("refuses a fractional rate and a non-finite volume", () => {
    expect(percentFeeCents(Number.NaN, 300)).toBe(0);
    expect(percentFeeCents(Number.POSITIVE_INFINITY, 300)).toBe(0);
    expect(percentFeeCents(10_000, 2.5)).toBe(0);
    expect(percentFeeCents(100.7, 300)).toBe(3);
  });
});

describe("parsePricingPlanArgs", () => {
  it("reads a plan word, and auto as none", () => {
    expect(parsePricingPlanArgs(["reef", "flat"])).toEqual({
      ok: true,
      args: { shopSlug: "reef", plan: "flat_monthly", monthlyCents: null, basisPoints: null },
    });
    expect(parsePricingPlanArgs(["reef", "percent"])).toMatchObject({
      ok: true,
      args: { plan: "percent_of_volume" },
    });
    expect(parsePricingPlanArgs(["reef", "auto"])).toMatchObject({
      ok: true,
      args: { plan: null },
    });
  });

  it("reads a deal's numbers, in either order", () => {
    expect(
      parsePricingPlanArgs(["reef", "percent", "--basis-points", "250", "--monthly-cents", "2900"]),
    ).toEqual({
      ok: true,
      args: { shopSlug: "reef", plan: "percent_of_volume", monthlyCents: 2_900, basisPoints: 250 },
    });
  });

  it("refuses a missing or unknown plan word", () => {
    expect(parsePricingPlanArgs([])).toEqual({ ok: false, error: "usage" });
    expect(parsePricingPlanArgs(["reef"])).toEqual({ ok: false, error: "usage" });
    expect(parsePricingPlanArgs(["reef", "Flat"])).toEqual({ ok: false, error: "usage" });
    expect(parsePricingPlanArgs(["reef", "flat_monthly"])).toEqual({ ok: false, error: "usage" });
  });

  it("holds the numbers to the config's bounds", () => {
    expect(parsePricingPlanArgs(["reef", "flat", "--monthly-cents", "100001"])).toEqual({
      ok: false,
      error: "monthly_cents",
    });
    expect(parsePricingPlanArgs(["reef", "flat", "--monthly-cents", "-1"])).toEqual({
      ok: false,
      error: "monthly_cents",
    });
    expect(parsePricingPlanArgs(["reef", "percent", "--basis-points", "1001"])).toEqual({
      ok: false,
      error: "basis_points",
    });
    expect(parsePricingPlanArgs(["reef", "percent", "--basis-points", "2.5"])).toEqual({
      ok: false,
      error: "basis_points",
    });
    expect(parsePricingPlanArgs(["reef", "percent", "--basis-points"])).toEqual({
      ok: false,
      error: "basis_points",
    });
  });

  it("refuses numbers that do not fit the plan word, and repeats and strays", () => {
    expect(parsePricingPlanArgs(["reef", "auto", "--monthly-cents", "100"])).toEqual({
      ok: false,
      error: "auto_takes_no_numbers",
    });
    expect(parsePricingPlanArgs(["reef", "flat", "--basis-points", "100"])).toEqual({
      ok: false,
      error: "flat_takes_no_basis_points",
    });
    expect(
      parsePricingPlanArgs(["reef", "flat", "--monthly-cents", "1", "--monthly-cents", "2"]),
    ).toEqual({ ok: false, error: "usage" });
    expect(parsePricingPlanArgs(["reef", "flat", "extra"])).toEqual({ ok: false, error: "usage" });
  });
});
