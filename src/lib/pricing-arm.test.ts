import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING_CONFIG } from "@/lib/billing/pricing-plans";
import { isPricingMarketingPath, visitorPricingArm } from "./pricing-arm";

const ON = { ...DEFAULT_PRICING_CONFIG, test: true };

describe("isPricingMarketingPath", () => {
  it("names the three pages that state or record a price", () => {
    for (const path of ["/", "/pricing", "/pricing/", "/get-set-up"]) {
      expect(isPricingMarketingPath(path)).toBe(true);
    }
    for (const path of ["/product", "/get-set-up/sent", "/shop/x/settings/billing", "/s/x"]) {
      expect(isPricingMarketingPath(path)).toBe(false);
    }
  });
});

describe("visitorPricingArm", () => {
  it("decides nothing while the test is off", () => {
    expect(
      visitorPricingArm({
        pathname: "/pricing",
        cookie: undefined,
        config: DEFAULT_PRICING_CONFIG,
      }),
    ).toEqual({ arm: null, setCookie: false });
    expect(
      visitorPricingArm({
        pathname: "/pricing",
        cookie: "percent_of_volume",
        config: DEFAULT_PRICING_CONFIG,
      }),
    ).toEqual({ arm: null, setCookie: false });
  });

  it("keeps a valid cookie", () => {
    expect(visitorPricingArm({ pathname: "/", cookie: "percent_of_volume", config: ON })).toEqual({
      arm: "percent_of_volume",
      setCookie: false,
    });
  });

  it("draws a new arm at the split for no cookie or a bad one", () => {
    expect(
      visitorPricingArm({ pathname: "/", cookie: undefined, config: ON, random: () => 0.1 }),
    ).toEqual({ arm: "percent_of_volume", setCookie: true });
    expect(
      visitorPricingArm({ pathname: "/", cookie: "bogus", config: ON, random: () => 0.9 }),
    ).toEqual({ arm: "flat_monthly", setCookie: true });
  });

  it("decides nothing off the marketing pages", () => {
    expect(
      visitorPricingArm({ pathname: "/product", cookie: "percent_of_volume", config: ON }),
    ).toEqual({ arm: null, setCookie: false });
  });
});
