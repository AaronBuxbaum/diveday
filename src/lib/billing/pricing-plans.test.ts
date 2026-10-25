import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRICING_CONFIG,
  effectivePricing,
  FLAT_MONTHLY_CENTS,
  isPricingPlan,
  isTodaysPrice,
  PRICING_PLANS,
  type PricingConfig,
  parsePricingPlanArgs,
  percentFeeCents,
  pricingBucket,
  pricingPlanForKey,
  randomPricingPlan,
  termsFor,
} from "./pricing-plans";

const ON: PricingConfig = { ...DEFAULT_PRICING_CONFIG, test: true };

describe("the two plans", () => {
  it("names flat first, then percent", () => {
    expect(PRICING_PLANS).toEqual(["flat_monthly", "percent_of_volume"]);
  });

  it("defaults to today: the test off, $99 flat, 3% with no base fee", () => {
    expect(FLAT_MONTHLY_CENTS).toBe(9_900);
    expect(DEFAULT_PRICING_CONFIG).toEqual({
      test: false,
      split: 50,
      flat: { monthlyCents: 9_900 },
      percent: { basisPoints: 300, monthlyCents: 0 },
    });
  });

  it("knows its own codes and nothing else", () => {
    expect(isPricingPlan("flat_monthly")).toBe(true);
    expect(isPricingPlan("percent_of_volume")).toBe(true);
    expect(isPricingPlan("percent")).toBe(false);
    expect(isPricingPlan(undefined)).toBe(false);
  });

  it("calls only the flat plan at the published price today's price", () => {
    expect(isTodaysPrice(termsFor("flat_monthly", DEFAULT_PRICING_CONFIG))).toBe(true);
    expect(isTodaysPrice({ plan: "flat_monthly", monthlyCents: 12_900, basisPoints: 0 })).toBe(
      false,
    );
    expect(isTodaysPrice(termsFor("percent_of_volume", DEFAULT_PRICING_CONFIG))).toBe(false);
  });
});

describe("the split", () => {
  it("answers the same plan for the same key every time", () => {
    const key = "4f6c1d2e-0000-4000-8000-000000000001";
    expect(pricingPlanForKey(key, 50)).toBe(pricingPlanForKey(key, 50));
  });

  it("puts close to the split's share of keys in the percent arm", () => {
    for (const split of [50, 20]) {
      let percent = 0;
      for (let index = 0; index < 2_000; index += 1) {
        if (pricingPlanForKey(`shop-${index}`, split) === "percent_of_volume") percent += 1;
      }
      expect(Math.abs(percent / 2_000 - split / 100)).toBeLessThan(0.05);
    }
  });

  it("puts nobody in the percent arm at 0 and everybody at 100", () => {
    for (let index = 0; index < 100; index += 1) {
      expect(pricingPlanForKey(`k${index}`, 0)).toBe("flat_monthly");
      expect(pricingPlanForKey(`k${index}`, 100)).toBe("percent_of_volume");
    }
  });

  it("keeps a bucket in 0–99", () => {
    for (let index = 0; index < 200; index += 1) {
      const bucket = pricingBucket(`b${index}`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });

  it("draws a visitor's arm at the split", () => {
    expect(randomPricingPlan(50, () => 0.49)).toBe("percent_of_volume");
    expect(randomPricingPlan(50, () => 0.5)).toBe("flat_monthly");
    expect(randomPricingPlan(0, () => 0)).toBe("flat_monthly");
    expect(randomPricingPlan(100, () => 0.999)).toBe("percent_of_volume");
  });
});

describe("effectivePricing", () => {
  const none = { plan: null, source: null, monthlyCents: null, basisPoints: null };

  it("is today's flat price for everyone on the defaults", () => {
    expect(
      effectivePricing({
        stored: { ...none, plan: "percent_of_volume", source: "assigned" },
        config: DEFAULT_PRICING_CONFIG,
        hasLiveSubscription: false,
      }),
    ).toEqual({ plan: "flat_monthly", monthlyCents: 9_900, basisPoints: 0 });
  });

  it("charges the config's flat fee while the test is off", () => {
    const config = { ...DEFAULT_PRICING_CONFIG, flat: { monthlyCents: 12_900 } };
    expect(effectivePricing({ stored: null, config, hasLiveSubscription: false })).toEqual({
      plan: "flat_monthly",
      monthlyCents: 12_900,
      basisPoints: 0,
    });
  });

  it("lets a stored arm win while the test is on", () => {
    expect(
      effectivePricing({
        stored: { ...none, plan: "flat_monthly", source: "assigned" },
        config: ON,
        hasLiveSubscription: false,
      }).plan,
    ).toBe("flat_monthly");
  });

  it("puts a stored percent arm on the config's numbers", () => {
    const config = { ...ON, percent: { basisPoints: 250, monthlyCents: 2_900 } };
    expect(
      effectivePricing({
        stored: { ...none, plan: "percent_of_volume", source: "assigned" },
        config,
        hasLiveSubscription: false,
      }),
    ).toEqual({ plan: "percent_of_volume", monthlyCents: 2_900, basisPoints: 250 });
  });

  // Aaron's call on #2947: existing shops stay flat, and only a new set-up
  // request is put in an arm. A shop with nothing stored predates the test,
  // so turning it on never moves it.
  it("keeps a shop with no stored arm on the flat plan while the test is on", () => {
    expect(effectivePricing({ stored: null, config: ON, hasLiveSubscription: false })).toEqual({
      plan: "flat_monthly",
      monthlyCents: 9_900,
      basisPoints: 0,
    });
  });

  it("keeps a live subscription on the numbers it was sold, whatever the config says now", () => {
    const stored = {
      plan: "percent_of_volume",
      source: "assigned",
      monthlyCents: 0,
      basisPoints: 300,
    };
    const raised = { ...ON, percent: { basisPoints: 500, monthlyCents: 1_000 } };
    expect(effectivePricing({ stored, config: raised, hasLiveSubscription: true })).toEqual({
      plan: "percent_of_volume",
      monthlyCents: 0,
      basisPoints: 300,
    });
    // Turning the test off does not move a percent subscriber either.
    expect(
      effectivePricing({
        stored,
        config: DEFAULT_PRICING_CONFIG,
        hasLiveSubscription: true,
      }).plan,
    ).toBe("percent_of_volume");
  });

  it("keeps a subscriber from before the test on today's flat price", () => {
    expect(
      effectivePricing({
        stored: null,
        config: { ...ON, flat: { monthlyCents: 14_900 } },
        hasLiveSubscription: true,
      }),
    ).toEqual({ plan: "flat_monthly", monthlyCents: 9_900, basisPoints: 0 });
  });

  it("honours a deal made by hand, test on or off", () => {
    const stored = {
      plan: "percent_of_volume",
      source: "override",
      monthlyCents: 1_500,
      basisPoints: 200,
    };
    for (const config of [ON, DEFAULT_PRICING_CONFIG]) {
      expect(effectivePricing({ stored, config, hasLiveSubscription: false })).toEqual({
        plan: "percent_of_volume",
        monthlyCents: 1_500,
        basisPoints: 200,
      });
    }
  });

  it("reads an unknown stored value as nothing stored", () => {
    expect(
      effectivePricing({
        stored: { ...none, plan: "bogus", source: "assigned" },
        config: ON,
        hasLiveSubscription: false,
      }).plan,
    ).toBe("flat_monthly");
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
